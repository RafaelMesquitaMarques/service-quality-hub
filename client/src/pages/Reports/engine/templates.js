// Modèles prêts à l'emploi + normalisation des configurations enregistrées.
//
// Hardware — constats sur les données (sept. 2026), qui justifient ces modèles :
// - « Hardware » est une valeur de CATÉGORIE (tickets.categories /
//   occurrence_lines.categories). Il n'existe ni sous-catégorie ni sous-cause,
//   et la cause racine n'est quasiment jamais renseignée (5 occurrences sur 2 432).
// - Aucun champ structuré ne distingue le hardware MANQUANT du hardware
//   défectueux : dans « Hardware », seule la description le dit (« Missing HDW
//   kit… », « Missing screws… »). À l'inverse, « Missing Component » contient du
//   hardware (« Missing hardware (screws) », « Missing levelers ») ET des pièces
//   qui n'en sont pas (portes, dessus de table…).
// Les modèles combinent donc la classification structurée et une recherche
// textuelle, dans des groupes nommés et marqués comme tels — rien n'est
// reclassé : chaque groupe peut être désactivé, et la colonne « Critère
// correspondant » indique pour chaque article le ou les groupes satisfaits.

import { CONFIG_VERSION, GRANULARITIES, PERIOD_FIELDS, RELATIVE_PRESETS, TIME_BUCKETS } from './constants.js'
import { FIELD_MAP } from './fields.js'

// Termes (début de mot, sans casse ni accents) relevés dans les descriptions réelles.
export const HARDWARE_TERMS = [
  'hardware', 'hdw', 'quincaillerie', 'visserie', 'screw', 'bolt', 'boulon', 'washer', 'rondelle',
  'bracket', 'hinge', 'charniere', 'glide', 'drawer slide', 'leveler', 'leveller', 'niveleur',
  'caster', 'handle', 'poignee', 'knob', 'latch', 'hook', 'crochet', 'fastcap', 'grommet',
  'dowel', 'cam lock', 'camlock', 'minifix', 'fastener', 'spacer',
]
export const MISSING_TERMS = [
  'missing', 'manquant', 'manque', 'not received', 'never received', 'did not receive',
  'not included', 'forgot', 'oubli', 'never got',
]

export const HARDWARE_COLUMNS = [
  'occurrence_no', 'sc_number', 'issue_reception_date', 'delivery_date', 'ship_to', 'project_name',
  'department', 'category', 'root_cause', 'item', 'foliot_id', 'plant',
  'affected_qty', 'total_qty', 'cost_furniture', 'cost_freight', 'freight_repeated',
  'line_title', 'status', 'cost_split_status', 'matched_criteria',
]

const basePeriod = () => ({ field: 'issue_reception_date', mode: 'relative', preset: 'last_12_months', from: null, to: null, includeEmpty: false })
const notCancelled = () => ({ id: 'f_status', field: 'status', op: 'not_in', values: ['cancelled'] })

export const TEMPLATES = [
  {
    id: 'hardware_all',
    icon: 'ti-tool',
    fileSlug: 'Hardware_Tous_Problemes',
    config: () => ({
      v: CONFIG_VERSION, granularity: 'line', view: 'detail', indicators: true,
      period: basePeriod(),
      filters: [notCancelled()],
      groups: [
        { id: 'g_category', labelKey: 'reports.tpl.g_hw_category', enabled: true,
          conditions: [{ id: 'c_cat', field: 'category', op: 'in', values: ['Hardware'] }] },
        // Articles sans catégorie (pas encore classés) : introuvables autrement.
        { id: 'g_unclassified', labelKey: 'reports.tpl.g_unclassified_hw', enabled: true,
          conditions: [
            { id: 'c_empty', field: 'category', op: 'empty' },
            { id: 'c_txt_u', field: 'text_line', op: 'contains_any', terms: HARDWARE_TERMS },
          ] },
        // Mention hardware dans une AUTRE catégorie (Damaged…) : rappel plus large,
        // précision moindre — désactivé par défaut, activable en un clic.
        { id: 'g_text', labelKey: 'reports.tpl.g_hw_text', enabled: false,
          conditions: [{ id: 'c_txt', field: 'text_line', op: 'contains_any', terms: HARDWARE_TERMS }] },
      ],
      columns: HARDWARE_COLUMNS,
      sort: [{ field: 'issue_reception_date', dir: 'desc' }],
      summary: { dims: [{ field: 'issue_reception_date', time: 'month' }] },
    }),
  },
  {
    id: 'hardware_missing',
    icon: 'ti-puzzle-off',
    fileSlug: 'Hardware_Manquant',
    config: () => ({
      v: CONFIG_VERSION, granularity: 'line', view: 'detail', indicators: true,
      period: basePeriod(),
      filters: [notCancelled()],
      groups: [
        { id: 'g_hw_missing', labelKey: 'reports.tpl.g_hw_missing', enabled: true,
          conditions: [
            { id: 'c1', field: 'category', op: 'in', values: ['Hardware'] },
            { id: 'c2', field: 'text_line', op: 'contains_any', terms: MISSING_TERMS },
          ] },
        { id: 'g_component_hw', labelKey: 'reports.tpl.g_component_hw', enabled: true,
          conditions: [
            { id: 'c3', field: 'category', op: 'in', values: ['Missing Component'] },
            { id: 'c4', field: 'text_line', op: 'contains_any', terms: HARDWARE_TERMS },
          ] },
        { id: 'g_unclassified', labelKey: 'reports.tpl.g_unclassified_hw_missing', enabled: true,
          conditions: [
            { id: 'c5', field: 'category', op: 'empty' },
            { id: 'c6', field: 'text_line', op: 'contains_any', terms: HARDWARE_TERMS },
            { id: 'c7', field: 'text_line', op: 'contains_any', terms: MISSING_TERMS },
          ] },
      ],
      columns: HARDWARE_COLUMNS,
      sort: [{ field: 'issue_reception_date', dir: 'desc' }],
      summary: { dims: [{ field: 'issue_reception_date', time: 'month' }] },
    }),
  },
  {
    id: 'blank',
    icon: 'ti-file-plus',
    fileSlug: 'Rapport',
    config: () => ({
      v: CONFIG_VERSION, granularity: 'line', view: 'detail', indicators: true,
      period: basePeriod(),
      filters: [],
      groups: [],
      columns: ['occurrence_no', 'sc_number', 'issue_reception_date', 'line_title', 'category', 'department', 'plant', 'affected_qty', 'cost_net', 'status'],
      sort: [{ field: 'issue_reception_date', dir: 'desc' }],
      summary: { dims: [{ field: 'plant' }] },
    }),
  },
]

