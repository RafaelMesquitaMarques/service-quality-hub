// Export d'un rapport exécuté : Excel (Données / Paramètres / Synthèse) et CSV.
// L'export part du MÊME résultat que l'écran (runReport) : toutes les lignes
// filtrées — pas seulement la page affichée —, dans l'ordre et avec les colonnes
// choisis. Les indicateurs sont produits par kpiList(), partagée avec l'écran,
// pour que tableau, totaux et fichier correspondent exactement.

import { EMPTY } from './constants.js'
import { FIELD_MAP, valueLabel } from './fields.js'
import { exportCell, csvValue, formatMoney } from './format.js'
import { describeCondition, describePeriod, describeSort, fieldLabel, groupLabel } from './describe.js'
import { isConditionComplete, isTextualCondition } from './filters.js'
import { summarize, monthlyEvolution } from './aggregate.js'
import { buildXlsx } from './xlsxWriter.js'
import { toCsv } from './csv.js'

export const exportColumns = (config) => (config.columns || []).filter(id => FIELD_MAP[id] && !FIELD_MAP[id].filterOnly)

export const recordLink = (rec, baseUrl) => (rec.occurrence_id && baseUrl ? `${baseUrl.replace(/\/$/, '')}/tickets/${rec.occurrence_id}` : null)

// ── Indicateurs (écran + onglet Synthèse) ────────────────────────────────────
// value : { t: 'n', v, s } | null ; missing : nb de valeurs non renseignées.
export function kpiList(result, { t, lang = 'fr' }) {
  const m = result.metrics
  const hasTheme = result.compiled.hasTheme
  const meas = (k) => m.measures[k]
  const money = (k) => (meas(k).sum === null ? null : { t: 'n', v: meas(k).sum, s: 'money' })
  const list = [
    { key: 'calls', value: { t: 'n', v: m.calls, s: 'int' },
      note: m.callsWithoutSc ? t('reports.kpi.calls_note', { n: m.callsWithoutSc }) : '' },
    { key: 'occurrences', value: { t: 'n', v: m.occurrences, s: 'int' } },
    { key: 'articles', value: { t: 'n', v: m.articles + m.headerRows, s: 'int' },
      note: m.headerRows ? t('reports.kpi.articles_note', { n: m.headerRows }) : '' },
  ]
  if (hasTheme) {
    list.push({ key: 'scope_calls', value: { t: 'n', v: result.scopeMetrics.calls, s: 'int' }, note: t('reports.kpi.scope_calls_note') })
    list.push({ key: 'share', value: result.share === null ? null : { t: 'n', v: result.share, s: 'pct' }, note: t('reports.kpi.share_note') })
  }
  list.push({ key: 'affected_qty', value: meas('affected_qty').sum === null ? null : { t: 'n', v: meas('affected_qty').sum, s: 'int' }, missing: meas('affected_qty').missing })
  list.push({ key: 'cost_furniture', value: money('cost_furniture'), missing: meas('cost_furniture').missing,
    note: m.legacyRows ? t('reports.kpi.split_only_note') : '' })
  list.push({ key: 'cost_freight', value: money('cost_freight'), missing: meas('cost_freight').missing,
    note: m.freightRepeatedOccurrences ? t('reports.kpi.freight_repeated_note', { n: m.freightRepeatedOccurrences, amount: formatMoney(m.freightRepeatedExtra, lang) }) : '' })
  list.push({ key: 'cost_install', value: money('cost_install'), missing: meas('cost_install').missing })
  list.push({ key: 'supplier_credit', value: money('supplier_credit'), missing: meas('supplier_credit').missing })
  list.push({ key: 'cost_net', value: money('cost_net'), missing: meas('cost_net').missing,
    note: m.legacyRows ? t('reports.kpi.legacy_note', { amount: formatMoney(m.legacyTotal, lang), n: m.legacyRows }) : '' })
  return list.map(k => ({ ...k, label: t(`reports.kpi.${k.key}`) }))
}

export function dimLabel(dim, t) {
  return dim.time ? `${t(`reports.time.${dim.time}`)} (${fieldLabel(dim.field, t)})` : fieldLabel(dim.field, t)
}
export function dimValueLabel(dim, value, t) {
  if (value === EMPTY || value === null || value === undefined) return t('reports.empty')
  if (dim.time) return String(value)
  return valueLabel(FIELD_MAP[dim.field], value, t)
}

