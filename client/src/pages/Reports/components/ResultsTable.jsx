import { Link } from 'react-router-dom'
import { FIELD_MAP } from '../engine/fields.js'
import { displayValue } from '../engine/format.js'
import { EmptyState } from '../../../components/ui'

export const PAGE_SIZE = 100
const RIGHT = ['int', 'money', 'pct']

function Cell({ field, rec, t, lang, textualLabels }) {
  const value = rec[field.id]
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  if (field.id === 'occurrence_no') {
    const links = (rec._occLinks || []).filter(l => l.no !== null && l.no !== undefined)
    if (!links.length) return <span className="text-gray-300 dark:text-gray-600" title={t('reports.empty')}>—</span>
    return (
      <span className="flex flex-wrap gap-x-1.5">
        {links.map(l => (
          <Link key={l.id} to={`/tickets/${l.id}`} target="_blank" rel="noopener noreferrer"
            className="font-mono text-blue-600 dark:text-blue-400 hover:underline" title={t('reports.table.open_occurrence')}>
            #{l.no}
          </Link>
        ))}
      </span>
    )
  }
  if (empty) return <span className="text-gray-300 dark:text-gray-600" title={t('reports.empty')}>—</span>
  if (field.id === 'matched_criteria') {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map(label => (
          <span key={label} className={`text-[10px] px-1.5 rounded whitespace-nowrap ${textualLabels.has(label) ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
            {label}
          </span>
        ))}
      </span>
    )
  }
  const text = displayValue(field, value, { t, lang })
  if (field.id === 'cost_split_status' && value === 'legacy_total') {
    return <span className="text-amber-700 dark:text-amber-300" title={t('reports.help.cost_split_status')}>{text}</span>
  }
  const long = field.kind === 'longtext' || field.kind === 'text'
  return <span className={long ? 'block max-w-[320px] truncate' : 'whitespace-nowrap'} title={long ? text : undefined}>{text}</span>
}

export default function ResultsTable({ result, config, page, onPage, onSortColumn, textualLabels, t, lang }) {
  const columns = config.columns.map(id => FIELD_MAP[id]).filter(Boolean)
  const records = result.records
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  // Page bornée : si le jeu de résultats rétrécit, on n'affiche jamais une page vide.
  page = Math.min(Math.max(1, page), pageCount)
  const start = (page - 1) * PAGE_SIZE
  const pageRecords = records.slice(start, start + PAGE_SIZE)
  const primary = config.sort?.[0]

  // Totaux de TOUS les résultats (pas de la page) : mesures de ligne additionnées
  // sur les articles retenus ; coût de l'occurrence compté une fois par occurrence.
  const totalFor = (field) => {
    if (field.agg === 'sum') return result.metrics.measures[field.id]?.sum ?? sumRecords(records, field.id)
    if (field.agg === 'occ_sum') {
      const seen = new Map()
      for (const r of result.matched) if (!seen.has(r.occurrence_id)) seen.set(r.occurrence_id, r[field.id])
      let s = null
      for (const v of seen.values()) if (v !== null && v !== undefined) s = (s || 0) + Number(v)
      return s
    }
    return undefined
  }
  const hasTotals = columns.some(f => ['sum', 'occ_sum'].includes(f.agg) && RIGHT.includes(f.kind) && f.kind !== 'pct')

  if (!records.length) {
    return (
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
        <EmptyState icon="ti-filter-off" message={t('reports.table.no_results')} />
        <p className="text-center text-xs text-gray-400 -mt-10 px-6">{t('reports.table.no_results_hint')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0 z-10">
            <tr>
              {columns.map(f => {
                const active = primary?.field === f.id
                return (
                  <th key={f.id} className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700/60 ${RIGHT.includes(f.kind) ? 'text-right' : 'text-left'}`}>
                    <button type="button" onClick={() => f.id !== 'matched_criteria' && onSortColumn(f.id)}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide bg-transparent border-0 p-0 ${f.id === 'matched_criteria' ? 'cursor-default text-gray-400' : 'cursor-pointer text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
                      title={t(`reports.help.${f.id}`)}>
                      <span className="whitespace-nowrap">{t(`reports.fields.${f.id}`)}</span>
                      {f.id !== 'matched_criteria' && (
                        <i className={`ti ${active ? (primary.dir === 'asc' ? 'ti-sort-ascending text-blue-500' : 'ti-sort-descending text-blue-500') : 'ti-selector text-gray-300'} text-xs`} aria-hidden="true" />
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRecords.map(rec => (
              <tr key={rec.row_key} className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10">
                {columns.map(f => (
                  <td key={f.id} className={`px-3 py-1.5 align-top text-gray-700 dark:text-gray-300 ${RIGHT.includes(f.kind) ? 'text-right font-mono tabular-nums' : ''}`}>
                    <Cell field={f} rec={rec} t={t} lang={lang} textualLabels={textualLabels} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot className="bg-gray-50 dark:bg-[#161B22] sticky bottom-0">
              <tr>
                {columns.map((f, i) => {
                  const total = RIGHT.includes(f.kind) && f.kind !== 'pct' ? totalFor(f) : undefined
                  return (
                    <td key={f.id} className={`px-3 py-2 border-t border-gray-200 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100 ${RIGHT.includes(f.kind) ? 'text-right font-mono tabular-nums' : ''}`}>
                      {i === 0 ? <span className="font-sans text-[11px] uppercase tracking-wide text-gray-500">{t('reports.table.total_all')}</span>
                        : total === undefined ? '' : total === null ? <span className="text-gray-300">—</span> : displayValue(f, total, { t, lang })}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="bg-white dark:bg-[#0D1117] border-t border-gray-200 dark:border-gray-700/60 px-4 py-2 flex flex-wrap gap-2 justify-between items-center text-xs text-gray-500 dark:text-gray-400">
        <span>{t('reports.table.showing', { from: start + 1, to: Math.min(start + PAGE_SIZE, records.length), total: records.length })}</span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs py-1" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('common.previous')}
            </button>
            <span>{page} / {pageCount}</span>
            <button className="btn-ghost text-xs py-1" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
              {t('common.next')} <i className="ti ti-arrow-right" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function sumRecords(records, id) {
  let s = null
  for (const r of records) if (r[id] !== null && r[id] !== undefined) s = (s || 0) + Number(r[id])
  return s
}
