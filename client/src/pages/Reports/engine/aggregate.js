// Exécution d'un rapport : filtres → articles retenus → présentation (granularité),
// tri, indicateurs, évolution mensuelle et résumé par regroupement.
//
// Règles anti-double comptage :
// - les appels (SC#) et les occurrences sont TOUJOURS comptés en distinct ;
// - les quantités et coûts de ligne sont additionnés sur les articles retenus,
//   chaque article n'appartenant qu'à une seule ligne de résultat ;
// - un coût porté par l'en-tête (occurrence sans ligne chiffrée) n'est placé que
//   sur UN article (dataset.js) ; le coût de l'occurrence (occ_cost) est additionné
//   une seule fois par occurrence ;
// - une valeur absente reste « non renseignée » (null) : jamais convertie en 0.
//   Chaque somme expose le nombre de valeurs manquantes.

import { EMPTY, STATUS_ORDER } from './constants.js'
import { FIELDS, FIELD_MAP } from './fields.js'
import { compileReport } from './filters.js'
import { monthsBetween, timeBucket } from './period.js'

const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
// Sommes arrondies au cent : évite les résidus flottants (2447.8899999999994).
const roundCents = (x) => Math.round(x * 100) / 100

export const KPI_MEASURES = ['affected_qty', 'cost_furniture', 'cost_freight', 'cost_install', 'supplier_credit', 'cost_net']

// ── Indicateurs d'un ensemble d'articles ─────────────────────────────────────
export function computeMetrics(rows) {
  const calls = new Set(), callsNoSc = new Set(), occs = new Set()
  let articles = 0, headerRows = 0
  const measures = Object.fromEntries(KPI_MEASURES.map(m => [m, { sum: null, missing: 0, count: 0 }]))
  let legacyTotal = 0, legacyRows = 0, occLevelCost = 0
  const repeated = new Map()   // occurrence|montant -> nb de lignes retenues
  for (const r of rows) {
    if (r.freight_repeated) {
      const k = `${r.occurrence_id}|${r.cost_freight}`
      repeated.set(k, (repeated.get(k) || 0) + 1)
    }
    calls.add(r.call_key)
    if (!r.has_valid_sc) callsNoSc.add(r.call_key)
    occs.add(r.occurrence_id)
    if (r.has_line) articles++; else headerRows++
    for (const m of KPI_MEASURES) {
      const v = r[m]
      if (v === null || v === undefined) { measures[m].missing++; continue }
      measures[m].sum = (measures[m].sum || 0) + Number(v)
      measures[m].count++
    }
    if (r.cost_split_status === 'legacy_total' && r.cost_net !== null) { legacyTotal += Number(r.cost_net); legacyRows++ }
    if (r.cost_split_status === 'occurrence_level' && r.cost_net !== null) occLevelCost += Number(r.cost_net)
  }
  for (const m of KPI_MEASURES) if (measures[m].sum !== null) measures[m].sum = roundCents(measures[m].sum)
  // Excédent si chaque montant répété était un doublon : (n - 1) x montant.
  let freightRepeatedExtra = 0
  const freightRepeatedOcc = new Set()
  for (const [k, n] of repeated) {
    const [occ, amount] = k.split('|')
    if (n > 1) { freightRepeatedExtra += (n - 1) * Number(amount); freightRepeatedOcc.add(occ) }
  }
  return {
    rows: rows.length, calls: calls.size, callsWithoutSc: callsNoSc.size, occurrences: occs.size,
    articles, headerRows, measures, legacyTotal: roundCents(legacyTotal), legacyRows, occLevelCost: roundCents(occLevelCost),
    freightRepeatedExtra: roundCents(freightRepeatedExtra), freightRepeatedOccurrences: freightRepeatedOcc.size,
  }
}

// ── Présentation selon la granularité ────────────────────────────────────────
function distinctValues(values) {
  const seen = new Set(), out = []
  for (const v of values) {
    const arr = Array.isArray(v) ? v : [v]
    for (const x of arr) {
      if (isEmptyValue(x)) continue
      const k = String(x)
      if (!seen.has(k)) { seen.add(k); out.push(x) }
    }
  }
  return out
}