// ── Onglet Données ───────────────────────────────────────────────────────────
function dataSheet(result, config, ctx) {
  const { t } = ctx
  const cols = exportColumns(config)
  const header = [...cols.map(id => ({ t: 's', v: fieldLabel(id, t), s: 'header' })), { t: 's', v: t('reports.export.link'), s: 'header' }]
  const rows = [header]
  const hyperlinks = []
  result.records.forEach((rec, i) => {
    const row = cols.map(id => exportCell(id, rec[id], ctx))
    const url = recordLink(rec, ctx.baseUrl)
    if (url) { row.push({ t: 's', v: url, s: 'link' }); hyperlinks.push({ row: i + 1, col: cols.length, url }) }
    else row.push(null)
    rows.push(row)
  })
  return {
    name: t('reports.export.sheet_data'),
    columns: [...cols.map(id => ({ width: FIELD_MAP[id].width })), { width: 48 }],
    rows, freezeHeader: true, autoFilter: true, hyperlinks,
  }
}

// ── Onglet Paramètres ───────────────────────────────────────────────────────
function paramsSheet(result, config, ctx) {
  const { t } = ctx
  const s = (v, style) => (v === null || v === undefined || v === '' ? null : { t: 's', v: String(v), ...(style ? { s: style } : {}) })
  const rows = []
  const kv = (label, value) => rows.push([s(label, 'bold'), value && typeof value === 'object' ? value : s(value)])
  const blank = () => rows.push([])
  const section = (label) => { blank(); rows.push([s(label, 'title')]) }

  rows.push([s(t('reports.export.params_title'), 'title')])
  kv(t('reports.export.p_report'), ctx.reportName)
  kv(t('reports.export.p_description'), ctx.reportDescription || '—')
  kv(t('reports.export.p_template'), ctx.templateName || '—')
  kv(t('reports.export.p_generated_at'), { t: 'dt', v: (ctx.generatedAt || new Date()).toISOString() })
  kv(t('reports.export.p_generated_by'), ctx.userName || '—')
  kv(t('reports.export.p_source'), t('reports.export.p_source_value'))

  section(t('reports.export.s_period'))
  const p = result.period
  if (p) {
    kv(t('reports.export.p_date_field'), fieldLabel(p.field, t))
    kv(t('reports.export.p_period_type'), config.period.mode === 'relative' ? `${t('reports.period.relative')} — ${t(`reports.period.presets.${config.period.preset}`)}` : t('reports.period.fixed'))
    kv(t('reports.export.p_from'), p.from ? { t: 'd', v: p.from } : t('reports.export.open_bound'))
    kv(t('reports.export.p_to'), p.to ? { t: 'd', v: p.to } : t('reports.export.open_bound'))
    kv(t('reports.export.p_include_empty'), p.includeEmpty ? t('common.yes') : t('common.no'))
  } else {
    kv(t('reports.export.p_date_field'), t('reports.period.none_desc'))
  }

  section(t('reports.export.s_granularity'))
  kv(t('reports.export.p_granularity'), t(`reports.granularity.${result.granularity}_desc`))
  kv(t('reports.export.p_filter_level'), t('reports.granularity.filter_level'))
  kv(t('reports.export.p_view'), t(`reports.view.${config.view}`))
  kv(t('reports.export.p_sort'), describeSort(config.sort, t))
  kv(t('reports.export.p_columns'), exportColumns(config).map(id => fieldLabel(id, t)).join(', '))
  kv(t('reports.export.p_rows'), { t: 'n', v: result.records.length, s: 'int' })
  kv(t('reports.kpi.articles'), { t: 'n', v: result.metrics.articles + result.metrics.headerRows, s: 'int' })
  kv(t('reports.kpi.occurrences'), { t: 'n', v: result.metrics.occurrences, s: 'int' })
  kv(t('reports.kpi.calls'), { t: 'n', v: result.metrics.calls, s: 'int' })

  section(t('reports.export.s_filters'))
  const filters = config.filters || []
  if (!filters.length) rows.push([s(t('reports.export.none'))])
  filters.forEach(c => rows.push([s(fieldLabel(c.field, t), 'bold'), s(describeCondition(c, t)), s(isConditionComplete(c) ? (isTextualCondition(c) ? t('reports.textual') : t('reports.structured')) : t('reports.incomplete_ignored'))]))

  section(t('reports.export.s_groups'))
  const groups = config.groups || []
  if (!groups.length) rows.push([s(t('reports.export.none'))])
  groups.forEach(g => {
    const complete = (g.conditions || []).filter(isConditionComplete)
    const status = g.enabled === false ? t('reports.groups.disabled') : complete.length ? t('reports.groups.enabled') : t('reports.incomplete_ignored')
    const kind = complete.some(isTextualCondition) ? t('reports.textual') : t('reports.structured')
    rows.push([s(groupLabel(g, t), 'bold'), s(status), s(kind)])
    ;(g.conditions || []).forEach(c => rows.push([null, s(`${t('reports.groups.and')} ${describeCondition(c, t)}`), isConditionComplete(c) ? null : s(t('reports.incomplete_ignored'))]))
  })

  section(t('reports.export.s_notes'))
  ;['granularity', 'share', 'legacy_cost', 'cost_piece', 'freight_repeated', 'root_cause', 'ship_to', 'delivery_date', 'responsible', 'currency', 'sc_shared', 'textual']
    .forEach(k => rows.push([s(`• ${t(`reports.notes.${k}`)}`, 'wrap')]))

  return { name: t('reports.export.sheet_params'), columns: [{ width: 34 }, { width: 90 }, { width: 28 }], rows }
}

