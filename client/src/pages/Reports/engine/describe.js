// Descriptions lisibles des critères (puces de filtres actifs, onglet Paramètres).

import { EMPTY, PERIOD_FIELDS } from './constants.js'
import { FIELD_MAP, valueLabel } from './fields.js'
import { cleanTerms } from './text.js'

export const fieldLabel = (id, t) => t(`reports.fields.${id}`)

export function groupLabel(group, t) {
  if (group?.label) return group.label
  if (group?.labelKey) return t(group.labelKey)
  return t('reports.group_untitled')
}

const valueText = (field, v, t) => (v === EMPTY ? t('reports.empty') : valueLabel(field, v, t))

export function describeCondition(cond, t) {
  const field = FIELD_MAP[cond?.field]
  if (!field) return ''
  const name = fieldLabel(field.id, t)
  const unit = (x) => (field.kind === 'pct' ? `${x} %` : field.kind === 'money' ? `$${x}` : x)
  switch (cond.op) {
    case 'in':      return t('reports.ops_desc.in', { field: name, values: (cond.values || []).map(v => valueText(field, v, t)).join(', ') })
    case 'not_in':  return t('reports.ops_desc.not_in', { field: name, values: (cond.values || []).map(v => valueText(field, v, t)).join(', ') })
    case 'contains_any':     return t('reports.ops_desc.contains_any', { field: name, terms: cleanTerms(cond.terms).map(x => `« ${x} »`).join(', ') })
    case 'not_contains_any': return t('reports.ops_desc.not_contains_any', { field: name, terms: cleanTerms(cond.terms).map(x => `« ${x} »`).join(', ') })
    case 'empty':     return t('reports.ops_desc.empty', { field: name })
    case 'not_empty': return t('reports.ops_desc.not_empty', { field: name })
    case 'between': {
      const hasMin = cond.min !== null && cond.min !== undefined && cond.min !== ''
      const hasMax = cond.max !== null && cond.max !== undefined && cond.max !== ''
      if (hasMin && hasMax) return t('reports.ops_desc.between', { field: name, min: unit(cond.min), max: unit(cond.max) })
      if (hasMin) return t('reports.ops_desc.gte', { field: name, min: unit(cond.min) })
      if (hasMax) return t('reports.ops_desc.lte', { field: name, max: unit(cond.max) })
      return name
    }
    default: return name
  }
}

export function describePeriod(period, resolved, t) {
  if (!resolved) return t('reports.period.none_desc')
  const field = fieldLabel(resolved.field, t)
  const range = `${resolved.from || '…'} → ${resolved.to || '…'}`
  const kind = period.mode === 'relative' ? t(`reports.period.presets.${period.preset}`) : t('reports.period.fixed')
  return `${field} : ${range} (${kind})`
}

export const periodFieldOptions = () => PERIOD_FIELDS

export function describeSort(sort, t) {
  if (!sort?.length) return t('reports.sort.default')
  return sort.map(s => `${fieldLabel(s.field, t)} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', ')
}
