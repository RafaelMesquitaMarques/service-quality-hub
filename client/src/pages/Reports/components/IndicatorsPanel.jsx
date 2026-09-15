import { useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { kpiList, dimValueLabel } from '../engine/exportReport.js'
import { monthlyEvolution, summarize } from '../engine/aggregate.js'
import { formatInt, formatMoney, formatPct } from '../engine/format.js'

const DIST_FIELDS = ['root_cause', 'category', 'plant', 'department', 'ship_to', 'project_name', 'item', 'foliot_id']
const CHARTS_KEY = 'reports.chartsOpen'

function kpiText(k, lang) {
  if (!k.value) return '—'
  if (k.value.s === 'money') return formatMoney(k.value.v, lang)
  if (k.value.s === 'pct') return formatPct(k.value.v, lang)
  return formatInt(k.value.v, lang)
}

// Préférence d'affichage propre au navigateur — sans conséquence si indisponible.
const readPref = () => { try { return localStorage.getItem(CHARTS_KEY) === '1' } catch { return false } }
const writePref = (v) => { try { localStorage.setItem(CHARTS_KEY, v ? '1' : '0') } catch { /* navigation privée */ } }

// Indicateurs en appui du tableau : une bande compacte de chiffres, les
// graphiques repliés par défaut pour laisser la place au tableau.
export default function IndicatorsPanel({ result, t, lang, dark }) {
  const [chartsOpen, setChartsOpen] = useState(readPref)
  const [distField, setDistField] = useState('plant')
  const kpis = useMemo(() => kpiList(result, { t, lang }), [result, t, lang])
  const hasTheme = result.compiled.hasTheme
  const dateField = result.period?.field || 'issue_reception_date'
  const notes = kpis.filter(k => k.note && ['cost_net', 'cost_freight', 'calls'].includes(k.key))
  const toggleCharts = () => setChartsOpen(o => { writePref(!o); return !o })

  return (
    <div className="bg-white dark:bg-[#0D1117] border-b border-gray-200 dark:border-gray-700/60 px-4 py-2 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
          {kpis.map(k => (
            <div key={k.key}
              className={`rounded-md border px-2.5 py-1 min-w-[104px] ${k.key === 'share' ? 'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700'}`}
              title={[k.label, k.note, k.missing ? t('reports.indicators.missing', { count: k.missing }) : ''].filter(Boolean).join(' — ')}>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono tabular-nums leading-tight">{kpiText(k, lang)}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight whitespace-nowrap">
                {k.label}
                {k.missing > 0 && <span className="text-gray-400"> · {t('reports.indicators.missing', { count: k.missing })}</span>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={toggleCharts} aria-expanded={chartsOpen} className="btn-ghost text-xs py-1 px-2 flex-shrink-0">
          <i className={`ti ${chartsOpen ? 'ti-chevron-up' : 'ti-chart-bar'}`} aria-hidden="true" />
          {chartsOpen ? t('reports.indicators.hide_charts') : t('reports.indicators.show_charts')}
        </button>
      </div>

      {(notes.length > 0 || hasTheme) && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
          <i className="ti ti-info-circle text-xs mr-1" aria-hidden="true" />
          {[hasTheme ? t('reports.indicators.share_short') : null, ...notes.map(k => `${k.label} : ${k.note}`)].filter(Boolean).join(' · ')}
        </p>
      )}

      {chartsOpen && <Charts result={result} t={t} lang={lang} dark={dark} dateField={dateField} hasTheme={hasTheme} distField={distField} setDistField={setDistField} />}
    </div>
  )
}

function Charts({ result, t, lang, dark, dateField, hasTheme, distField, setDistField }) {
  const evolution = useMemo(() => monthlyEvolution(result.matched, result.scopeRows, { dateField, from: result.period?.from, to: result.period?.to, hasTheme }), [result, dateField, hasTheme])
  const chartData = evolution.map(e => ({ month: e.month, calls: e.metrics.calls, share: e.share === null ? null : Math.round(e.share * 1000) / 10 }))
  const dist = useMemo(() => summarize(result.matched, result.scopeRows, [{ field: distField }], { hasTheme }).slice(0, 8), [result, distField, hasTheme])
  const maxCalls = Math.max(1, ...dist.map(d => d.metrics.calls))
  const axis = dark ? '#6b7280' : '#9ca3af'
  return (
    <div className="grid gap-3 lg:grid-cols-2 pb-1">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
        <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1 px-1">
          {t('reports.indicators.monthly')} <span className="text-gray-400 font-normal">· {t(`reports.fields.${dateField}`)}</span>
        </div>
        {chartData.length ? (
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#1f2937' : '#f3f4f6'} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: axis }} interval="preserveStartEnd" />
                <YAxis yAxisId="calls" allowDecimals={false} tick={{ fontSize: 10, fill: axis }} />
                {hasTheme && <YAxis yAxisId="share" orientation="right" tick={{ fontSize: 10, fill: axis }} unit="%" />}
                <Tooltip contentStyle={{ fontSize: 11, background: dark ? '#161B22' : '#fff', border: '1px solid #e5e7eb' }}
                  formatter={(v, name) => (name === 'share' ? [`${v} %`, t('reports.kpi.share')] : [v, t('reports.kpi.calls')])} />
                <Bar yAxisId="calls" dataKey="calls" fill="#2563eb" radius={[3, 3, 0, 0]} />
                {hasTheme && <Line yAxisId="share" dataKey="share" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} connectNulls />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-xs text-gray-400 italic px-1 py-6">{t('reports.indicators.no_dates')}</p>}
        {hasTheme && <p className="text-[10px] text-gray-400 px-1">{t('reports.indicators.chart_legend')}</p>}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex items-center justify-between gap-2 mb-1 px-1">
          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('reports.indicators.distribution')}</span>
          <select className="input text-[11px] py-0.5 w-auto" value={distField} onChange={e => setDistField(e.target.value)} aria-label={t('reports.indicators.distribution')}>
            {DIST_FIELDS.map(f => <option key={f} value={f}>{t(`reports.fields.${f}`)}</option>)}
          </select>
        </div>
        <ul className="flex flex-col gap-1">
          {dist.map(d => (
            <li key={d.key} className="text-[11px]">
              <div className="flex justify-between gap-2 text-gray-700 dark:text-gray-300">
                <span className="truncate" title={dimValueLabel({ field: distField }, d.values[0], t)}>{dimValueLabel({ field: distField }, d.values[0], t)}</span>
                <span className="font-mono tabular-nums whitespace-nowrap text-gray-500">
                  {t('reports.indicators.dist_line', { calls: d.metrics.calls, qty: d.metrics.measures.affected_qty.sum ?? '—', cost: d.metrics.measures.cost_net.sum === null ? '—' : formatMoney(d.metrics.measures.cost_net.sum, lang) })}
                </span>
              </div>
              <div className="h-1.5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${(d.metrics.calls / maxCalls) * 100}%` }} />
              </div>
            </li>
          ))}
          {dist.length === 0 && <li className="text-xs text-gray-400 italic">{t('reports.table.no_results')}</li>}
        </ul>
      </div>
    </div>
  )
}