export const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map(t => [t.id, t]))

let seq = 0
export const newId = (prefix = 'c') => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`

// Nettoie une configuration (enregistrée, éventuellement ancienne) : champs
// retirés du catalogue écartés, valeurs par défaut complétées. Ne modifie jamais
// l'objet reçu.
export function normalizeConfig(input) {
  const parsed = JSON.parse(JSON.stringify(input || {}))
  const cfg = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const out = { v: CONFIG_VERSION }
  out.granularity = GRANULARITIES.includes(cfg.granularity) ? cfg.granularity : 'line'
  out.view = cfg.view === 'summary' ? 'summary' : 'detail'
  out.indicators = cfg.indicators !== false

  const p = cfg.period || {}
  out.period = {
    field: PERIOD_FIELDS.includes(p.field) ? p.field : 'issue_reception_date',
    mode: ['none', 'fixed', 'relative'].includes(p.mode) ? p.mode : 'relative',
    preset: RELATIVE_PRESETS.includes(p.preset) ? p.preset : 'last_12_months',
    from: p.from || null,
    to: p.to || null,
    includeEmpty: !!p.includeEmpty,
  }

  // Une configuration vient de la base (éventuellement partagée) : chaque partie
  // est vérifiée pour qu'un contenu malformé ne fasse jamais planter l'écran.
  const arr = (v) => (Array.isArray(v) ? v : [])
  const scalar = (v) => (typeof v === 'string' || typeof v === 'number' ? v : null)
  const idOf = (v, prefix) => (typeof v === 'string' && v ? v.slice(0, 60) : newId(prefix))
  const cleanCond = (c) => {
    if (!c || typeof c !== 'object') return null
    const field = FIELD_MAP[c.field]
    if (!field || field.columnOnly || !field.ops.includes(c.op)) return null
    return {
      id: idOf(c.id, 'c'), field: c.field, op: c.op,
      ...(Array.isArray(c.values) ? { values: c.values.map(v => (typeof v === 'boolean' ? String(v) : scalar(v))).filter(v => v !== null).map(String) } : {}),
      ...(Array.isArray(c.terms) ? { terms: c.terms.filter(x => typeof x === 'string').map(x => x.slice(0, 200)) } : {}),
      ...(c.min !== undefined ? { min: scalar(c.min) } : {}),
      ...(c.max !== undefined ? { max: scalar(c.max) } : {}),
    }
  }
  out.filters = arr(cfg.filters).map(cleanCond).filter(Boolean)
  out.groups = arr(cfg.groups).filter(g => g && typeof g === 'object').map(g => ({
    id: idOf(g.id, 'g'),
    ...(typeof g.labelKey === 'string' && g.labelKey.startsWith('reports.tpl.') ? { labelKey: g.labelKey } : {}),
    label: typeof g.label === 'string' ? g.label.slice(0, 200) : '',
    enabled: g.enabled !== false,
    conditions: arr(g.conditions).map(cleanCond).filter(Boolean),
  }))

  const cols = arr(cfg.columns).filter(id => typeof id === 'string' && FIELD_MAP[id] && !FIELD_MAP[id].filterOnly)
  out.columns = [...new Set(cols)]
  if (!out.columns.length) out.columns = ['occurrence_no', 'sc_number', 'issue_reception_date', 'line_title']
  out.sort = arr(cfg.sort).filter(s => s && FIELD_MAP[s.field] && !FIELD_MAP[s.field].filterOnly)
    .map(s => ({ field: s.field, dir: s.dir === 'asc' ? 'asc' : 'desc' })).slice(0, 2)
  const dims = arr(cfg.summary?.dims).filter(d => d && FIELD_MAP[d.field] && (!d.time || TIME_BUCKETS.includes(d.time)))
    .map(d => (d.time ? { field: d.field, time: d.time } : { field: d.field })).slice(0, 2)
  out.summary = { dims: dims.length ? dims : [{ field: 'issue_reception_date', time: 'month' }] }
  return out
}