function aggregateGroup(key, rows, granularity) {
  const first = rows[0]
  const rec = { row_key: key, _missing: {} }
  const byOcc = new Map()
  for (const r of rows) if (!byOcc.has(r.occurrence_id)) byOcc.set(r.occurrence_id, r)
  const occRows = [...byOcc.values()]

  for (const field of FIELDS) {
    if (field.filterOnly) continue
    const id = field.id
    const singleOcc = granularity === 'occurrence' || occRows.length === 1
    switch (field.agg) {
      case 'sum': {
        let sum = null, missing = 0
        for (const r of rows) { const v = r[id]; if (v === null || v === undefined) missing++; else sum = (sum || 0) + Number(v) }
        rec[id] = sum === null ? null : roundCents(sum); rec._missing[id] = missing
        break
      }
      case 'occ_sum': {
        let sum = null, missing = 0
        for (const r of occRows) { const v = r[id]; if (v === null || v === undefined) missing++; else sum = (sum || 0) + Number(v) }
        rec[id] = sum === null ? null : roundCents(sum); rec._missing[id] = missing
        break
      }
      case 'min': case 'max': {
        const vals = (field.level === 'occurrence' ? occRows : rows).map(r => r[id]).filter(v => !isEmptyValue(v)).map(String).sort()
        rec[id] = vals.length ? (field.agg === 'min' ? vals[0] : vals[vals.length - 1]) : null
        break
      }
      case 'ratio': {
        let a = 0, tot = 0, n = 0
        for (const r of rows) if (r.affected_qty !== null && r.total_qty) { a += r.affected_qty; tot += r.total_qty; n++ }
        rec[id] = n ? a / tot : null
        break
      }
      case 'count':     rec[id] = rows.length; break
      case 'count_occ': rec[id] = occRows.length; break
      default: {
        if (field.level === 'occurrence' && singleOcc && id !== 'review_meetings') { rec[id] = first[id]; break }
        const vals = distinctValues((field.level === 'occurrence' ? occRows : rows).map(r => r[id]))
        rec[id] = field.kind === 'list' ? vals : vals.length === 0 ? null : vals.length === 1 ? vals[0] : vals
      }
    }
  }
  rec.matched_criteria = distinctValues(rows.map(r => r.matched_criteria))
  rec.occurrence_id = occRows.length === 1 ? first.occurrence_id : null
  rec._occLinks = occRows.map(r => ({ id: r.occurrence_id, no: r.occurrence_no }))
  rec._rows = rows
  return rec
}

export function presentRecords(matched, granularity) {
  if (granularity !== 'occurrence' && granularity !== 'call') {
    return matched.map(r => ({ ...r, matched_lines: 1, matched_occurrences: 1, _occLinks: [{ id: r.occurrence_id, no: r.occurrence_no }], _missing: {} }))
  }
  const keyOf = granularity === 'occurrence' ? (r) => r.occurrence_id : (r) => r.call_key
  const groups = new Map()
  for (const r of matched) {
    const k = keyOf(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  return [...groups.entries()].map(([k, rows]) => aggregateGroup(k, rows, granularity))
}

// ── Tri ─────────────────────────────────────────────────────────────────────
const firstOf = (v) => (Array.isArray(v) ? (v.length ? v[0] : null) : v)
function compareValues(field, a, b) {
  a = firstOf(a); b = firstOf(b)
  const ea = isEmptyValue(a), eb = isEmptyValue(b)
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1   // vides toujours en dernier
  if (field?.id === 'status') return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)
  if (['int', 'money', 'pct'].includes(field?.kind) || (typeof a === 'number' && typeof b === 'number')) return Number(a) - Number(b)
  if (field?.kind === 'bool') return (a === true ? 1 : 0) - (b === true ? 1 : 0)
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' })
}
const TIEBREAK = [
  { field: 'issue_reception_date', dir: 'desc' },
  { field: 'occurrence_no', dir: 'desc' },
  { field: 'line_no', dir: 'asc' },
]
export function sortRecords(records, sort = []) {
  const keys = [...(sort || []).filter(s => FIELD_MAP[s.field]), ...TIEBREAK]
  return records.slice().sort((x, y) => {
    for (const s of keys) {
      const field = FIELD_MAP[s.field]
      const a = x[s.field], b = y[s.field]
      const ea = isEmptyValue(firstOf(a)), eb = isEmptyValue(firstOf(b))
      if (ea !== eb) return ea ? 1 : -1
      const c = compareValues(field, a, b)
      if (c !== 0) return s.dir === 'desc' ? -c : c
    }
    return 0
  })
}

// ── Regroupements (vue résumée, synthèse, répartitions) ─────────────────────
// dims : [{ field }] ou [{ field: <champ date>, time: 'month' | … }]
export function dimensionValue(row, dim) {
  if (dim.time) return timeBucket(row[dim.field], dim.time) ?? EMPTY
  const v = row[dim.field]
  if (isEmptyValue(v)) return EMPTY
  return Array.isArray(v) ? String(v[0]) : (typeof v === 'boolean' ? String(v) : v)
}

export function summarize(resultRows, scopeRows, dims, { hasTheme = false } = {}) {
  const keyOf = (r) => dims.map(d => String(dimensionValue(r, d))).join('\u0001')
  const bucket = (rows) => {
    const m = new Map()
    for (const r of rows) {
      const k = keyOf(r)
      if (!m.has(k)) m.set(k, { values: dims.map(d => dimensionValue(r, d)), rows: [] })
      m.get(k).rows.push(r)
    }
    return m
  }
  const res = bucket(resultRows)
  const scope = hasTheme ? bucket(scopeRows) : null
  const groups = [...res.entries()].map(([k, g]) => {
    const metrics = computeMetrics(g.rows)
    const scopeMetrics = scope ? computeMetrics(scope.get(k)?.rows || []) : null
    return {
      key: k, values: g.values, metrics,
      scopeCalls: scopeMetrics ? scopeMetrics.calls : null,
      share: scopeMetrics && scopeMetrics.calls ? metrics.calls / scopeMetrics.calls : null,
    }
  })
  // Ordre : dimension temporelle chronologique ; autre dimension par nombre
  // d'appels décroissant — pour la 1re dimension, calculé sur TOUT son groupe
  // (et non cellule par cellule), afin que ses lignes restent contiguës.
  const firstCalls = new Map()
  if (dims.length > 1 && !dims[0].time) {
    const byFirst = new Map()
    for (const r of resultRows) {
      const k = String(dimensionValue(r, dims[0]))
      if (!byFirst.has(k)) byFirst.set(k, new Set())
      byFirst.get(k).add(r.call_key)
    }
    for (const [k, set] of byFirst) firstCalls.set(k, set.size)
  }
  groups.sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const va = a.values[i], vb = b.values[i]
      if (va === EMPTY || vb === EMPTY) { if (va !== vb) return va === EMPTY ? 1 : -1; continue }
      if (dims[i].time) { const c = String(va).localeCompare(String(vb)); if (c) return c; continue }
      if (String(va) === String(vb)) continue
      const ca = i === 0 && dims.length > 1 ? firstCalls.get(String(va)) : a.metrics.calls
      const cb = i === 0 && dims.length > 1 ? firstCalls.get(String(vb)) : b.metrics.calls
      if (ca !== cb) return cb - ca
      return String(va).localeCompare(String(vb), 'fr', { numeric: true })
    }
    return 0
  })
  return groups
}