// ── Onglet Synthèse ─────────────────────────────────────────────────────────
function summarySheet(result, config, ctx) {
  const { t } = ctx
  const s = (v, style) => (v === null || v === undefined || v === '' ? null : { t: 's', v: String(v), ...(style ? { s: style } : {}) })
  const n = (v, style) => (v === null || v === undefined ? null : { t: 'n', v, s: style })
  const rows = []
  rows.push([s(`${t('reports.export.sheet_summary')} — ${ctx.reportName}`, 'title')])
  rows.push([s(t('reports.export.summary_basis'), 'muted')])
  rows.push([])
  rows.push([s(t('reports.export.kpi'), 'header'), s(t('reports.export.value'), 'header'), s(t('reports.export.missing'), 'header'), s(t('reports.export.note'), 'header')])
  for (const k of kpiList(result, ctx)) rows.push([s(k.label, 'bold'), k.value, k.missing ? n(k.missing, 'int') : null, s(k.note)])

  const hasTheme = result.compiled.hasTheme
  const dateField = result.period?.field || 'issue_reception_date'
  const evolution = monthlyEvolution(result.matched, result.scopeRows, { dateField, from: result.period?.from, to: result.period?.to, hasTheme })
  if (evolution.length) {
    rows.push([])
    rows.push([s(`${t('reports.indicators.monthly')} (${fieldLabel(dateField, t)})`, 'title')])
    rows.push([t('reports.time.month'), t('reports.kpi.calls'), hasTheme ? t('reports.kpi.scope_calls') : null, hasTheme ? t('reports.kpi.share') : null, t('reports.kpi.affected_qty'), t('reports.kpi.cost_net')].map(h => s(h, 'header')))
    for (const e of evolution) {
      rows.push([s(e.month), n(e.metrics.calls, 'int'), hasTheme ? n(e.scopeCalls, 'int') : null, hasTheme ? n(e.share, 'pct') : null,
        n(e.metrics.measures.affected_qty.sum, 'int'), n(e.metrics.measures.cost_net.sum, 'money')])
    }
  }

  if (config.view === 'summary' && config.summary?.dims?.length) {
    const dims = config.summary.dims
    const groups = summarize(result.matched, result.scopeRows, dims, { hasTheme })
    rows.push([])
    rows.push([s(`${t('reports.summary.title')} : ${dims.map(d => dimLabel(d, t)).join(' × ')}`, 'title')])
    rows.push(summaryHeader(dims, hasTheme, t).map(h => s(h, 'header')))
    for (const g of groups) rows.push(summaryRow(dims, g, hasTheme, t))
    const tot = result.metrics
    rows.push([
      s(t('reports.summary.total'), 'bold'), ...dims.slice(1).map(() => null),
      n(tot.calls, 'boldint'), n(tot.occurrences, 'boldint'), n(tot.articles + tot.headerRows, 'boldint'),
      n(tot.measures.affected_qty.sum, 'boldint'), n(tot.measures.cost_furniture.sum, 'boldmoney'),
      n(tot.measures.cost_freight.sum, 'boldmoney'), n(tot.measures.cost_net.sum, 'boldmoney'),
      ...(hasTheme ? [n(result.share, 'boldpct')] : []),
    ])
    rows.push([s(t('reports.summary.total_note'), 'muted')])
  }
  return { name: t('reports.export.sheet_summary'), columns: [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }], rows }
}

