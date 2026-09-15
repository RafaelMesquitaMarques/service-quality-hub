import { useState } from 'react'
import { FIELD_MAP } from '../engine/fields.js'
import { isConditionComplete, isTextualCondition } from '../engine/filters.js'
import ValuePicker from './ValuePicker'

// Saisie de termes (recherche textuelle) : Entrée, virgule ou collage multiple.
function TermsInput({ terms, onChange, t }) {
  const [draft, setDraft] = useState('')
  const list = terms || []
  const add = (raw) => {
    const parts = String(raw).split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    onChange([...new Set([...list, ...parts])])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {list.map(term => (
          <span key={term} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            {term}
            <button type="button" onClick={() => onChange(list.filter(x => x !== term))} className="bg-transparent border-0 p-0 cursor-pointer text-amber-600 hover:text-amber-900" aria-label={t('common.delete')}>
              <i className="ti ti-x text-[10px]" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <input className="input text-xs py-1" value={draft} placeholder={t('reports.terms.placeholder')}
        onChange={e => { const v = e.target.value; if (/[,;]/.test(v)) add(v); else setDraft(v) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } else if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1)) }}
        onBlur={() => add(draft)}
        onPaste={e => { const text = e.clipboardData.getData('text'); if (/[,;\n]/.test(text)) { e.preventDefault(); add(text) } }} />
      <p className="text-[11px] text-gray-400">{t('reports.terms.hint')}</p>
    </div>
  )
}

function RangeInputs({ field, cond, onChange, t }) {
  const type = ['date', 'datetime', 'list'].includes(field.kind) ? 'date' : 'number'
  const set = (k, v) => onChange({ ...cond, [k]: v === '' ? null : (type === 'number' ? Number(v) : v) })
  const suffix = field.kind === 'pct' ? '%' : field.kind === 'money' ? '$' : ''
  return (
    <div className="grid grid-cols-2 gap-2">
      {['min', 'max'].map(k => (
        <label key={k} className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">{t(`reports.range.${type === 'date' ? (k === 'min' ? 'from' : 'to') : k}`)}{suffix ? ` (${suffix})` : ''}</span>
          <input type={type} className="input text-xs py-1" value={cond[k] ?? ''} step={type === 'number' ? 'any' : undefined}
            onChange={e => set(k, e.target.value)} />
        </label>
      ))}
    </div>
  )
}

export default function ConditionEditor({ cond, onChange, onRemove, getOptions, t }) {
  const field = FIELD_MAP[cond.field]
  if (!field) return null
  const complete = isConditionComplete(cond)
  const textual = isTextualCondition(cond)

  const changeOp = (op) => {
    const next = { id: cond.id, field: cond.field, op }
    if (['in', 'not_in'].includes(op)) next.values = cond.values || []
    if (['contains_any', 'not_contains_any'].includes(op)) next.terms = cond.terms || []
    if (op === 'between') { next.min = cond.min ?? null; next.max = cond.max ?? null }
    onChange(next)
  }

  return (
    <div className={`rounded-lg border p-2.5 flex flex-col gap-2 ${complete ? 'border-gray-200 dark:border-gray-700' : 'border-amber-300 dark:border-amber-700'} bg-white dark:bg-[#161B22]`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
            <span className="truncate">{t(`reports.fields.${field.id}`)}</span>
            <i className="ti ti-info-circle text-gray-300 dark:text-gray-600 text-xs cursor-help" title={t(`reports.help.${field.id}`)} aria-hidden="true" />
          </div>
          <span className={`inline-block mt-0.5 text-[10px] px-1.5 rounded ${textual ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
            {textual ? t('reports.textual') : t('reports.structured')}
          </span>
        </div>
        <select className="input text-xs py-1 w-auto max-w-[48%]" value={cond.op} onChange={e => changeOp(e.target.value)} aria-label={t('reports.filters.operator')}>
          {field.ops.map(op => <option key={op} value={op}>{t(`reports.ops.${op}`)}</option>)}
        </select>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500 bg-transparent border-0 p-0.5 cursor-pointer" title={t('reports.filters.remove')} aria-label={t('reports.filters.remove')}>
          <i className="ti ti-trash text-sm" aria-hidden="true" />
        </button>
      </div>

      {['in', 'not_in'].includes(cond.op) && (
        <ValuePicker field={field} options={getOptions(field.id)} selected={cond.values} t={t}
          onChange={values => onChange({ ...cond, values })} />
      )}
      {textual && <TermsInput terms={cond.terms} t={t} onChange={terms => onChange({ ...cond, terms })} />}
      {cond.op === 'between' && <RangeInputs field={field} cond={cond} onChange={onChange} t={t} />}

      {!complete && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
          <i className="ti ti-alert-triangle text-xs" aria-hidden="true" /> {t('reports.incomplete_ignored')}
        </p>
      )}
    </div>
  )
}
