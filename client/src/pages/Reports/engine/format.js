// Mise en forme des valeurs : affichage (tableau, CSV) et cellules typées (Excel).
// Une valeur absente n'est jamais rendue « 0 » : chaîne vide à l'export, « — » à l'écran.

import { FIELD_MAP, valueLabel } from './fields.js'
import { localDateOf } from './filters.js'

const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const locale = (lang) => (lang === 'en' ? 'en-CA' : 'fr-CA')

export function formatMoney(n, lang = 'fr') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return ''
  const v = Number(n)
  const s = Math.abs(v).toLocaleString(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? '−' : ''}$${s}`
}
export function formatInt(n, lang = 'fr') {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return ''
  return Number(n).toLocaleString(locale(lang), { maximumFractionDigits: 2 })
}
export function formatPct(x, lang = 'fr', digits = 1) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return ''
  return `${(Number(x) * 100).toLocaleString(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}
export function formatDateTimeLocal(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Texte affiché d'une cellule.
export function displayValue(fieldOrId, value, { t, lang = 'fr' }) {
  const field = typeof fieldOrId === 'string' ? FIELD_MAP[fieldOrId] : fieldOrId
  if (isEmptyValue(value)) return ''
  if (Array.isArray(value)) return value.map(v => displayValue(field, v, { t, lang })).filter(Boolean).join('; ')
  if (field?.id === 'occurrence_no') return `#${value}`
  switch (field?.kind) {
    case 'enum': case 'bool': return valueLabel(field, value, t)
    case 'money': return formatMoney(value, lang)
    case 'int': return formatInt(value, lang)
    case 'pct': return formatPct(value, lang)
    case 'datetime': return formatDateTimeLocal(value)
    case 'date': return localDateOf(value)
    default: return String(value)
  }
}

// Cellule typée pour l'export Excel. Types :
//   s (texte) · n (nombre, style int|money|pct) · d (date seule « YYYY-MM-DD ») · dt (horodatage)
export function exportCell(fieldOrId, value, { t, lang = 'fr' }) {
  const field = typeof fieldOrId === 'string' ? FIELD_MAP[fieldOrId] : fieldOrId
  if (isEmptyValue(value)) return null
  if (Array.isArray(value)) {
    if (value.length === 1) return exportCell(field, value[0], { t, lang })
    return { t: 's', v: displayValue(field, value, { t, lang }) }
  }
  switch (field?.kind) {
    case 'int':   return { t: 'n', v: Number(value), s: 'int' }
    case 'money': return { t: 'n', v: Number(value), s: 'money' }
    case 'pct':   return { t: 'n', v: Number(value), s: 'pct' }
    case 'date':  return { t: 'd', v: localDateOf(value) }
    case 'datetime': return { t: 'dt', v: String(value) }
    case 'enum': case 'bool': return { t: 's', v: valueLabel(field, value, t) }
    // Identifiants et codes : toujours du texte (zéros en tête préservés).
    default: return { t: 's', v: String(value) }
  }
}

// Valeur brute d'une cellule CSV (nombres avec « . », dates ISO).
export function csvValue(fieldOrId, value, ctx) {
  const cell = exportCell(fieldOrId, value, ctx)
  if (!cell) return ''
  if (cell.t === 'n') return String(cell.v)
  if (cell.t === 'dt') return formatDateTimeLocal(cell.v)
  return cell.v
}
