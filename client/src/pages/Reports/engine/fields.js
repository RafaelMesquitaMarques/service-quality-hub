// Catalogue des champs disponibles dans les rapports, organisés par sujet.
// Chaque champ correspond à une donnée RÉELLEMENT stockée (ou à une règle de
// dérivation documentée dans dataset.js) — libellés et aide dans i18n
// (reports.fields.<id>, reports.help.<id>).
//
// kind   : id | text | longtext | enum | date | datetime | int | money | pct | bool | list
// level  : 'line' (porté par l'article) | 'occurrence' (porté par l'en-tête)
// agg    : agrégation quand plusieurs articles sont réunis (vue par occurrence
//          ou par appel) — distinct | sum | occ_sum | min | max | ratio
//   * sum     : additionné sur les articles retenus (mesures de ligne)
//   * occ_sum : additionné une seule fois par occurrence (mesure d'en-tête)

import { STATUS_ORDER, URGENCY_ORDER } from './constants.js'

export const FIELD_GROUPS = ['call', 'customer', 'product', 'classification', 'plant', 'quantities', 'costs', 'followup', 'text', 'meta']

const OPS = {
  enum:     ['in', 'not_in', 'empty', 'not_empty'],
  bool:     ['in', 'empty', 'not_empty'],
  id:       ['in', 'not_in', 'contains_any', 'empty', 'not_empty'],
  text:     ['in', 'not_in', 'contains_any', 'not_contains_any', 'empty', 'not_empty'],
  longtext: ['contains_any', 'not_contains_any', 'empty', 'not_empty'],
  date:     ['between', 'empty', 'not_empty'],
  datetime: ['between', 'empty', 'not_empty'],
  int:      ['between', 'empty', 'not_empty'],
  money:    ['between', 'empty', 'not_empty'],
  pct:      ['between', 'empty', 'not_empty'],
  list:     ['between', 'empty', 'not_empty'],
}

const f = (id, group, kind, level, extra = {}) => ({
  id, group, kind, level,
  agg: extra.agg || (['int', 'money'].includes(kind) ? (level === 'line' ? 'sum' : 'occ_sum') : ['date', 'datetime'].includes(kind) ? 'min' : 'distinct'),
  ops: extra.ops || OPS[kind],
  width: extra.width || ({ id: 14, text: 24, longtext: 40, enum: 16, date: 12, datetime: 17, int: 10, money: 13, pct: 10, bool: 10, list: 22 })[kind],
  ...extra,
})

