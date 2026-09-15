import { useEffect, useMemo, useState } from 'react'
import { FIELDS, FIELD_GROUPS } from '../engine/fields.js'
import { normalizeText } from '../engine/text.js'

// Catalogue des champs par sujet (fenêtre modale).
// mode 'filter' : champs filtrables ; mode 'column' : colonnes affichables, avec
// cases à cocher pour afficher / masquer (selected).
export default function FieldPicker({ mode, selected = [], onPick, onToggle, onClose, t }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = useMemo(() => {
    const q = normalizeText(query)
    return FIELD_GROUPS.map(g => ({
      group: g,
      fields: FIELDS.filter(f => f.group === g)
        .filter(f => (mode === 'filter' ? !f.columnOnly && f.ops.length : !f.filterOnly))
        .filter(f => !q || normalizeText(`${t(`reports.fields.${f.id}`)} ${t(`reports.help.${f.id}`)}`).includes(q)),
    })).filter(g => g.fields.length)
  }, [mode, query, t])
  const sel = new Set(selected)

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}
        className="bg-white dark:bg-[#161B22] rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {mode === 'filter' ? t('reports.picker.add_filter_title') : t('reports.picker.columns_title')}
            </h2>
            <p className="text-[11px] text-gray-400">{mode === 'filter' ? t('reports.picker.add_filter_sub') : t('reports.picker.columns_sub')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer" aria-label={t('common.close')}>
            <i className="ti ti-x text-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-[#0D1117]">
            <i className="ti ti-search text-gray-400 text-sm" aria-hidden="true" />
            <input autoFocus className="outline-none text-sm w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              value={query} onChange={e => setQuery(e.target.value)} placeholder={t('reports.picker.search_fields')} />
          </div>
        </div>
        <div className="overflow-y-auto px-4 py-3 grid gap-4 sm:grid-cols-2">
          {groups.map(({ group, fields }) => (
            <section key={group}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{t(`reports.groups_fields.${group}`)}</h3>
              <ul className="flex flex-col">
                {fields.map(f => (
                  <li key={f.id}>
                    {mode === 'column' ? (
                      <label className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                        <input type="checkbox" className="accent-blue-600 mt-0.5 cursor-pointer" checked={sel.has(f.id)} onChange={() => onToggle(f.id)} />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-gray-800 dark:text-gray-100">{t(`reports.fields.${f.id}`)}</span>
                          <span className="block text-[11px] text-gray-400 leading-snug">{t(`reports.help.${f.id}`)}</span>
                        </span>
                      </label>
                    ) : (
                      <button type="button" onClick={() => onPick(f.id)}
                        className="w-full text-left flex flex-col px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 bg-transparent border-0 cursor-pointer">
                        <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{t(`reports.fields.${f.id}`)}</span>
                        <span className="text-[11px] text-gray-400 leading-snug">{t(`reports.help.${f.id}`)}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && <p className="text-xs text-gray-400 italic">{t('reports.picker.no_fields')}</p>}
        </div>
        {mode === 'column' && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
            <button type="button" className="btn-primary" onClick={onClose}>{t('reports.picker.done')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
