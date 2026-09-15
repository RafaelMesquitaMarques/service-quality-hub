import { useMemo, useState } from 'react'
import { EMPTY } from '../engine/constants.js'
import { valueLabel } from '../engine/fields.js'
import { normalizeText } from '../engine/text.js'

const MAX_SHOWN = 200

// Sélection multiple (OU) avec recherche, compteurs et « (Non renseigné) ».
export default function ValuePicker({ field, options, selected, onChange, t }) {
  const [query, setQuery] = useState('')
  const sel = useMemo(() => new Set((selected || []).map(String)), [selected])
  const labelOf = (o) => (o.value === EMPTY ? t('reports.empty') : valueLabel(field, o.value, t))
  const filtered = useMemo(() => {
    const q = normalizeText(query)
    return q ? options.filter(o => normalizeText(labelOf(o)).includes(q)) : options
  }, [options, query, t])
  const shown = filtered.slice(0, MAX_SHOWN)

  const toggle = (value) => {
    const next = new Set(sel)
    next.has(value) ? next.delete(value) : next.add(value)
    onChange([...next])
  }
  const selectShown = () => onChange([...new Set([...sel, ...filtered.map(o => o.value)])])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-[#0D1117]">
        <i className="ti ti-search text-gray-400 text-xs" aria-hidden="true" />
        <input className="outline-none text-xs w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
          value={query} onChange={e => setQuery(e.target.value)} placeholder={t('reports.picker.search')} />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 p-0 cursor-pointer" aria-label={t('common.close')}>
            <i className="ti ti-x text-xs" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <span>{t('reports.picker.selected', { count: sel.size })}</span>
        <span className="flex gap-2">
          <button type="button" onClick={selectShown} className="text-blue-600 dark:text-blue-400 bg-transparent border-0 p-0 cursor-pointer hover:underline">
            {query ? t('reports.picker.select_matches') : t('reports.picker.select_all')}
          </button>
          {sel.size > 0 && (
            <button type="button" onClick={() => onChange([])} className="text-red-500 bg-transparent border-0 p-0 cursor-pointer hover:underline">
              {t('reports.picker.clear')}
            </button>
          )}
        </span>
      </div>
      <div className="flex justify-between px-2 text-[10px] uppercase tracking-wide text-gray-400">
        <span>{t('reports.picker.value_col')}</span>
        <span title={t('reports.picker.count_tip')}>{t('reports.picker.count_col')}</span>
      </div>
      <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 py-0.5">
        {shown.length === 0 && <div className="px-2 py-2 text-xs text-gray-400 italic">{t('reports.picker.no_values')}</div>}
        {shown.map(o => (
          <label key={o.value} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
            <input type="checkbox" className="accent-blue-600 cursor-pointer" checked={sel.has(o.value)} onChange={() => toggle(o.value)} />
            <span className={`flex-1 min-w-0 truncate ${o.value === EMPTY ? 'italic text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200'}`} title={labelOf(o)}>
              {labelOf(o)}
            </span>
            {o.outOfReferential && (
              <span className="text-[10px] px-1.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap" title={t('reports.picker.out_of_referential_tip')}>
                {t('reports.picker.out_of_referential')}
              </span>
            )}
            <span className={`font-mono text-[11px] tabular-nums ${o.count ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>{o.count}</span>
          </label>
        ))}
        {filtered.length > MAX_SHOWN && (
          <div className="px-2 py-1.5 text-[11px] text-gray-400 italic">{t('reports.picker.refine', { shown: MAX_SHOWN, total: filtered.length })}</div>
        )}
      </div>
    </div>
  )
}