// Évolution mensuelle sur le champ de date de la période (réception par défaut).
export function monthlyEvolution(resultRows, scopeRows, { dateField = 'issue_reception_date', from = null, to = null, hasTheme = false } = {}) {
  const month = (r) => (r[dateField] ? String(r[dateField]).slice(0, 7) : null)
  const res = new Map(), scope = new Map()
  for (const r of resultRows) { const m = month(r); if (m) { if (!res.has(m)) res.set(m, []); res.get(m).push(r) } }
  for (const r of scopeRows) { const m = month(r); if (m) { if (!scope.has(m)) scope.set(m, []); scope.get(m).push(r) } }
  let months
  if (from && to) months = monthsBetween(from, to)
  else {
    const all = [...res.keys()].sort()
    months = all.length ? monthsBetween(`${all[0]}-01`, `${all[all.length - 1]}-01`) : []
  }
  return months.map(m => {
    const metrics = computeMetrics(res.get(m) || [])
    const scopeCalls = hasTheme ? computeMetrics(scope.get(m) || []).calls : null
    return { month: m, metrics, scopeCalls, share: hasTheme && scopeCalls ? metrics.calls / scopeCalls : null }
  })
}

// ── Pipeline complet ─────────────────────────────────────────────────────────
export function runReport(rows, config, { today, labelOf } = {}) {
  const compiled = compileReport(config, { today, labelOf })
  const scopeRows = rows.filter(compiled.scope)
  const labelById = Object.fromEntries(compiled.groups.map(g => [g.id, g.label]))
  const matched = []
  for (const r of scopeRows) {
    if (compiled.hasTheme) {
      const ids = compiled.matchGroups(r)
      if (!ids.length) continue
      matched.push({ ...r, matched_criteria: ids.map(id => labelById[id]) })
    } else {
      matched.push({ ...r, matched_criteria: [] })
    }
  }
  const granularity = ['occurrence', 'call'].includes(config.granularity) ? config.granularity : 'line'
  const records = sortRecords(presentRecords(matched, granularity), config.sort)
  const metrics = computeMetrics(matched)
  const scopeMetrics = compiled.hasTheme ? computeMetrics(scopeRows) : null
  return {
    compiled,
    period: compiled.period,
    granularity,
    matched,
    scopeRows,
    records,
    metrics,
    scopeMetrics,
    share: scopeMetrics && scopeMetrics.calls ? metrics.calls / scopeMetrics.calls : null,
  }
}
