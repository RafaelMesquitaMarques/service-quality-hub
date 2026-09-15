// Valeurs proposées dans les filtres : UNIQUEMENT les valeurs réellement
// présentes dans les données (avec leur nombre d'articles), plus
// « (Non renseigné) ». Les valeurs absentes du référentiel actif (anciennes
// catégories « Assembly issue », usine « NCW »…) sont signalées, pas masquées :
// chacun voit exactement ce que recouvre un filtre.

import { EMPTY } from './constants.js'
import { FIELD_MAP } from './fields.js'

const isEmptyValue = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

export function valueOptions(rows, fieldId, { referential = null } = {}) {
  const field = FIELD_MAP[fieldId]
  if (!field) return []
  const counts = new Map()
  let empty = 0
  for (const r of rows) {
    const v = r[fieldId]
    const arr = Array.isArray(v) ? v : [v]
    const present = arr.filter(x => !isEmptyValue(x))
    if (!present.length) { empty++; continue }
    for (const x of new Set(present.map(String))) counts.set(x, (counts.get(x) || 0) + 1)
  }
  if (field.values) for (const v of field.values) if (!counts.has(v)) counts.set(v, 0)
  if (field.kind === 'bool') for (const v of ['true', 'false']) if (!counts.has(v)) counts.set(v, 0)
  const refSet = referential ? new Set(referential) : null
  const list = [...counts.entries()].map(([value, count]) => ({
    value, count, outOfReferential: !!refSet && !refSet.has(value),
  }))
  if (field.values) list.sort((a, b) => field.values.indexOf(a.value) - field.values.indexOf(b.value))
  else list.sort((a, b) => a.value.localeCompare(b.value, 'fr', { numeric: true, sensitivity: 'base' }))
  return [{ value: EMPTY, count: empty, outOfReferential: false }, ...list]
}

// Part des occurrences (distinctes) qui portent une valeur pour ce champ.
export function occurrenceFillRate(rows, fieldId) {
  const occ = new Map()
  for (const r of rows) {
    const has = !isEmptyValue(r[fieldId])
    occ.set(r.occurrence_id, (occ.get(r.occurrence_id) || false) || has)
  }
  if (!occ.size) return null
  let filled = 0
  for (const v of occ.values()) if (v) filled++
  return { filled, total: occ.size, rate: filled / occ.size }
}
