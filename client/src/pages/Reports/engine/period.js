// Périodes : fixes (du / au) ou relatives (résolues à chaque exécution, donc
// toujours sur les données du jour). Toutes les bornes sont INCLUSIVES et
// comparées comme des chaînes « YYYY-MM-DD » — jamais via `new Date('YYYY-MM-DD')`,
// qui décale d'un jour en heure du Québec (voir utils/date.js).
//
// Calendrier fiscal Foliot : l'année fiscale N va du 1er décembre N-1 au
// 30 novembre N (décembre = mois fiscal 1 de l'année suivante, cf. api.js).

import { PERIOD_FIELDS, RELATIVE_PRESETS } from './constants.js'

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
// Décale (y, m) de `delta` mois ; m en 1..12.
function addMonths(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta
  return [Math.floor(idx / 12), (idx % 12) + 1]
}
export const fiscalYearOf = (dateISO) => {
  const [y, m] = dateISO.split('-').map(Number)
  return m === 12 ? y + 1 : y
}

export function todayLocalISO() {
  const d = new Date()
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

// preset + date du jour → { from, to }
export function resolvePreset(preset, today) {
  const [y, m, d] = today.split('-').map(Number)
  switch (preset) {
    case 'current_month':
      return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) }
    case 'previous_month': {
      const [py, pm] = addMonths(y, m, -1)
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) }
    }
    case 'last_3_months': {   // mois en cours inclus
      const [fy, fm] = addMonths(y, m, -2)
      return { from: iso(fy, fm, 1), to: iso(y, m, lastDay(y, m)) }
    }
    case 'last_12_months': {  // mois en cours inclus
      const [fy, fm] = addMonths(y, m, -11)
      return { from: iso(fy, fm, 1), to: iso(y, m, lastDay(y, m)) }
    }
    case 'current_fiscal_year': {
      const fy = fiscalYearOf(today)
      return { from: iso(fy - 1, 12, 1), to: iso(fy, 11, 30) }
    }
    case 'previous_fiscal_year': {
      const fy = fiscalYearOf(today) - 1
      return { from: iso(fy - 1, 12, 1), to: iso(fy, 11, 30) }
    }
    case 'fiscal_ytd': {
      const fy = fiscalYearOf(today)
      return { from: iso(fy - 1, 12, 1), to: iso(y, m, d) }
    }
    case 'current_year':
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) }
    case 'previous_year':
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) }
    default:
      return { from: null, to: null }
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Configuration de période → période résolue, ou null si aucune période.
// { field, mode: 'none'|'fixed'|'relative', preset, from, to, includeEmpty }
export function resolvePeriod(period, today = todayLocalISO()) {
  if (!period || period.mode === 'none' || !PERIOD_FIELDS.includes(period.field)) return null
  let from = null, to = null
  if (period.mode === 'relative') {
    if (!RELATIVE_PRESETS.includes(period.preset)) return null
    ;({ from, to } = resolvePreset(period.preset, today))
  } else {
    from = DATE_RE.test(period.from || '') ? period.from : null
    to   = DATE_RE.test(period.to   || '') ? period.to   : null
    if (!from && !to) return null
    // Bornes inversées : on les remet dans l'ordre plutôt que de rendre 0 résultat.
    if (from && to && from > to) [from, to] = [to, from]
  }
  return { field: period.field, mode: period.mode, preset: period.preset || null, from, to, includeEmpty: !!period.includeEmpty }
}

// Une valeur de date (DATE « YYYY-MM-DD » ou TIMESTAMPTZ) est-elle dans la période ?
export function inResolvedPeriod(value, resolved) {
  if (!resolved) return true
  if (value === null || value === undefined || value === '') return resolved.includeEmpty
  const v = String(value).slice(0, 10)
  if (resolved.from && v < resolved.from) return false
  if (resolved.to && v > resolved.to) return false
  return true
}

// Mois (« YYYY-MM ») couverts par une période résolue — pour l'évolution mensuelle.
export function monthsBetween(from, to) {
  if (!from || !to) return []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const out = []
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`)
    ;[y, m] = addMonths(y, m, 1)
    if (out.length > 600) break
  }
  return out
}

// Clé de regroupement temporel d'une date.
export function timeBucket(value, bucket) {
  if (!value) return null
  const v = String(value).slice(0, 10)
  const [y, m] = v.split('-').map(Number)
  if (!y || !m) return null
  switch (bucket) {
    case 'month':   return `${y}-${pad(m)}`
    case 'quarter': return `${y}-T${Math.ceil(m / 3)}`
    case 'year':    return String(y)
    case 'fiscal_year': return `FY${m === 12 ? y + 1 : y}`
    case 'fiscal_quarter': {
      const fm = m === 12 ? 1 : m + 1           // mois fiscal 1..12
      return `FY${m === 12 ? y + 1 : y}-T${Math.ceil(fm / 3)}`
    }
    default: return null
  }
}
