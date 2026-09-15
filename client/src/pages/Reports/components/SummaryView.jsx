import { useMemo } from 'react'
import { summarize } from '../engine/aggregate.js'
import { dimLabel, dimValueLabel } from '../engine/exportReport.js'
import { formatInt, formatMoney, formatPct } from '../engine/format.js'
import { EmptyState } from '../../../components/ui'

// Vue résumée : un groupe par valeur de dimension. Les appels et occurrences sont
// comptés en distinct dans chaque groupe ; les quantités et coûts additionnent les
// articles du groupe (chaque article n'appartient qu'à un groupe).
export default function SummaryView({ result, config, t, lang }) {
  const dims = config.summary?.dims || []
  const hasTheme = result.compiled.hasTheme
  const groups = useMemo(() => (dims.length ? summarize(result.matched, result.scopeRows, dims, { hasTheme }) : []), [result, dims, hasTheme])

  if (!dims.length) return <div className="flex-1 bg-white dark:bg-[#0D1117]"><EmptyState icon="ti-chart-histogram" message={t('reports.summary.choose_hint')} /></div>
  if (!result.matched.length) return <div className="flex-1 bg-white dark:bg-[#0D1117]"><EmptyState icon="ti-filter-off" message={t('reports.table.no_results')} /></div>

  const money = (m, k) => (m.measures[k].sum === null ? '—' : formatMoney(m.measures[k].sum, lang))
  const tot = result.metrics
  const th = 'px-3 py-2 border-b border-gray-200 dark:border-gray-700/60 text-[11px] font-medium uppercase tracking-wide text-gray-500'
  const td = 'px-3 py-1.5 text-right font-mono tabular-nums'

  return (
    <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0 z-10">
          <tr>
            {dims.map((d, i) => (
              <th key={i} className={`${th} text-left whitespace-nowrap`} title={dimLabel(d, t)}>
                {d.time ? t(`reports.time.${d.time}`) : t(`reports.fields.${d.field}`)}
              </th>
            ))}
            <th className={`${th} text-right`}>{t('reports.kpi.calls')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.occurrences')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.articles')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.affected_qty')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.cost_furniture')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.cost_freight')}</th>
            <th className={`${th} text-right`}>{t('reports.kpi.cost_net')}</th>
            {hasTheme && <th className={`${th} text-right`} title={t('reports.kpi.share_note')}>{t('reports.summary.share_group')}</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.key} className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 text-gray-700 dark:text-gray-300">
              {dims.map((d, i) => <td key={i} className="px-3 py-1.5 whitespace-nowrap">{dimValueLabel(d, g.values[i], t)}</td>)}
              <td className={td}>{formatInt(g.metrics.calls, lang)}</td>
              <td className={td}>{formatInt(g.metrics.occurrences, lang)}</td>
              <td className={td}>{formatInt(g.metrics.articles + g.metrics.headerRows, lang)}</td>
              <td className={td}>{g.metrics.measures.affected_qty.sum === null ? '—' : formatInt(g.metrics.measures.affected_qty.sum, lang)}</td>
              <td className={td}>{money(g.metrics, 'cost_furniture')}</td>
              <td className={td}>{money(g.metrics, 'cost_freight')}</td>
              <td className={td}>{money(g.metrics, 'cost_net')}</td>
              {hasTheme && <td className={td} title={t('reports.summary.share_of', { calls: g.metrics.calls, scope: g.scopeCalls })}>{g.share === null ? '—' : formatPct(g.share, lang)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 dark:bg-[#161B22] sticky bottom-0 font-semibold text-gray-900 dark:text-gray-100">
          <tr>
            <td className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-[11px] uppercase tracking-wide text-gray-500" colSpan={dims.length}>{t('reports.summary.total')}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{formatInt(tot.calls, lang)}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{formatInt(tot.occurrences, lang)}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{formatInt(tot.articles + tot.headerRows, lang)}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{tot.measures.affected_qty.sum === null ? '—' : formatInt(tot.measures.affected_qty.sum, lang)}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{money(tot, 'cost_furniture')}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{money(tot, 'cost_freight')}</td>
            <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{money(tot, 'cost_net')}</td>
            {hasTheme && <td className={`${td} border-t border-gray-200 dark:border-gray-700`}>{result.share === null ? '—' : formatPct(result.share, lang)}</td>}
          </tr>
        </tfoot>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-400">{t('reports.summary.total_note')}</p>
    </div>
  )
}
