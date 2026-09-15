import { useState } from 'react'
import { PERIOD_FIELDS, RELATIVE_PRESETS, GRANULARITIES, TIME_BUCKETS } from '../engine/constants.js'
import { FIELD_MAP, GROUPABLE_FIELDS } from '../engine/fields.js'
import { isConditionComplete, isTextualCondition } from '../engine/filters.js'
import { groupLabel } from '../engine/describe.js'
import { newId } from '../engine/templates.js'
import ConditionEditor from './ConditionEditor'
import FieldPicker from './FieldPicker'

// Filtres proposés en raccourci (priorités exprimées par les utilisateurs).
const QUICK_FILTERS = ['category', 'department', 'plant', 'root_cause', 'status', 'ship_to', 'sold_to', 'project_name',
  'item', 'foliot_id', 'created_by_name', 'affected_qty', 'cost_net', 'text_line']

const defaultCondition = (fieldId) => {
  const field = FIELD_MAP[fieldId]
  const op = field.ops[0]
  const c = { id: newId('c'), field: fieldId, op }
  if (op === 'in' || op === 'not_in') c.values = []
  if (op === 'contains_any') c.terms = []
  if (op === 'between') { c.min = null; c.max = null }
  return c
}

export function Section({ step, icon, title, subtitle, right, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer text-left">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{step}</span>
          <i className={`ti ${icon} text-blue-500 text-sm`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</span>
            {subtitle && <span className="block text-[11px] text-gray-400 truncate">{subtitle}</span>}
          </span>
          <i className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'} text-gray-400 text-xs ml-auto`} aria-hidden="true" />
        </button>
        {right}
      </div>
      {open && <div className="px-4 pb-4 flex flex-col gap-2.5">{children}</div>}
    </section>
  )
}

// ── ① Période ────────────────────────────────────────────────────────────────
export function PeriodSection({ period, resolved, fillRate, onChange, t }) {
  const set = (patch) => onChange({ ...period, ...patch })
  const none = period.mode === 'none'
  return (
    <Section step={1} icon="ti-calendar" title={t('reports.period.title')}
      subtitle={resolved ? `${resolved.from || '…'} → ${resolved.to || '…'}` : t('reports.period.none_desc')}>
      <label className="flex flex-col gap-1">
        <span className="label mb-0">{t('reports.period.date_field')}</span>
        <select className="input text-xs" value={none ? 'none' : period.field}
          onChange={e => (e.target.value === 'none' ? set({ mode: 'none' }) : set({ field: e.target.value, mode: none ? 'relative' : period.mode }))}>
          {PERIOD_FIELDS.map(f => <option key={f} value={f}>{t(`reports.fields.${f}`)}</option>)}
          <option value="none">{t('reports.period.no_period')}</option>
        </select>
        <span className="text-[11px] text-gray-400">{t('reports.period.date_field_hint')}</span>
      </label>
      {!none && (
        <>
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden self-start">
            {['relative', 'fixed'].map(m => (
              <button key={m} type="button" onClick={() => set({ mode: m })}
                className={`text-xs px-3 py-1 border-0 cursor-pointer ${period.mode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300'}`}>
                {t(`reports.period.${m}`)}
              </button>
            ))}
          </div>
          {period.mode === 'relative' ? (
            <select className="input text-xs" value={period.preset} onChange={e => set({ preset: e.target.value })}>
              {RELATIVE_PRESETS.map(p => <option key={p} value={p}>{t(`reports.period.presets.${p}`)}</option>)}
            </select>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-gray-400">{t('reports.range.from')}</span>
                <input type="date" className="input text-xs py-1" value={period.from || ''} onChange={e => set({ from: e.target.value || null })} />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-gray-400">{t('reports.range.to')}</span>
                <input type="date" className="input text-xs py-1" value={period.to || ''} onChange={e => set({ to: e.target.value || null })} />
              </label>
            </div>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {resolved ? t('reports.period.resolved', { from: resolved.from || '…', to: resolved.to || '…' }) : t('reports.period.invalid')}
            {' '}{t('reports.period.inclusive')}
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" className="accent-blue-600" checked={!!period.includeEmpty} onChange={e => set({ includeEmpty: e.target.checked })} />
            {t('reports.period.include_empty')}
          </label>
          {fillRate && fillRate.rate < 0.9 && (
            <p className="text-[11px] rounded-lg px-2 py-1.5 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 flex gap-1.5">
              <i className="ti ti-alert-triangle text-xs mt-0.5" aria-hidden="true" />
              <span>{t('reports.period.fill_warning', { field: t(`reports.fields.${period.field}`), pct: Math.round(fillRate.rate * 100), filled: fillRate.filled, total: fillRate.total })}</span>
            </p>
          )}
        </>
      )}
    </Section>
  )
}

// ── ② Filtres (ET) ───────────────────────────────────────────────────────────
export function FiltersSection({ filters, onChange, getOptions, t }) {
  const [picking, setPicking] = useState(false)
  const add = (fieldId) => { onChange([...filters, defaultCondition(fieldId)]); setPicking(false) }
  const active = filters.filter(isConditionComplete).length
  return (
    <Section step={2} icon="ti-filter" title={t('reports.filters.title')}
      subtitle={active ? t('reports.filters.active_count', { count: active }) : t('reports.filters.none')}
      right={filters.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-[11px] text-red-500 bg-transparent border-0 cursor-pointer hover:underline">{t('reports.filters.clear')}</button>
      )}>
      <p className="text-[11px] text-gray-400">{t('reports.filters.logic')}</p>
      {filters.map(c => (
        <ConditionEditor key={c.id} cond={c} getOptions={getOptions} t={t}
          onChange={next => onChange(filters.map(x => (x.id === c.id ? next : x)))}
          onRemove={() => onChange(filters.filter(x => x.id !== c.id))} />
      ))}
      <div className="flex flex-wrap gap-1">
        {QUICK_FILTERS.map(id => (
          <button key={id} type="button" onClick={() => add(id)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 cursor-pointer">
            + {t(`reports.fields.${id}`)}
          </button>
        ))}
      </div>
      <button type="button" className="btn-ghost text-xs self-start" onClick={() => setPicking(true)}>
        <i className="ti ti-list-search" aria-hidden="true" /> {t('reports.filters.add_other')}
      </button>
      {picking && <FieldPicker mode="filter" t={t} onPick={add} onClose={() => setPicking(false)} />}
    </Section>
  )
}

// ── ③ Critères thématiques (groupes OU) ──────────────────────────────────────
export function GroupsSection({ groups, onChange, getOptions, groupCounts, t }) {
  const [pickingFor, setPickingFor] = useState(null)
  const update = (id, patch) => onChange(groups.map(g => (g.id === id ? { ...g, ...patch } : g)))
  const enabled = groups.filter(g => g.enabled !== false && (g.conditions || []).some(isConditionComplete)).length
  return (
    <Section step={3} icon="ti-topology-star-3" title={t('reports.groups.title')}
      subtitle={enabled ? t('reports.groups.active_count', { count: enabled }) : t('reports.groups.none')}>
      <p className="text-[11px] text-gray-400">{t('reports.groups.logic')}</p>
      {groups.map((g, gi) => {
        const complete = (g.conditions || []).filter(isConditionComplete)
        const textual = complete.some(isTextualCondition)
        const isOn = g.enabled !== false
        return (
          <div key={g.id} className={`rounded-lg border ${isOn ? 'border-blue-200 dark:border-blue-900' : 'border-gray-200 dark:border-gray-700 opacity-80'} bg-gray-50/60 dark:bg-[#0D1117] p-2.5 flex flex-col gap-2`}>
            {gi > 0 && <div className="-mt-5 mb-0.5 self-center text-[10px] font-semibold px-2 rounded-full bg-white dark:bg-[#161B22] border border-gray-200 dark:border-gray-700 text-gray-500">{t('reports.groups.or')}</div>}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer" title={t('reports.groups.toggle')}>
                <input type="checkbox" className="accent-blue-600" checked={isOn} onChange={e => update(g.id, { enabled: e.target.checked })} />
              </label>
              <input className="input text-xs py-1 flex-1 font-medium" value={g.label || (g.labelKey ? groupLabel(g, t) : '')}
                placeholder={t('reports.group_untitled')}
                onChange={e => update(g.id, { label: e.target.value, labelKey: undefined })} aria-label={t('reports.groups.name')} />
              <button type="button" onClick={() => onChange(groups.filter(x => x.id !== g.id))} className="text-gray-400 hover:text-red-500 bg-transparent border-0 p-0.5 cursor-pointer" aria-label={t('reports.groups.remove')} title={t('reports.groups.remove')}>
                <i className="ti ti-trash text-sm" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`px-1.5 rounded ${textual ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                {textual ? t('reports.groups.kind_textual') : t('reports.groups.kind_structured')}
              </span>
              {groupCounts?.[g.id] !== undefined && (
                <span className="text-gray-500 dark:text-gray-400">{t('reports.groups.matches', { count: groupCounts[g.id] })}</span>
              )}
              {!isOn && <span className="text-gray-400 italic">{t('reports.groups.disabled')}</span>}
            </div>
            {(g.conditions || []).map((c, ci) => (
              <div key={c.id} className="flex flex-col gap-1">
                {ci > 0 && <span className="text-[10px] font-semibold text-gray-400 self-start">{t('reports.groups.and')}</span>}
                <ConditionEditor cond={c} getOptions={getOptions} t={t}
                  onChange={next => update(g.id, { conditions: g.conditions.map(x => (x.id === c.id ? next : x)) })}
                  onRemove={() => update(g.id, { conditions: g.conditions.filter(x => x.id !== c.id) })} />
              </div>
            ))}
            <button type="button" className="btn-ghost text-xs self-start py-1" onClick={() => setPickingFor(g.id)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('reports.groups.add_condition')}
            </button>
          </div>
        )
      })}
      <button type="button" className="btn-ghost text-xs self-start"
        onClick={() => onChange([...groups, { id: newId('g'), label: t('reports.groups.new_name', { n: groups.length + 1 }), enabled: true, conditions: [] }])}>
        <i className="ti ti-plus" aria-hidden="true" /> {t('reports.groups.add')}
      </button>
      {pickingFor && (
        <FieldPicker mode="filter" t={t} onClose={() => setPickingFor(null)}
          onPick={fieldId => {
            const g = groups.find(x => x.id === pickingFor)
            if (g) update(g.id, { conditions: [...(g.conditions || []), defaultCondition(fieldId)] })
            setPickingFor(null)
          }} />
      )}
    </Section>
  )
}

// ── ④ Colonnes et tri ────────────────────────────────────────────────────────
export function ColumnsSection({ columns, sort, onColumns, onSort, onReset, t }) {
  const [picking, setPicking] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)
  const move = (from, to) => {
    if (to < 0 || to >= columns.length || from === to) return
    const next = columns.slice()
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    onColumns(next)
  }
  const toggle = (id) => onColumns(columns.includes(id) ? columns.filter(c => c !== id) : [...columns, id])
  const primary = sort[0] || null
  const secondary = sort[1] || null
  const setSortAt = (i, patch) => {
    const next = [primary, secondary].map(s => s && { ...s })
    next[i] = patch ? { ...(next[i] || { dir: 'desc' }), ...patch } : null
    onSort(next.filter(s => s && s.field))
  }
  const sortable = columns.filter(id => FIELD_MAP[id] && FIELD_MAP[id].id !== 'matched_criteria')

  return (
    <Section step={4} icon="ti-columns-3" title={t('reports.columns.title')} subtitle={t('reports.columns.count', { count: columns.length })}
      right={onReset && <button type="button" onClick={onReset} className="text-[11px] text-gray-500 bg-transparent border-0 cursor-pointer hover:underline">{t('reports.columns.reset')}</button>}>
      <p className="text-[11px] text-gray-400">{t('reports.columns.hint')}</p>
      <ol className="flex flex-col gap-1">
        {columns.map((id, i) => (
          <li key={id} draggable
            onDragStart={() => setDragIndex(i)} onDragOver={e => e.preventDefault()}
            onDrop={() => { if (dragIndex !== null) move(dragIndex, i); setDragIndex(null) }} onDragEnd={() => setDragIndex(null)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs bg-white dark:bg-[#161B22] ${dragIndex === i ? 'border-blue-400 opacity-60' : 'border-gray-200 dark:border-gray-700'}`}>
            <i className="ti ti-grip-vertical text-gray-300 cursor-grab" aria-hidden="true" />
            <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200">{t(`reports.fields.${id}`)}</span>
            <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 bg-transparent border-0 p-0 cursor-pointer" aria-label={t('reports.columns.up')}><i className="ti ti-arrow-up text-xs" aria-hidden="true" /></button>
            <button type="button" onClick={() => move(i, i + 1)} disabled={i === columns.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 bg-transparent border-0 p-0 cursor-pointer" aria-label={t('reports.columns.down')}><i className="ti ti-arrow-down text-xs" aria-hidden="true" /></button>
            <button type="button" onClick={() => toggle(id)} disabled={columns.length === 1} className="text-gray-400 hover:text-red-500 disabled:opacity-30 bg-transparent border-0 p-0 cursor-pointer" aria-label={t('reports.columns.hide')} title={t('reports.columns.hide')}><i className="ti ti-eye-off text-xs" aria-hidden="true" /></button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn-ghost text-xs self-start" onClick={() => setPicking(true)}>
        <i className="ti ti-columns" aria-hidden="true" /> {t('reports.columns.manage')}
      </button>

      <div className="mt-1 flex flex-col gap-1.5">
        <span className="label mb-0">{t('reports.sort.title')}</span>
        {[primary, secondary].map((s, i) => (i === 1 && !primary ? null : (
          <div key={i} className="flex gap-1.5">
            <select className="input text-xs py-1 flex-1" value={s?.field || ''} onChange={e => setSortAt(i, e.target.value ? { field: e.target.value } : null)}>
              <option value="">{i === 0 ? t('reports.sort.default') : t('reports.sort.none_secondary')}</option>
              {sortable.map(id => <option key={id} value={id}>{t(`reports.fields.${id}`)}</option>)}
            </select>
            {s && (
              <button type="button" className="btn-ghost text-xs py-1 px-2" onClick={() => setSortAt(i, { dir: s.dir === 'asc' ? 'desc' : 'asc' })}
                title={s.dir === 'asc' ? t('reports.sort.asc') : t('reports.sort.desc')}>
                <i className={`ti ${s.dir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending'}`} aria-hidden="true" />
              </button>
            )}
          </div>
        )))}
      </div>
      {picking && <FieldPicker mode="column" selected={columns} onToggle={toggle} onClose={() => setPicking(false)} t={t} />}
    </Section>
  )
}

// ── ⑤ Affichage ──────────────────────────────────────────────────────────────
export function DisplaySection({ config, onChange, t }) {
  const dateField = config.period.mode === 'none' ? 'issue_reception_date' : config.period.field
  const dimOptions = [
    ...TIME_BUCKETS.map(b => ({ value: `time:${b}`, label: `${t(`reports.time.${b}`)} (${t(`reports.fields.${dateField}`)})` })),
    ...GROUPABLE_FIELDS.map(id => ({ value: `field:${id}`, label: t(`reports.fields.${id}`) })),
  ]
  const encode = (d) => (d ? (d.time ? `time:${d.time}` : `field:${d.field}`) : '')
  const decode = (v) => {
    if (!v) return null
    const [kind, key] = v.split(':')
    return kind === 'time' ? { field: dateField, time: key } : { field: key }
  }
  const dims = config.summary?.dims || []
  const setDim = (i, v) => {
    const next = [dims[0] || null, dims[1] || null]
    next[i] = decode(v)
    onChange({ summary: { dims: next.filter(Boolean) } })
  }
  return (
    <Section step={5} icon="ti-layout-dashboard" title={t('reports.display.title')} subtitle={t(`reports.view.${config.view}`)}>
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden self-start">
        {['detail', 'summary'].map(v => (
          <button key={v} type="button" onClick={() => onChange({ view: v })}
            className={`text-xs px-3 py-1 border-0 cursor-pointer ${config.view === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300'}`}>
            <i className={`ti ${v === 'detail' ? 'ti-table' : 'ti-chart-histogram'} mr-1`} aria-hidden="true" />{t(`reports.view.${v}`)}
          </button>
        ))}
      </div>

      {config.view === 'detail' ? (
        <label className="flex flex-col gap-1">
          <span className="label mb-0">{t('reports.granularity.title')}</span>
          <select className="input text-xs" value={config.granularity} onChange={e => onChange({ granularity: e.target.value })}>
            {GRANULARITIES.map(g => <option key={g} value={g}>{t(`reports.granularity.${g}`)}</option>)}
          </select>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{t(`reports.granularity.${config.granularity}_desc`)}</span>
        </label>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="label mb-0">{t('reports.summary.group_by')}</span>
          {[0, 1].map(i => (
            <select key={i} className="input text-xs" value={encode(dims[i])} onChange={e => setDim(i, e.target.value)} disabled={i === 1 && !dims[0]}>
              <option value="">{i === 0 ? t('reports.summary.choose') : t('reports.summary.no_second')}</option>
              {dimOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{t('reports.summary.hint')}</span>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" className="accent-blue-600" checked={config.indicators !== false} onChange={e => onChange({ indicators: e.target.checked })} />
        {t('reports.display.show_indicators')}
      </label>
    </Section>
  )
}