export const FIELDS = [
  // ── Appel de service / occurrence ──────────────────────────────────────────
  f('occurrence_no',        'call', 'int', 'occurrence', { agg: 'distinct', identifier: true, width: 11, ops: ['in', 'between', 'empty', 'not_empty'] }),
  f('sc_number',            'call', 'id', 'occurrence', { width: 12 }),
  f('status',               'call', 'enum', 'occurrence', { values: STATUS_ORDER }),
  f('urgency',              'call', 'enum', 'occurrence', { values: URGENCY_ORDER }),
  f('issue_reception_date', 'call', 'date', 'occurrence'),
  f('delivery_date',        'call', 'date', 'occurrence'),
  f('wish_delivery_date',   'call', 'date', 'occurrence'),
  f('occ_title',            'call', 'longtext', 'occurrence'),
  f('comment',              'call', 'longtext', 'occurrence'),
  f('service_desk_notes',   'call', 'longtext', 'occurrence'),
  f('original_so',          'call', 'id', 'occurrence'),
  f('created_by_name',      'call', 'enum', 'occurrence', { width: 20 }),
  f('record_origin',        'call', 'enum', 'occurrence', { values: ['app', 'import'] }),
  f('fiscal_year',          'call', 'enum', 'occurrence', { width: 10 }),
  f('lines_count',          'call', 'int', 'occurrence'),
  f('installer_needed',     'call', 'bool', 'occurrence'),
  // ── Client / destination ───────────────────────────────────────────────────
  f('ship_to',              'customer', 'text', 'occurrence', { width: 28 }),
  f('project_name',         'customer', 'text', 'occurrence', { width: 28 }),
  f('sold_to',              'customer', 'text', 'occurrence', { width: 28 }),
  f('brand',                'customer', 'enum', 'occurrence'),
  // ── Produit ────────────────────────────────────────────────────────────────
  f('line_no',              'product', 'int', 'line', { agg: 'distinct', width: 8 }),
  f('line_title',           'product', 'longtext', 'line'),
  f('description',          'product', 'longtext', 'line'),
  f('item',                 'product', 'id', 'line'),
  f('foliot_id',            'product', 'id', 'line', { width: 18 }),
  f('ref_so',               'product', 'id', 'line'),
  f('completion_type',      'product', 'enum', 'line', { values: ['complete', 'parts'] }),
  // ── Classification du défaut ──────────────────────────────────────────────
  f('category',             'classification', 'enum', 'line', { referential: 'categories' }),
  f('category_source',      'classification', 'enum', 'line', { values: ['line', 'header', 'none'] }),
  f('department',           'classification', 'enum', 'line', { referential: 'departments' }),
  f('root_cause',           'classification', 'text', 'line', { width: 24 }),
  f('corrective_action',    'classification', 'longtext', 'line'),
  // ── Usine ──────────────────────────────────────────────────────────────────
  f('plant',                'plant', 'enum', 'line', { referential: 'plants', width: 10 }),
  // ── Quantités ──────────────────────────────────────────────────────────────
  f('affected_qty',         'quantities', 'int', 'line'),
  f('total_qty',            'quantities', 'int', 'line'),
  f('affected_pct_calc',    'quantities', 'pct', 'line', { agg: 'ratio' }),
  // ── Coûts ──────────────────────────────────────────────────────────────────
  f('cost_furniture',       'costs', 'money', 'line'),
  f('cost_freight',         'costs', 'money', 'line'),
  f('freight_repeated',     'costs', 'bool', 'line', { width: 14 }),
  f('cost_install',         'costs', 'money', 'line'),
  f('supplier_credit',      'costs', 'money', 'line'),
  f('cost_net',             'costs', 'money', 'line'),
  f('cost_split_status',    'costs', 'enum', 'line', { values: ['split', 'legacy_total', 'occurrence_level', 'none'], width: 30 }),
  f('occ_cost',             'costs', 'money', 'occurrence', { width: 15 }),
  // ── Suivi ──────────────────────────────────────────────────────────────────
  f('meeting_date',         'followup', 'date', 'occurrence'),
  f('review_meetings',      'followup', 'list', 'occurrence'),
  f('sd_completed_at',      'followup', 'datetime', 'occurrence'),
  f('updated_at',           'followup', 'datetime', 'occurrence', { agg: 'max' }),
  f('corrective_action_no', 'followup', 'id', 'occurrence'),
  f('legacy_link',          'followup', 'text', 'occurrence', { width: 30, ops: ['contains_any', 'empty', 'not_empty'] }),
  // ── Recherche textuelle (filtres uniquement) ──────────────────────────────
  f('text_line',            'text', 'longtext', 'line', { filterOnly: true }),
  f('text_occ',             'text', 'longtext', 'occurrence', { filterOnly: true }),
  f('text_all',             'text', 'longtext', 'line', { filterOnly: true }),
  // ── Colonnes calculées par le rapport (non filtrables) ─────────────────────
  f('matched_criteria',     'meta', 'list', 'line', { columnOnly: true, ops: [], width: 34 }),
  f('matched_lines',        'meta', 'int', 'line', { columnOnly: true, ops: [], agg: 'count' }),
  f('matched_occurrences',  'meta', 'int', 'occurrence', { columnOnly: true, ops: [], agg: 'count_occ' }),
]

// Sans prototype : un identifiant venu d'une configuration (« __proto__ »,
// « constructor »…) ne résout jamais vers autre chose qu'un champ du catalogue.
export const FIELD_MAP = Object.assign(Object.create(null), Object.fromEntries(FIELDS.map(x => [x.id, x])))

export const isMeasure = (field) => ['int', 'money'].includes(field?.kind) && !['occurrence_no', 'line_no'].includes(field.id)

// Champs proposés comme dimension de regroupement dans la vue résumée.
export const GROUPABLE_FIELDS = FIELDS.filter(x =>
  !x.filterOnly && !x.columnOnly && ['enum', 'id', 'text', 'bool'].includes(x.kind)
  && !['legacy_link', 'occurrence_no'].includes(x.id)).map(x => x.id)

// Libellé traduit d'une valeur brute (enum, booléen) ; `t` = i18next.
export function valueLabel(field, value, t) {
  if (value === null || value === undefined || value === '' || value === '__empty__') return t('reports.empty')
  switch (field?.id) {
    case 'status':            return t(`status.${value}`)
    case 'urgency':           return t(`reports.values.urgency.${value}`)
    case 'record_origin':     return t(`reports.values.origin.${value}`)
    case 'completion_type':   return value === 'complete' ? t('ticket.complete_product') : value === 'parts' ? t('ticket.parts_only') : String(value)
    case 'category_source':   return t(`reports.values.category_source.${value}`)
    case 'cost_split_status': return t(`reports.values.cost_split.${value}`)
    default: break
  }
  if (field?.kind === 'bool') return value === true || value === 'true' ? t('common.yes') : t('common.no')
  return String(value)
}