export function summaryHeader(dims, hasTheme, t) {
  return [...dims.map(d => dimLabel(d, t)), t('reports.kpi.calls'), t('reports.kpi.occurrences'), t('reports.kpi.articles'),
    t('reports.kpi.affected_qty'), t('reports.kpi.cost_furniture'), t('reports.kpi.cost_freight'), t('reports.kpi.cost_net'),
    ...(hasTheme ? [t('reports.summary.share_group')] : [])]
}
export function summaryRow(dims, g, hasTheme, t) {
  const n = (v, style) => (v === null || v === undefined ? null : { t: 'n', v, s: style })
  const m = g.metrics
  return [
    ...dims.map((d, i) => ({ t: 's', v: dimValueLabel(d, g.values[i], t) })),
    n(m.calls, 'int'), n(m.occurrences, 'int'), n(m.articles + m.headerRows, 'int'),
    n(m.measures.affected_qty.sum, 'int'), n(m.measures.cost_furniture.sum, 'money'), n(m.measures.cost_freight.sum, 'money'), n(m.measures.cost_net.sum, 'money'),
    ...(hasTheme ? [n(g.share, 'pct')] : []),
  ]
}

export function shouldIncludeSummary(config) {
  return config.indicators !== false || config.view === 'summary'
}

export async function exportReportXlsx(result, config, ctx, { onProgress } = {}) {
  const sheets = [dataSheet(result, config, ctx), paramsSheet(result, config, ctx)]
  if (shouldIncludeSummary(config)) sheets.push(summarySheet(result, config, ctx))
  return buildXlsx({ sheets, title: ctx.reportName, creator: ctx.userName || 'Checkmate', onProgress })
}

// Séparateurs du CSV selon les réglages régionaux : Excel ouvre un CSV avec le
// séparateur de liste de Windows. En fr-CA (virgule décimale) c'est « ; » —
// un CSV à virgules s'y ouvre dans une seule colonne (vérifié dans Excel).
export function csvFormatForLocale(locale) {
  const decimal = new Intl.NumberFormat(locale || undefined).format(1.5).includes(',') ? ',' : '.'
  return decimal === ',' ? { delimiter: ';', decimal: ',' } : { delimiter: ',', decimal: '.' }
}

export function exportReportCsv(result, config, ctx, { delimiter = ',', decimal = '.' } = {}) {
  const { t } = ctx
  const cols = exportColumns(config)
  const header = [...cols.map(id => fieldLabel(id, t)), t('reports.export.link')]
  const rows = result.records.map(rec => [
    ...cols.map(id => {
      const field = FIELD_MAP[id]
      const isText = !['int', 'money', 'pct'].includes(field.kind) || Array.isArray(rec[id])
      let value = csvValue(field, rec[id], ctx)
      if (!isText && decimal !== '.' && value !== '') value = value.replace('.', decimal)
      return { value, isText }
    }),
    { value: recordLink(rec, ctx.baseUrl) || '', isText: true },
  ])
  return toCsv(header, rows, { delimiter })
}

// Checkmate_Hardware_Manquant_2026-01-01_2026-08-31.xlsx
export function slugify(name) {
  return String(name || 'Rapport')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Rapport'
}
export function exportFileName({ slug, period, ext, today }) {
  const range = period ? `${period.from || 'debut'}_${period.to || today}` : `toutes-dates_${today}`
  return `Checkmate_${slug}_${range}.${ext}`
}
