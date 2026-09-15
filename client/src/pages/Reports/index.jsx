import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { supabase } from '../../services/supabase'
import { reportApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Spinner } from '../../components/ui'
import { TEMPLATES, normalizeConfig } from './engine/templates.js'
import { canDeleteSavedReport } from './engine/permissions.js'
import { formatDateTimeLocal } from './engine/format.js'

function TemplateCard({ tpl, onOpen, t }) {
  const blank = tpl.id === 'blank'
  return (
    <button type="button" onClick={onOpen}
      className={`card text-left p-4 flex flex-col gap-2 cursor-pointer transition-colors hover:border-blue-400 dark:hover:border-blue-600 ${blank ? 'border-dashed' : ''}`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${blank ? 'bg-gray-100 dark:bg-gray-800 text-gray-500' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
          <i className={`ti ${tpl.icon} text-lg`} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">{t(`reports.tpl.${tpl.id}.name`)}</div>
          {!blank && <div className="text-[11px] text-gray-400">{t('reports.list.template_badge')}</div>}
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t(`reports.tpl.${tpl.id}.description`)}</p>
      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-auto">{blank ? t('reports.list.start_blank') : t('reports.list.open')} →</span>
    </button>
  )
}

function SavedTable({ rows, profileMap, user, onOpen, onDuplicate, onDelete, busyId, t, emptyLabel, showOwner }) {
  if (!rows.length) return <div className="card px-4 py-6 text-center text-xs text-gray-400">{emptyLabel}</div>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-[#161B22] border-b border-gray-200 dark:border-gray-700 text-[11px] uppercase tracking-wide text-gray-400">
            <th className="px-4 py-2 text-left font-medium">{t('reports.save.name')}</th>
            <th className="px-4 py-2 text-left font-medium">{t('reports.save.visibility')}</th>
            {showOwner && <th className="px-4 py-2 text-left font-medium">{t('reports.list.owner')}</th>}
            <th className="px-4 py-2 text-left font-medium">{t('reports.list.updated')}</th>
            <th className="px-4 py-2 text-right font-medium">{t('referentials.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
              <td className="px-4 py-2.5">
                <button type="button" onClick={() => onOpen(r)} className="text-left bg-transparent border-0 p-0 cursor-pointer">
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600">{r.name}</span>
                  {r.description && <span className="block text-[11px] text-gray-400 max-w-md truncate">{r.description}</span>}
                </button>
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${r.visibility === 'shared' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  <i className={`ti ${r.visibility === 'shared' ? 'ti-users' : 'ti-lock'} text-[11px]`} aria-hidden="true" />{t(`reports.visibility.${r.visibility}`)}
                </span>
              </td>
              {showOwner && <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{profileMap[r.owner_id] || '—'}</td>}
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTimeLocal(r.updated_at)}</td>
              <td className="px-4 py-2.5">
                <div className="flex justify-end gap-1.5">
                  <button className="btn-primary text-xs py-1 px-2.5" onClick={() => onOpen(r)}><i className="ti ti-player-play" aria-hidden="true" /> {t('reports.list.run')}</button>
                  <button className="btn-ghost text-xs py-1 px-2.5" onClick={() => onDuplicate(r)} disabled={busyId === r.id} title={t('reports.list.duplicate')}><i className="ti ti-copy" aria-hidden="true" /> {t('reports.list.duplicate')}</button>
                  {canDeleteSavedReport(r, user) && (
                    <button className="btn-ghost text-xs py-1 px-2 text-red-600" onClick={() => onDelete(r)} disabled={busyId === r.id} title={t('common.delete')} aria-label={t('common.delete')}>
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ReportsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  const { data: reports, isLoading, isError, error } = useQuery({
    queryKey: ['saved-reports'],
    queryFn: reportApi.list,
    retry: 0,
    staleTime: 0,
  })
  const { data: profiles } = useQuery({
    queryKey: ['user-profiles-names'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name')
      return data || []
    },
    staleTime: 30 * 60 * 1000,
  })
  const profileMap = useMemo(() => Object.fromEntries((profiles || []).map(p => [p.id, p.full_name])), [profiles])
  const mine = (reports || []).filter(r => r.owner_id === user?.id)
  const shared = (reports || []).filter(r => r.owner_id !== user?.id && r.visibility === 'shared')

  const duplicateMut = useMutation({
    mutationFn: (r) => reportApi.create({
      name: t('reports.list.copy_of', { name: r.name }).slice(0, 150),
      description: r.description, visibility: 'private', template_id: r.template_id, config: normalizeConfig(r.config),
    }),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['saved-reports'] }); toast.success(t('reports.save.saved', { name: row.name })); navigate(`/reports/saved/${row.id}`) },
    onError: (e) => toast.error(`${t('reports.save.failed')} — ${(e?.message || '').slice(0, 160)}`),
  })
  const deleteMut = useMutation({
    mutationFn: (r) => reportApi.remove(r.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-reports'] }); toast.success(t('reports.list.deleted')) },
    onError: (e) => toast.error(e?.code === 'REPORT_NOT_ALLOWED' ? t('reports.save.denied') : `${t('common.error')} — ${(e?.message || '').slice(0, 160)}`),
  })
  const busyId = duplicateMut.isPending ? duplicateMut.variables?.id : deleteMut.isPending ? deleteMut.variables?.id : null
  const tableMissing = isError && /saved_reports|PGRST205|42P01|does not exist|schema cache/i.test(`${error?.code || ''} ${error?.message || ''}`)

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={<button className="btn-primary" onClick={() => navigate('/reports/template/blank')}><i className="ti ti-plus" aria-hidden="true" /> {t('reports.list.new')}</button>}
      />
      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="max-w-6xl flex flex-col gap-6">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{t('reports.list.step_template')}</h2>
            <p className="text-xs text-gray-400 mb-3">{t('reports.list.templates_hint')}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {TEMPLATES.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} t={t} onOpen={() => navigate(`/reports/template/${tpl.id}`)} />)}
            </div>
          </section>

          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : isError ? (
            <div className="card p-4 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 flex gap-2">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>{tableMissing ? t('reports.list.table_missing') : `${t('reports.list.load_failed')} — ${(error?.message || '').slice(0, 160)}`}</span>
            </div>
          ) : (
            <>
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t('reports.list.mine')} <span className="text-gray-400 font-normal">({mine.length})</span></h2>
                <SavedTable rows={mine} profileMap={profileMap} user={user} t={t} busyId={busyId} emptyLabel={t('reports.list.mine_empty')}
                  onOpen={r => navigate(`/reports/saved/${r.id}`)} onDuplicate={r => duplicateMut.mutate(r)}
                  onDelete={r => { if (window.confirm(t('reports.list.delete_confirm', { name: r.name }))) deleteMut.mutate(r) }} />
              </section>
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t('reports.list.shared')} <span className="text-gray-400 font-normal">({shared.length})</span></h2>
                <SavedTable rows={shared} profileMap={profileMap} user={user} t={t} busyId={busyId} showOwner emptyLabel={t('reports.list.shared_empty')}
                  onOpen={r => navigate(`/reports/saved/${r.id}`)} onDuplicate={r => duplicateMut.mutate(r)}
                  onDelete={r => { if (window.confirm(t('reports.list.delete_confirm', { name: r.name }))) deleteMut.mutate(r) }} />
              </section>
            </>
          )}
          <p className="text-[11px] text-gray-400 flex gap-1.5"><i className="ti ti-shield-lock text-xs" aria-hidden="true" />{t('reports.list.permissions_note')}</p>
        </div>
      </div>
    </>
  )
}
