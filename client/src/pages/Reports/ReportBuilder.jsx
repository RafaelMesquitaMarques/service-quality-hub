import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { reportApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { PageHeader, Spinner } from '../../components/ui'
import { useReportDataset } from './useReportDataset'
import { FIELD_MAP } from './engine/fields.js'
import { runReport } from './engine/aggregate.js'
import { groupMatchCounts, isConditionComplete, isTextualCondition } from './engine/filters.js'
import { inResolvedPeriod, resolvePeriod, todayLocalISO } from './engine/period.js'
import { TEMPLATE_MAP, normalizeConfig } from './engine/templates.js'
import { describeCondition, groupLabel } from './engine/describe.js'
import { valueOptions, occurrenceFillRate } from './engine/options.js'
import { csvFormatForLocale, exportFileName, exportReportCsv, exportReportXlsx, slugify } from './engine/exportReport.js'
import { canDeleteSavedReport, canUpdateSavedReport, reportRights } from './engine/permissions.js'
import { formatInt, formatDateTimeLocal } from './engine/format.js'
import { PeriodSection, FiltersSection, GroupsSection, ColumnsSection, DisplaySection } from './components/ConfigSections'
import ResultsTable from './components/ResultsTable'
import SummaryView from './components/SummaryView'
import IndicatorsPanel from './components/IndicatorsPanel'
import SaveDialog from './components/SaveDialog'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

const errorDetail = (e) => (e?.message || '').slice(0, 200)

export default function ReportBuilder() {
  const { templateId, savedId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const user = useAuthStore(s => s.user)
  const { dark } = useThemeStore()
  const dataset = useReportDataset()

  const savedQuery = useQuery({
    queryKey: ['saved-report', savedId],
    queryFn: () => reportApi.get(savedId),
    enabled: !!savedId,
    retry: 0,
    staleTime: 0,
  })
  const saved = savedId ? savedQuery.data : null

  const [config, setConfig] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [page, setPage] = useState(1)
  const [saveDialog, setSaveDialog] = useState(null)     // null | 'saveAs' | 'update'
  const [saveError, setSaveError] = useState(null)
  const [exporting, setExporting] = useState(null)      // { kind, progress }
  const [exportError, setExportError] = useState(null)
  const [configOpen, setConfigOpen] = useState(true)
  // Séparateur CSV : proposé d'après la langue du navigateur, modifiable — Excel
  // suit le séparateur de liste de Windows, que le navigateur ne peut pas lire.
  const [csvSep, setCsvSep] = useState(() => {
    try { const v = localStorage.getItem('reports.csvSep'); if (v === ';' || v === ',') return v } catch { /* stockage indisponible */ }
    return csvFormatForLocale(navigator.language).delimiter
  })
  const chooseCsvSep = (v) => { setCsvSep(v); try { localStorage.setItem('reports.csvSep', v) } catch { /* stockage indisponible */ } }

  // Initialisation depuis le modèle ou le rapport enregistré.
  const initKey = savedId ? `saved:${savedId}:${saved?.updated_at || ''}` : `tpl:${templateId}`
  const initialized = useRef(null)
  useEffect(() => {
    if (initialized.current === initKey) return
    if (savedId) {
      if (!saved) return
      const c = normalizeConfig(saved.config)
      setConfig(c); setBaseline(JSON.stringify(c)); setPage(1)
      initialized.current = initKey
      return
    }
    const tpl = TEMPLATE_MAP[templateId]
    if (!tpl) { navigate('/reports', { replace: true }); return }
    const c = normalizeConfig(tpl.config())
    setConfig(c); setBaseline(JSON.stringify(c)); setPage(1)
    initialized.current = initKey
  }, [initKey, saved, savedId, templateId, navigate])

  const template = TEMPLATE_MAP[savedId ? saved?.template_id : templateId] || null
  const reportName = saved ? saved.name : template ? t(`reports.tpl.${template.id}.name`) : t('reports.title')
  const reportDescription = saved ? saved.description : template ? t(`reports.tpl.${template.id}.description`) : ''
  const fileSlug = saved ? slugify(saved.name) : template?.fileSlug || 'Rapport'

  const today = todayLocalISO()
  const labelOf = useCallback((g) => groupLabel(g, t), [t])
  const result = useMemo(
    () => (config && dataset.data ? runReport(dataset.rows, config, { today, labelOf }) : null),
    [config, dataset.data, dataset.rows, today, labelOf])

  // Valeurs proposées : présentes dans la période (avant les autres filtres).
  const periodRows = useMemo(() => {
    if (!config) return []
    const p = resolvePeriod(config.period, today)
    return p ? dataset.rows.filter(r => inResolvedPeriod(r[p.field], p)) : dataset.rows
  }, [config?.period, dataset.rows, today])
  const getOptions = useMemo(() => {
    const cache = new Map()
    return (fieldId) => {
      if (!cache.has(fieldId)) {
        const ref = FIELD_MAP[fieldId]?.referential
        cache.set(fieldId, valueOptions(periodRows, fieldId, { referential: ref && dataset.referentials ? dataset.referentials[ref] : null }))
      }
      return cache.get(fieldId)
    }
  }, [periodRows, dataset.referentials])

  const groupCounts = useMemo(() => (result && config ? groupMatchCounts(result.scopeRows, config.groups) : {}), [result, config?.groups])
  const fillRate = useMemo(() => (config && config.period.mode !== 'none' ? occurrenceFillRate(dataset.rows, config.period.field) : null), [config?.period.field, config?.period.mode, dataset.rows])
  const textualLabels = useMemo(() => new Set((result?.compiled.groups || []).filter(g => g.textual).map(g => g.label)), [result])

  const dirty = !!config && baseline !== null && JSON.stringify(config) !== baseline
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const patch = (p) => { setConfig(c => ({ ...c, ...p })); setPage(1) }
  const setPeriod = (period) => { setPage(1); setConfig(c => ({
    ...c, period,
    // Les regroupements temporels suivent le champ de date choisi.
    summary: { dims: (c.summary?.dims || []).map(d => (d.time ? { ...d, field: period.mode === 'none' ? 'issue_reception_date' : period.field } : d)) },
  })) }

  const onSortColumn = (fieldId) => {
    const field = FIELD_MAP[fieldId]
    const current = config.sort?.[0]
    const rest = (config.sort || []).slice(1).filter(s => s.field !== fieldId)
    let next
    if (current?.field === fieldId) next = current.dir === 'desc' ? [{ field: fieldId, dir: 'asc' }, ...rest] : rest
    else next = [{ field: fieldId, dir: ['text', 'longtext', 'id', 'enum'].includes(field.kind) ? 'asc' : 'desc' }, ...(current ? [current] : [])].slice(0, 2)
    patch({ sort: next })
  }

  // ── Droits ────────────────────────────────────────────────────────────────
  const rights = reportRights(user)
  const canUpdate = !!saved && canUpdateSavedReport(saved, user)
  const canDelete = !!saved && canDeleteSavedReport(saved, user)

  const saveMut = useMutation({
    // `sent` = la configuration réellement envoyée : c'est elle qui devient la
    // référence « enregistré », même si l'utilisateur a continué à modifier.
    mutationFn: async ({ mode, name, description, visibility, sent }) => (
      mode === 'update'
        ? reportApi.update(saved.id, { name, description, visibility, config: sent })
        : reportApi.create({ name, description, visibility, template_id: template?.id || null, config: sent })
    ),
    onSuccess: (row, vars) => {
      qc.invalidateQueries({ queryKey: ['saved-reports'] })
      qc.setQueryData(['saved-report', row.id], row)
      setBaseline(JSON.stringify(vars.sent))
      initialized.current = `saved:${row.id}:${row.updated_at || ''}`
      setSaveDialog(null)
      setSaveError(null)
      toast.success(t('reports.save.saved', { name: row.name }))
      if (vars.mode !== 'update' || row.id !== savedId) navigate(`/reports/saved/${row.id}`)
    },
    onError: (e) => {
      const msg = /row-level security|permission|not_allowed/i.test(e?.message || '') ? t('reports.save.denied') : `${t('reports.save.failed')} — ${errorDetail(e)}`
      if (saveDialog) setSaveError(msg); else toast.error(msg)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => reportApi.remove(saved.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-reports'] })
      setBaseline(JSON.stringify(config))
      toast.success(t('reports.list.deleted'))
      navigate('/reports')
    },
    onError: (e) => toast.error(e?.code === 'REPORT_NOT_ALLOWED' ? t('reports.save.denied') : `${t('common.error')} — ${errorDetail(e)}`),
  })

  const quickSave = () => {
    if (canUpdate) saveMut.mutate({ mode: 'update', name: saved.name, description: saved.description, visibility: saved.visibility, sent: config })
    else { setSaveError(null); setSaveDialog('saveAs') }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const doExport = async (kind) => {
    if (!result || dataset.isFetching) return
    setExportError(null)
    setExporting({ kind, progress: 0 })
    try {
      const ctx = {
        t, lang, reportName, reportDescription,
        templateName: template ? t(`reports.tpl.${template.id}.name`) : '',
        userName: user?.full_name || user?.email || '',
        generatedAt: new Date(), baseUrl: window.location.origin, today,
      }
      const filename = exportFileName({ slug: fileSlug, period: result.period, ext: kind, today })
      await new Promise(r => setTimeout(r, 30))   // laisse l'indicateur s'afficher
      let blob
      if (kind === 'xlsx') {
        const bytes = await exportReportXlsx(result, config, ctx, { onProgress: p => setExporting({ kind, progress: p }) })
        blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      } else {
        blob = new Blob([exportReportCsv(result, config, ctx, { delimiter: csvSep, decimal: csvSep === ';' ? ',' : '.' })], { type: 'text/csv;charset=utf-8' })
      }
      download(blob, filename)
      toast.success(t('reports.export.done', { count: result.records.length, file: filename }))
    } catch (e) {
      console.error('Report export failed', e)
      setExportError(`${t('reports.export.failed')} — ${errorDetail(e)}`)
    } finally {
      setExporting(null)
    }
  }

  const goBack = () => {
    if (dirty && !window.confirm(t('reports.unsaved_confirm'))) return
    navigate('/reports')
  }

  // ── États de chargement / erreur ─────────────────────────────────────────
  if (savedId && savedQuery.isError) {
    return (
      <>
        <PageHeader title={t('reports.title')} actions={<button className="btn-ghost" onClick={() => navigate('/reports')}><i className="ti ti-arrow-left" aria-hidden="true" /> {t('reports.back')}</button>} />
        <div className="p-6"><div className="card p-6 text-sm text-gray-600 dark:text-gray-300 flex gap-2"><i className="ti ti-lock text-amber-500" aria-hidden="true" />{t('reports.not_found')}</div></div>
      </>
    )
  }
  if (!config) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>

  const activeFilters = config.filters.filter(isConditionComplete)
  const activeGroups = config.groups.filter(g => g.enabled !== false && g.conditions.some(isConditionComplete))
  const incompleteCount = result?.compiled.incomplete.length || 0
  const progress = dataset.progress
  const exportDisabled = !result || dataset.isFetching || !!exporting

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2 min-w-0"><span className="truncate max-w-[36vw]" title={reportName}>{reportName}</span>{dirty && <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap">{t('reports.unsaved')}</span>}</span>}
        subtitle={[
          template ? `${t('reports.template_label')} : ${t(`reports.tpl.${template.id}.name`)}` : null,
          saved ? t(`reports.visibility.${saved.visibility}`) : t('reports.not_saved'),
        ].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button className="btn-ghost" onClick={goBack}><i className="ti ti-arrow-left" aria-hidden="true" /> {t('reports.back')}</button>
            {canDelete && (
              <button className="btn-ghost text-red-600 px-2" onClick={() => { if (window.confirm(t('reports.list.delete_confirm', { name: saved.name }))) deleteMut.mutate() }} title={t('common.delete')} aria-label={t('common.delete')}>
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            )}
            {saved && canUpdate && (
              <button className="btn-ghost px-2" onClick={() => { setSaveError(null); setSaveDialog('update') }} title={t('reports.save.properties')} aria-label={t('reports.save.properties')}>
                <i className="ti ti-settings" aria-hidden="true" />
              </button>
            )}
            <button className="btn-ghost" onClick={() => { setSaveError(null); setSaveDialog('saveAs') }}>
              <i className="ti ti-copy" aria-hidden="true" /> {t('reports.save.save_as')}
            </button>
            <button className="btn-ghost" onClick={quickSave} disabled={saveMut.isPending}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> {saveMut.isPending ? t('common.saving') : t('reports.save.save')}
            </button>
            <span className="inline-flex items-stretch">
              <button className="btn-ghost rounded-r-none disabled:opacity-50" onClick={() => doExport('csv')} disabled={exportDisabled}
                title={t('reports.export.csv_tip', { sep: csvSep })}>
                <i className="ti ti-file-type-csv" aria-hidden="true" /> CSV
              </button>
              <select value={csvSep} onChange={e => chooseCsvSep(e.target.value)} aria-label={t('reports.export.csv_sep')} title={t('reports.export.csv_sep')}
                className="border border-l-0 border-gray-200 dark:border-gray-700 rounded-r-lg text-xs px-1 bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300 cursor-pointer">
                <option value=";">;</option>
                <option value=",">,</option>
              </select>
            </span>
            <button className="btn-primary disabled:opacity-50" onClick={() => doExport('xlsx')} disabled={exportDisabled}>
              <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {t('reports.export.to_excel')}
            </button>
          </div>
        }
      />

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-auto lg:overflow-hidden">
        {/* ── Configuration ─────────────────────────────────────────────── */}
        <aside className={`${configOpen ? 'lg:w-[370px]' : 'lg:w-11'} flex-shrink-0 bg-white dark:bg-[#0D1117] border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700/60 lg:overflow-y-auto`}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            {configOpen && <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('reports.configure')}</span>}
            <button type="button" onClick={() => setConfigOpen(o => !o)} className="text-gray-400 hover:text-gray-700 bg-transparent border-0 cursor-pointer" title={configOpen ? t('reports.hide_config') : t('reports.show_config')} aria-label={configOpen ? t('reports.hide_config') : t('reports.show_config')}>
              <i className={`ti ${configOpen ? 'ti-layout-sidebar-left-collapse' : 'ti-layout-sidebar-left-expand'} text-base`} aria-hidden="true" />
            </button>
          </div>
          {configOpen && (
            <>
              <PeriodSection period={config.period} resolved={result?.period ?? resolvePeriod(config.period, today)} fillRate={fillRate} onChange={setPeriod} t={t} />
              <FiltersSection filters={config.filters} onChange={filters => patch({ filters })} getOptions={getOptions} t={t} />
              <GroupsSection groups={config.groups} onChange={groups => patch({ groups })} getOptions={getOptions} groupCounts={groupCounts} t={t} />
              <ColumnsSection columns={config.columns} sort={config.sort} t={t}
                onColumns={columns => patch({ columns })} onSort={sort => patch({ sort })}
                onReset={template ? () => patch({ columns: normalizeConfig(template.config()).columns }) : null} />
              <DisplaySection config={config} onChange={patch} t={t} />
            </>
          )}
        </aside>

        {/* ── Aperçu ────────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 min-h-[60vh] lg:min-h-0 flex flex-col bg-gray-50 dark:bg-[#0D1117]">
          <div className="bg-white dark:bg-[#0D1117] border-b border-gray-200 dark:border-gray-700/60 px-4 py-2.5 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <i className="ti ti-eye text-blue-500" aria-hidden="true" />{t('reports.preview')}
              </span>
              {result && (
                <span className="text-gray-700 dark:text-gray-300" aria-live="polite">
                  <strong className="font-mono">{formatInt(result.records.length, lang)}</strong> {t(`reports.granularity.unit_${config.view === 'summary' ? 'line' : result.granularity}`, { count: result.records.length })}
                  <span className="text-gray-400"> · {t('reports.counts', { articles: formatInt(result.metrics.articles + result.metrics.headerRows, lang), occurrences: formatInt(result.metrics.occurrences, lang), calls: formatInt(result.metrics.calls, lang) })}</span>
                </span>
              )}
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" title={t('reports.granularity.filter_level')}>
                {config.view === 'summary' ? t('reports.granularity.summary_badge') : t(`reports.granularity.${config.granularity}_badge`)}
              </span>
              <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-400">
                {dataset.isFetching
                  ? <><Spinner size="sm" /> {t('reports.data.refreshing')}</>
                  : dataset.loadedAt && <>{t('reports.data.loaded_at', { time: formatDateTimeLocal(dataset.loadedAt) })}</>}
                <button type="button" onClick={() => dataset.refetch()} disabled={dataset.isFetching} className="text-gray-400 hover:text-blue-600 bg-transparent border-0 cursor-pointer disabled:opacity-40" title={t('reports.data.refresh')} aria-label={t('reports.data.refresh')}>
                  <i className="ti ti-refresh text-sm" aria-hidden="true" />
                </button>
              </span>
            </div>

            {/* Critères actifs */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <i className="ti ti-calendar text-[11px] mr-1" aria-hidden="true" />
                {result?.period ? `${t(`reports.fields.${result.period.field}`)} : ${result.period.from || '…'} → ${result.period.to || '…'}` : t('reports.period.none_desc')}
              </span>
              {activeFilters.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 max-w-[360px]">
                  <span className="truncate" title={describeCondition(c, t)}>{describeCondition(c, t)}</span>
                  <button type="button" onClick={() => patch({ filters: config.filters.filter(x => x.id !== c.id) })} className="bg-transparent border-0 p-0 cursor-pointer text-gray-400 hover:text-red-500" aria-label={t('reports.filters.remove')}>
                    <i className="ti ti-x text-[10px]" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {activeGroups.length > 0 && <span className="text-[11px] text-gray-400">{t('reports.chips.and_one_of')}</span>}
              {activeGroups.map(g => {
                const textual = g.conditions.filter(isConditionComplete).some(isTextualCondition)
                return (
                  <span key={g.id} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full max-w-[360px] ${textual ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}
                    title={g.conditions.filter(isConditionComplete).map(c => describeCondition(c, t)).join(` ${t('reports.groups.and')} `)}>
                    {textual && <i className="ti ti-text-scan-2 text-[11px]" aria-hidden="true" />}
                    <span className="truncate">{groupLabel(g, t)}</span>
                    <button type="button" onClick={() => patch({ groups: config.groups.map(x => (x.id === g.id ? { ...x, enabled: false } : x)) })} className="bg-transparent border-0 p-0 cursor-pointer opacity-60 hover:opacity-100" aria-label={t('reports.groups.toggle')}>
                      <i className="ti ti-x text-[10px]" aria-hidden="true" />
                    </button>
                  </span>
                )
              })}
              {incompleteCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <i className="ti ti-alert-triangle text-[11px] mr-1" aria-hidden="true" />{t('reports.chips.incomplete', { count: incompleteCount })}
                </span>
              )}
              {(activeFilters.length > 0 || activeGroups.length > 0) && (
                <button type="button" onClick={() => patch({ filters: [], groups: config.groups.map(g => ({ ...g, enabled: false })) })}
                  className="text-[11px] text-red-500 border border-red-200 dark:border-red-900 rounded-full px-2 py-0.5 bg-transparent cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20">
                  <i className="ti ti-x text-[10px]" aria-hidden="true" /> {t('reports.filters.clear_all')}
                </button>
              )}
            </div>
            {exportError && (
              <div role="alert" className="text-xs rounded-lg px-3 py-2 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 flex items-center gap-2">
                <i className="ti ti-alert-circle" aria-hidden="true" />
                <span className="flex-1">{exportError}</span>
                <button type="button" onClick={() => setExportError(null)} className="bg-transparent border-0 cursor-pointer text-red-500" aria-label={t('common.close')}><i className="ti ti-x" aria-hidden="true" /></button>
              </div>
            )}
          </div>

          {dataset.isError ? (
            <div className="p-6">
              <div className="card p-5 flex flex-col gap-3 max-w-xl">
                <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                  <i className="ti ti-database-off" aria-hidden="true" />
                  {dataset.error?.code === 'REPORT_INCOMPLETE' ? t('reports.data.incomplete') : t('reports.data.failed')}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{errorDetail(dataset.error)}</p>
                <button className="btn-primary self-start" onClick={() => dataset.refetch()}><i className="ti ti-refresh" aria-hidden="true" /> {t('reports.data.retry')}</button>
              </div>
            </div>
          ) : !result ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <Spinner size="lg" />
              <span>{progress ? t(`reports.data.step_${progress.step}`, { loaded: formatInt(progress.loaded, lang), total: progress.total ? formatInt(progress.total, lang) : '…' }) : t('common.loading')}</span>
            </div>
          ) : (
            <>
              {config.indicators !== false && <IndicatorsPanel result={result} t={t} lang={lang} dark={dark} />}
              {config.view === 'summary'
                ? <SummaryView result={result} config={config} t={t} lang={lang} />
                : <ResultsTable result={result} config={config} page={page} onPage={setPage} onSortColumn={onSortColumn} textualLabels={textualLabels} t={t} lang={lang} />}
            </>
          )}
        </main>
      </div>

      {exporting && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" role="status" aria-live="polite">
          <div className="bg-white dark:bg-[#161B22] rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-sm flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              <Spinner size="sm" /> {t('reports.export.in_progress', { count: result?.records.length || 0 })}
            </div>
            <div className="h-2 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round((exporting.progress || 0) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {saveDialog && (
        <SaveDialog
          mode={saveDialog}
          initial={saveDialog === 'update' && saved
            ? { name: saved.name, description: saved.description, visibility: saved.visibility }
            : { name: saved ? t('reports.list.copy_of', { name: saved.name }) : reportName, description: reportDescription, visibility: 'private' }}
          canShare={saveDialog === 'update' && saved ? (saved.owner_id === user?.id ? rights.canShare : rights.isAdmin) : rights.canShare}
          allowPrivate={!(saveDialog === 'update' && saved && saved.owner_id !== user?.id)}
          saving={saveMut.isPending}
          error={saveError}
          onClose={() => setSaveDialog(null)}
          onSubmit={(values) => saveMut.mutate({ mode: saveDialog, ...values, sent: config })}
          t={t}
        />
      )}
    </>
  )
}
