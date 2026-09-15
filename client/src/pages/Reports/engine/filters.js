// Évaluation des critères d'un rapport, toujours AU NIVEAU DE L'ARTICLE (ligne).
//
//   retenu = période  ET  filtre 1 ET filtre 2 …            (« périmètre »)
//            ET  (groupe A OU groupe B …)                     (« critères thématiques »)
//   groupe = condition 1 ET condition 2 …
//
// Dans un même filtre, plusieurs valeurs cochées se combinent en OU. Une
// condition incomplète (aucune valeur, aucun terme, aucune borne) est ignorée
// et signalée à l'interface — jamais interprétée comme « tout » ou « rien » en silence.
// Une condition « contient » est une RECHERCHE TEXTUELLE, distincte d'un filtre
// sur la classification structurée ; les groupes qui en contiennent sont marqués.

import { EMPTY } from './constants.js'
import { FIELD_MAP } from './fields.js'
import { resolvePeriod, inResolvedPeriod } from './period.js'
import { termMatcher, cleanTerms } from './text.js'

const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const TEXT_OPS = ['contains_any', 'not_contains_any']

// TIMESTAMPTZ → date locale « YYYY-MM-DD » ; DATE renvoyée telle quelle.
export function localDateOf(v) {
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const bound = (v) => (v === null || v === undefined || v === '' ? null : v)

export function isConditionComplete(cond) {
  const field = FIELD_MAP[cond?.field]
  if (!field || !field.ops.includes(cond.op)) return false
  switch (cond.op) {
    case 'in': case 'not_in': return Array.isArray(cond.values) && cond.values.length > 0
    case 'contains_any': case 'not_contains_any': return cleanTerms(cond.terms).length > 0
    case 'between': return bound(cond.min) !== null || bound(cond.max) !== null
    case 'empty': case 'not_empty': return true
    default: return false
  }
}

export const isTextualCondition = (cond) => TEXT_OPS.includes(cond?.op)

export function compileCondition(cond) {
  const field = FIELD_MAP[cond.field]
  const get = (row) => row[field.id]
  switch (cond.op) {
    case 'empty':     return (row) => isEmptyValue(get(row))
    case 'not_empty': return (row) => !isEmptyValue(get(row))
    case 'in':
    case 'not_in': {
      const set = new Set(cond.values.map(String))
      const has = (row) => {
        const v = get(row)
        if (Array.isArray(v)) return v.length ? v.some(x => set.has(String(x))) : set.has(EMPTY)
        return isEmptyValue(v) ? set.has(EMPTY) : set.has(String(v))
      }
      return cond.op === 'in' ? has : (row) => !has(row)
    }
    case 'contains_any':
    case 'not_contains_any': {
      const match = termMatcher(cond.terms)
      const test = (row) => {
        const v = get(row)
        return Array.isArray(v) ? v.some(match) : match(v)
      }
      return cond.op === 'contains_any' ? test : (row) => !test(row)
    }
    case 'between': {
      const kind = field.kind
      if (['date', 'datetime', 'list'].includes(kind)) {
        const min = bound(cond.min), max = bound(cond.max)
        const inRange = (v) => {
          if (isEmptyValue(v)) return false
          const d = localDateOf(v)
          return (min === null || d >= min) && (max === null || d <= max)
        }
        return (row) => {
          const v = get(row)
          return Array.isArray(v) ? v.some(inRange) : inRange(v)
        }
      }
      // Pourcentage saisi en % (0–100), stocké en fraction dans les données.
      const scale = kind === 'pct' ? 100 : 1
      const min = bound(cond.min) === null ? null : Number(cond.min)
      const max = bound(cond.max) === null ? null : Number(cond.max)
      return (row) => {
        const v = get(row)
        if (isEmptyValue(v)) return false
        const n = Number(v) * scale
        return (min === null || n >= min - 1e-9) && (max === null || n <= max + 1e-9)
      }
    }
    default:
      return () => true
  }
}

// Nombre d'articles du périmètre satisfaisant chaque groupe pris isolément —
// y compris un groupe désactivé : l'utilisateur voit ce qu'il ajouterait.
export function groupMatchCounts(scopeRows, groups) {
  const counts = {}
  for (const g of groups || []) {
    const tests = (g.conditions || []).filter(isConditionComplete).map(compileCondition)
    if (!tests.length) continue
    let n = 0
    for (const r of scopeRows) if (tests.every(fn => fn(r))) n++
    counts[g.id] = n
  }
  return counts
}

// config → prédicats. `labelOf(group)` fournit le libellé affiché d'un groupe.
export function compileReport(config, { today, labelOf = (g) => g.label || g.id } = {}) {
  const period = resolvePeriod(config.period, today)
  const incomplete = []

  const filters = []
  for (const c of config.filters || []) {
    if (isConditionComplete(c)) filters.push(compileCondition(c))
    else incomplete.push(c.id)
  }
  const periodField = period?.field
  const scope = (row) => (!period || inResolvedPeriod(row[periodField], period)) && filters.every(fn => fn(row))

  const groups = []
  for (const g of config.groups || []) {
    const complete = (g.conditions || []).filter(isConditionComplete)
    ;(g.conditions || []).filter(c => !isConditionComplete(c)).forEach(c => incomplete.push(c.id))
    if (g.enabled === false || !complete.length) continue
    const tests = complete.map(compileCondition)
    groups.push({
      id: g.id,
      label: labelOf(g),
      textual: complete.some(isTextualCondition),
      test: (row) => tests.every(fn => fn(row)),
    })
  }
  const hasTheme = groups.length > 0
  // Ids des groupes satisfaits (tableau vide = hors thème).
  const matchGroups = (row) => groups.filter(g => g.test(row)).map(g => g.id)

  return { period, scope, groups, hasTheme, matchGroups, incomplete }
}
