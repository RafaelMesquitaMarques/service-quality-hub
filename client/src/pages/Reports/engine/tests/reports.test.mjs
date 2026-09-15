// Tests du module Rapports — `npm run test:reports` (Node ≥ 22, sans dépendance).
// Couvre : période et champ de date, filtres combinés, occurrences multi-lignes
// sans double comptage, coûts ligne / occurrence, champs vides, export Excel et
// CSV (volume > pagination, types, zéros en tête, accents, formules), droits,
// modèles et traductions.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildRows } from '../dataset.js'
import { runReport, summarize, monthlyEvolution } from '../aggregate.js'
import { resolvePeriod, resolvePreset, timeBucket } from '../period.js'
import { compileReport, groupMatchCounts } from '../filters.js'
import { termMatcher } from '../text.js'
import { FIELDS, FIELD_GROUPS } from '../fields.js'
import { EMPTY, RELATIVE_PRESETS, TIME_BUCKETS, GRANULARITIES, validScNumber } from '../constants.js'
import { TEMPLATES, TEMPLATE_MAP, normalizeConfig } from '../templates.js'
import { exportReportXlsx, exportReportCsv, exportFileName, kpiList, slugify, csvFormatForLocale } from '../exportReport.js'
import { csvField } from '../csv.js'
import { dateSerial } from '../xlsxWriter.js'
import { reportRights, canUpdateSavedReport, canDeleteSavedReport, canViewSavedReport, canCreateWithVisibility } from '../permissions.js'
import { valueOptions } from '../options.js'
import { buildXlsxWithImage } from '../../../../utils/xlsxImage.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(here, '../../../../..')
const require = createRequire(path.join(clientDir, 'package.json'))
const XLSX = require('xlsx')

// ── i18n : t() minimal (interpolation + pluriels _one/_other) ───────────────
const dict = {
  fr: JSON.parse(fs.readFileSync(path.join(clientDir, 'src/i18n/fr.json'), 'utf8')),
  en: JSON.parse(fs.readFileSync(path.join(clientDir, 'src/i18n/en.json'), 'utf8')),
}
const lookup = (lang, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict[lang])
const missingKeys = new Set()
const makeT = (lang) => (key, opts = {}) => {
  let v
  if (opts.count !== undefined) v = lookup(lang, `${key}_${opts.count === 1 || (lang === 'fr' && opts.count === 0) ? 'one' : 'other'}`)
  if (v === undefined) v = lookup(lang, key)
  if (typeof v !== 'string') { missingKeys.add(`${lang}:${key}`); return key }
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] !== undefined ? String(opts[k]) : ''))
}
const t = makeT('fr')

// ── Jeu de données synthétique ─────────────────────────────────────────────
const U1 = '00000000-0000-0000-0000-0000000000u1'
function fixture() {
  const tickets = [
    { id: 'T1', occurrence_no: 101, sc_number: '70001', status: 'completed', issue_reception_date: '2026-01-31', delivery_date: '2026-03-01',
      project_name: 'HIEX Test, QC', created_by: U1, plant: 'QS', affected_qty: 2, total_qty: 10, quality_issue: 'Missing HDW kit' },
    { id: 'T2', occurrence_no: 102, sc_number: '70001', status: 'completed', issue_reception_date: '2026-02-01', delivery_date: null,
      ship_to: 'Hôtel Québec, QC', sold_to: 'Client A', item: 'HDR-1', material_number: '0099', categories: 'Hardware', department: 'Client',
      plant: 'NL', affected_qty: 5, total_qty: 20, cost_approx: 300, quality_issue: 'Missing screws', ref_so: '555' },
    { id: 'T3', occurrence_no: 103, sc_number: '-', status: 'completed', issue_reception_date: '2025-12-01', categories: 'Missing Component',
      department: 'Shipping', plant: 'QS', affected_qty: 3, total_qty: 3, cost_approx: 80, quality_issue: 'Missing hardware (bolts)', item: '5', material_number: 'ABC' },
    { id: 'T4', occurrence_no: 104, sc_number: '70002', status: 'cancelled', issue_reception_date: '2026-02-28', delivery_date: '2026-01-15',
      created_by: U1, cost_approx: 999, quality_issue: 'Wood issue' },
    { id: 'T5', occurrence_no: 105, sc_number: null, status: 'quality_meeting', issue_reception_date: '2026-03-01', created_by: U1, quality_issue: 'Broken glide' },
  ]
  const lines = [
    { id: 'L1a', occurrence_id: 'T1', sort_order: 0, quality_issue: 'Missing HDW kit', description: 'Écrou manquant, screws', categories: 'Hardware', department: 'Production',
      plant: 'QS', line_item: '0012', foliot_id: '007000001', affected_qty: 2, total_qty: 10, cost_furniture: 100, cost_freight: 50, cost_approx: 150 },
    { id: 'L1b', occurrence_id: 'T1', sort_order: 1, quality_issue: '=HYPERLINK("http://x")', description: 'ligne 1\nligne 2, "citée"', categories: 'Damaged',
      plant: 'NL', line_item: '0013', affected_qty: 1, total_qty: null, cost_furniture: 200, cost_approx: 200 },
    { id: 'L2', occurrence_id: 'T2', sort_order: 0, quality_issue: 'Missing screws', categories: 'Hardware', plant: 'NL', affected_qty: 5, cost_furniture: 300, cost_approx: 300, ref_so: '555' },
    { id: 'L4a', occurrence_id: 'T4', sort_order: 0, quality_issue: 'Wood issue', categories: 'Wood' },
    { id: 'L4b', occurrence_id: 'T4', sort_order: 1, quality_issue: 'Wood issue 2', categories: 'Wood' },
    { id: 'L5', occurrence_id: 'T5', sort_order: 0, quality_issue: 'Broken glide', affected_qty: 4, cost_furniture: 40, cost_approx: 40 },
  ]
  return { tickets, lines, profiles: [{ id: U1, full_name: 'Émilie Tremblay' }], meetingLinks: [{ ticket_id: 'T1', meeting_date: '2026-02-04' }], costEditedIds: [] }
}
const baseConfig = (patch = {}) => normalizeConfig({
  granularity: 'line', view: 'detail', period: { mode: 'none' }, filters: [], groups: [],
  columns: ['occurrence_no', 'sc_number', 'issue_reception_date', 'item', 'foliot_id', 'line_title', 'description', 'ship_to', 'cost_furniture', 'cost_freight', 'cost_net', 'affected_qty'],
  ...patch,
})
const run = (rows, cfg) => runReport(rows, cfg, { today: '2026-09-15', labelOf: g => g.label || g.id })
const ids = (res) => res.matched.map(r => r.row_key).sort()

// ── Jeu de données ───────────────────────────────────────────────────────────
test('buildRows : une ligne par article, occurrence sans ligne = ligne en-tête', () => {
  const rows = buildRows(fixture())
  assert.equal(rows.length, 7)
  const by = Object.fromEntries(rows.map(r => [r.row_key, r]))
  assert.equal(by['T3:header'].has_line, false)
  assert.equal(by['T3:header'].category, 'Missing Component')
  assert.equal(by['T3:header'].cost_split_status, 'legacy_total')
  assert.equal(by['T3:header'].cost_furniture, null)
  assert.equal(by['T3:header'].cost_net, 80)
})

test('repli en-tête : item / Foliot ID / quantités seulement pour une occurrence à une ligne', () => {
  const by = Object.fromEntries(buildRows(fixture()).map(r => [r.row_key, r]))
  assert.equal(by.L2.item, 'HDR-1')
  assert.equal(by.L2.foliot_id, '0099')
  assert.equal(by.L2.total_qty, 20)
  // T1 a deux lignes : l'en-tête (copie de la ligne 1) ne se replie pas sur la ligne 2.
  assert.equal(by.L1b.total_qty, null)
  assert.equal(by.L1b.affected_qty, 1)
  assert.equal(by.L1b.plant, 'NL')
  assert.equal(by.L1a.item, '0012')
})

test('classification : repli en-tête pour toute ligne non classée, sinon (Non renseigné)', () => {
  const by = Object.fromEntries(buildRows(fixture()).map(r => [r.row_key, r]))
  assert.equal(by.L2.department, 'Client')
  assert.equal(by.L2.category_source, 'line')
  assert.equal(by.L5.category, null)
  assert.equal(by.L5.category_source, 'none')
})

test('coûts : historique importé non ventilé, coût d\'en-tête porté une seule fois', () => {
  const by = Object.fromEntries(buildRows(fixture()).map(r => [r.row_key, r]))
  assert.equal(by.L2.cost_split_status, 'legacy_total')
  assert.equal(by.L2.cost_furniture, null, 'coût pièce non inventé pour l\'import (transport inclus)')
  assert.equal(by.L2.cost_net, 300)
  assert.equal(by.L1a.cost_split_status, 'split')
  assert.equal(by.L1a.cost_furniture, 100)
  assert.equal(by.L4a.cost_net, 999)
  assert.equal(by.L4a.cost_split_status, 'occurrence_level')
  assert.equal(by.L4b.cost_net, null)
  assert.equal(by.L4b.cost_split_status, 'none')
  assert.equal(by.L1a.occ_cost, 350)
})

test('coût unique d\'avant la ventilation (2026-07-09) : ligne saisie dans l\'application aussi non ventilée', () => {
  const data = fixture()
  const l5 = data.lines.find(l => l.id === 'L5')
  l5.created_at = '2026-06-20T14:00:00+00:00'            // T5 : occurrence de l'application
  let by = Object.fromEntries(buildRows(data).map(r => [r.row_key, r]))
  assert.equal(by.L5.cost_split_status, 'legacy_total')
  assert.equal(by.L5.cost_furniture, null)
  assert.equal(by.L5.cost_net, 40)
  l5.created_at = '2026-07-15T14:00:00+00:00'
  by = Object.fromEntries(buildRows(data).map(r => [r.row_key, r]))
  assert.equal(by.L5.cost_split_status, 'split')
  assert.equal(by.L5.cost_furniture, 40)
  // Avant la date mais repris poste par poste (mobilier ≠ total) : ventilé.
  l5.created_at = '2026-06-20T14:00:00+00:00'; l5.cost_furniture = 30
  by = Object.fromEntries(buildRows(data).map(r => [r.row_key, r]))
  assert.equal(by.L5.cost_split_status, 'split')
})

test('un import modifié dans l\'application (historique de coût) n\'est plus marqué non ventilé', () => {
  const data = fixture()
  data.costEditedIds = ['T2']
  const by = Object.fromEntries(buildRows(data).map(r => [r.row_key, r]))
  assert.equal(by.L2.cost_split_status, 'split')
  assert.equal(by.L2.cost_furniture, 300)
})

test('transport identique sur plusieurs lignes : signalé, excédent possible chiffré, jamais dédoublonné', () => {
  const data = fixture()
  data.lines.find(l => l.id === 'L1b').cost_freight = 50
  const rows = buildRows(data)
  const by = Object.fromEntries(rows.map(r => [r.row_key, r]))
  assert.equal(by.L1a.freight_repeated, true)
  assert.equal(by.L1b.freight_repeated, true)
  assert.equal(by.L2.freight_repeated, null)
  const res = run(rows, baseConfig())
  assert.equal(res.metrics.measures.cost_freight.sum, 100)       // montants tels que saisis
  assert.equal(res.metrics.freightRepeatedExtra, 50)
  assert.equal(res.metrics.freightRepeatedOccurrences, 1)
  assert.match(kpiList(res, { t, lang: 'fr' }).find(k => k.key === 'cost_freight').note, /1 occurrence/)
  // Si une seule des deux lignes est retenue, aucun excédent n'est compté.
  const one = run(rows, baseConfig({ filters: [{ id: 'a', field: 'category', op: 'in', values: ['Hardware'] }] }))
  assert.equal(one.metrics.freightRepeatedExtra, 0)
})

test('SC# : valeurs de remplissage ignorées, SC# partagé = un seul appel', () => {
  assert.equal(validScNumber('-'), null)
  assert.equal(validScNumber('  '), null)
  assert.equal(validScNumber('0123'), '0123')
  const rows = buildRows(fixture())
  const res = run(rows, baseConfig())
  assert.equal(res.metrics.occurrences, 5)
  assert.equal(res.metrics.calls, 4)          // 70001 (T1+T2), 70002, T3 (« - »), T5 (sans SC#)
  assert.equal(res.metrics.callsWithoutSc, 2)
})

// ── Périodes ────────────────────────────────────────────────────────────────
test('périodes relatives : mois, 12 mois, année fiscale (décembre = mois 1)', () => {
  assert.deepEqual(resolvePreset('last_12_months', '2026-09-15'), { from: '2025-10-01', to: '2026-09-30' })
  assert.deepEqual(resolvePreset('previous_month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(resolvePreset('current_fiscal_year', '2026-09-15'), { from: '2025-12-01', to: '2026-11-30' })
  assert.deepEqual(resolvePreset('current_fiscal_year', '2026-12-05'), { from: '2026-12-01', to: '2027-11-30' })
  assert.deepEqual(resolvePreset('previous_fiscal_year', '2026-09-15'), { from: '2024-12-01', to: '2025-11-30' })
  assert.deepEqual(resolvePreset('fiscal_ytd', '2026-02-10'), { from: '2025-12-01', to: '2026-02-10' })
  assert.deepEqual(resolvePreset('current_month', '2024-02-10'), { from: '2024-02-01', to: '2024-02-29' })
  assert.equal(timeBucket('2025-12-15', 'fiscal_quarter'), 'FY2026-T1')
  assert.equal(timeBucket('2026-03-01', 'quarter'), '2026-T1')
  assert.equal(timeBucket('2025-12-15', 'fiscal_year'), 'FY2026')
  for (const p of RELATIVE_PRESETS) assert.ok(resolvePreset(p, '2026-09-15').from, p)
})

test('période fixe : bornes incluses, inversées remises en ordre', () => {
  const rows = buildRows(fixture())
  const cfg = baseConfig({ period: { field: 'issue_reception_date', mode: 'fixed', from: '2026-01-31', to: '2026-02-01' } })
  assert.deepEqual(ids(run(rows, cfg)), ['L1a', 'L1b', 'L2'])
  const inverted = resolvePeriod({ field: 'issue_reception_date', mode: 'fixed', from: '2026-02-01', to: '2026-01-31' })
  assert.deepEqual([inverted.from, inverted.to], ['2026-01-31', '2026-02-01'])
})

test('choix du champ de date : réception ≠ livraison ; sans date exclue sauf demande', () => {
  const rows = buildRows(fixture())
  const byDelivery = baseConfig({ period: { field: 'delivery_date', mode: 'fixed', from: '2026-01-01', to: '2026-03-31' } })
  assert.deepEqual(ids(run(rows, byDelivery)), ['L1a', 'L1b', 'L4a', 'L4b'])
  const byReception = baseConfig({ period: { field: 'issue_reception_date', mode: 'fixed', from: '2026-01-01', to: '2026-03-31' } })
  assert.deepEqual(ids(run(rows, byReception)), ['L1a', 'L1b', 'L2', 'L4a', 'L4b', 'L5'])
  const withEmpty = baseConfig({ period: { field: 'delivery_date', mode: 'fixed', from: '2026-01-01', to: '2026-03-31', includeEmpty: true } })
  assert.deepEqual(ids(run(rows, withEmpty)), ['L1a', 'L1b', 'L2', 'L4a', 'L4b', 'L5', 'T3:header'])
})

// ── Filtres ─────────────────────────────────────────────────────────────────
test('filtres combinés : ET entre filtres, OU entre valeurs d\'un filtre', () => {
  const rows = buildRows(fixture())
  const cfg = baseConfig({ filters: [
    { id: 'a', field: 'category', op: 'in', values: ['Hardware', 'Missing Component'] },
    { id: 'b', field: 'plant', op: 'in', values: ['NL'] },
  ] })
  assert.deepEqual(ids(run(rows, cfg)), ['L2'])
  const orOnly = baseConfig({ filters: [{ id: 'a', field: 'category', op: 'in', values: ['Hardware', 'Missing Component'] }] })
  assert.deepEqual(ids(run(rows, orOnly)), ['L1a', 'L2', 'T3:header'])
})

test('champs vides : (Non renseigné), est non renseigné, exclusion', () => {
  const rows = buildRows(fixture())
  assert.deepEqual(ids(run(rows, baseConfig({ filters: [{ id: 'a', field: 'category', op: 'in', values: [EMPTY] }] }))), ['L5'])
  assert.deepEqual(ids(run(rows, baseConfig({ filters: [{ id: 'a', field: 'ship_to', op: 'not_empty' }] }))), ['L2'])
  assert.deepEqual(ids(run(rows, baseConfig({ filters: [{ id: 'a', field: 'status', op: 'not_in', values: ['cancelled'] }] }))).length, 5)
  // Condition incomplète : ignorée ET signalée, jamais « zéro résultat » silencieux.
  const res = run(rows, baseConfig({ filters: [{ id: 'x', field: 'plant', op: 'in', values: [] }] }))
  assert.equal(res.matched.length, 7)
  assert.deepEqual(res.compiled.incomplete, ['x'])
  const opts = valueOptions(rows, 'plant', { referential: ['QS', 'NL'] })
  assert.equal(opts[0].value, EMPTY)
  assert.equal(opts[0].count, 3)   // L4a, L4b (T4 sans usine) et L5 (T5 sans usine)
  assert.equal(opts.find(o => o.value === 'QS').outOfReferential, false)
})

test('bornes numériques incluses ; valeur absente jamais comptée comme 0', () => {
  const rows = buildRows(fixture())
  assert.deepEqual(ids(run(rows, baseConfig({ filters: [{ id: 'a', field: 'cost_net', op: 'between', min: 150, max: 300 }] }))), ['L1a', 'L1b', 'L2'])
  assert.deepEqual(ids(run(rows, baseConfig({ filters: [{ id: 'a', field: 'affected_qty', op: 'between', max: 0 }] }))), [])
  const res = run(rows, baseConfig())
  assert.equal(res.metrics.measures.cost_install.sum, null)
  assert.equal(res.metrics.measures.cost_install.missing, 7)
  assert.equal(res.metrics.measures.affected_qty.sum, 15)
  assert.equal(res.metrics.measures.affected_qty.missing, 2)
})

test('recherche textuelle : début de mot, sans casse ni accents', () => {
  const m = termMatcher(['ecrou'])
  assert.equal(m('Écrou manquant'), true)
  assert.equal(termMatcher(['crou'])('Écrou manquant'), false)
  assert.equal(termMatcher(['screw'])('drawer-screws'), true)
  assert.equal(termMatcher(['vis'])('révision'), false)
  assert.equal(termMatcher(['not received'])('Parts NOT   received'), true)
  const rows = buildRows(fixture())
  const cfg = baseConfig({ groups: [{ id: 'g', label: 'txt', conditions: [{ id: 'c', field: 'text_line', op: 'contains_any', terms: ['screw'] }] }] })
  const res = run(rows, cfg)
  assert.deepEqual(ids(res), ['L1a', 'L2'])
  assert.equal(res.compiled.groups[0].textual, true)
})

test('groupes OU + part des appels du périmètre', () => {
  const rows = buildRows(fixture())
  const cfg = baseConfig({
    filters: [{ id: 's', field: 'status', op: 'not_in', values: ['cancelled'] }],
    groups: [
      { id: 'hw', label: 'Hardware', conditions: [{ id: 'c1', field: 'category', op: 'in', values: ['Hardware'] }] },
      { id: 'mc', label: 'MC', conditions: [{ id: 'c2', field: 'category', op: 'in', values: ['Missing Component'] }, { id: 'c3', field: 'text_line', op: 'contains_any', terms: ['hardware'] }] },
      { id: 'off', label: 'Off', enabled: false, conditions: [{ id: 'c4', field: 'plant', op: 'empty' }] },
    ],
  })
  const res = run(rows, cfg)
  assert.deepEqual(ids(res), ['L1a', 'L2', 'T3:header'])
  assert.equal(res.metrics.calls, 2)              // 70001 + T3
  assert.equal(res.scopeMetrics.calls, 3)         // 70001, T3, T5 (T4 annulée exclue)
  assert.equal(res.share, 2 / 3)
  assert.deepEqual(res.matched.find(r => r.row_key === 'T3:header').matched_criteria, ['MC'])
  const counts = groupMatchCounts(res.scopeRows, cfg.groups)
  assert.equal(counts.off, 1)                     // groupe désactivé : compte affiché quand même
})

// ── Granularité et agrégations ─────────────────────────────────────────────
test('multi-lignes : totaux identiques par article, occurrence et appel', () => {
  const rows = buildRows(fixture())
  const sums = {}
  for (const g of GRANULARITIES) {
    const res = run(rows, baseConfig({ granularity: g }))
    sums[g] = {
      n: res.records.length,
      cost: res.records.reduce((s, r) => s + (r.cost_net || 0), 0),
      qty: res.records.reduce((s, r) => s + (r.affected_qty || 0), 0),
      occCost: res.records.reduce((s, r) => s + (r.occ_cost || 0), 0),
    }
  }
  assert.deepEqual([sums.line.n, sums.occurrence.n, sums.call.n], [7, 5, 4])
  for (const g of GRANULARITIES) {
    assert.equal(sums[g].cost, 150 + 200 + 300 + 80 + 999 + 40, g)
    assert.equal(sums[g].qty, 15, g)
  }
  // occ_cost (niveau occurrence) : 1 fois par occurrence en vue occurrence / appel.
  assert.equal(sums.occurrence.occCost, 350 + 300 + 80 + 999 + 40)
  assert.equal(sums.call.occCost, 350 + 300 + 80 + 999 + 40)
  const call = run(rows, baseConfig({ granularity: 'call' })).records.find(r => r.row_key === 'sc:70001')
  assert.equal(call.matched_occurrences, 2)
  assert.equal(call.issue_reception_date, '2026-01-31')   // plus ancienne
  assert.deepEqual(call._occLinks.map(l => l.no), [101, 102])
})

test('résumé : un article = un groupe ; appels distincts par groupe ; part par groupe', () => {
  const rows = buildRows(fixture())
  const cfg = baseConfig({ groups: [{ id: 'g', label: 'HW', conditions: [{ id: 'c', field: 'category', op: 'in', values: ['Hardware'] }] }] })
  const res = run(rows, cfg)
  const byPlant = summarize(res.matched, res.scopeRows, [{ field: 'plant' }], { hasTheme: true })
  const qs = byPlant.find(g => g.values[0] === 'QS'), nl = byPlant.find(g => g.values[0] === 'NL')
  assert.equal(qs.metrics.calls, 1); assert.equal(nl.metrics.calls, 1)
  assert.equal(qs.metrics.measures.cost_net.sum + nl.metrics.measures.cost_net.sum, res.metrics.measures.cost_net.sum)
  assert.equal(nl.scopeCalls, 1)        // l'appel 70001 a des articles NL (L1b, L2)
  assert.equal(nl.share, 1)
  const byMonth = summarize(res.matched, res.scopeRows, [{ field: 'issue_reception_date', time: 'month' }], { hasTheme: true })
  assert.deepEqual(byMonth.map(g => g.values[0]), ['2026-01', '2026-02'])
  const evo = monthlyEvolution(res.matched, res.scopeRows, { from: '2025-12-01', to: '2026-03-31', hasTheme: true })
  assert.deepEqual(evo.map(e => e.month), ['2025-12', '2026-01', '2026-02', '2026-03'])
  assert.equal(evo[0].metrics.calls, 0)
  assert.equal(evo[0].share, 0)
})

test('résumé à deux niveaux : lignes regroupées par la 1re dimension', () => {
  const tickets = [], lines = []
  const add = (i, plant, cat) => {
    tickets.push({ id: `S${i}`, occurrence_no: i, sc_number: `8${i}`, status: 'completed', issue_reception_date: '2026-03-01', created_by: U1, quality_issue: 'x' })
    lines.push({ id: `SL${i}`, occurrence_id: `S${i}`, sort_order: 0, quality_issue: 'x', plant, categories: cat, cost_approx: 1 })
  }
  ;[['QS', 'Hardware'], ['QS', 'Hardware'], ['QS', 'Hardware'], ['QM', 'Damaged'], ['QM', 'Damaged'], ['QS', 'Damaged']].forEach(([p, c], i) => add(i + 1, p, c))
  const rows = buildRows({ tickets, lines })
  const groups = summarize(rows, rows, [{ field: 'plant' }, { field: 'category' }])
  assert.deepEqual(groups.map(g => g.values.join('/')), ['QS/Hardware', 'QS/Damaged', 'QM/Damaged'])
})

test('configuration enregistrée malformée : normalisée sans planter', () => {
  assert.equal(normalizeConfig({ columns: ['constructor', '__proto__', 'toString', 'item'], filters: [{ field: '__proto__', op: 'in', values: ['x'] }, { field: 'constructor', op: 'empty' }] }).filters.length, 0)
  assert.deepEqual(normalizeConfig({ columns: ['constructor', '__proto__', 'item'] }).columns, ['item'])
  const garbage = { columns: 'item', filters: { a: 1 }, groups: [null, 'x', { conditions: 'y', label: 42 }, { conditions: [{ field: 'category', op: 'in', values: [{}, 'Hardware', true] }] }], sort: 'z', summary: { dims: 'q' }, period: 7 }
  const cfg = normalizeConfig(garbage)
  assert.deepEqual(cfg.filters, [])
  assert.equal(cfg.groups.length, 2)
  assert.deepEqual(cfg.groups[1].conditions[0].values, ['Hardware', 'true'])
  assert.ok(cfg.columns.length > 0)
  assert.deepEqual(cfg.sort, [])
  assert.doesNotThrow(() => normalizeConfig('texte'))
  assert.doesNotThrow(() => normalizeConfig([1, 2]))
  assert.doesNotThrow(() => run(buildRows(fixture()), normalizeConfig(garbage)))
})

// ── Export ─────────────────────────────────────────────────────────────────
function unzip(buf) {
  const files = {}
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28)
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize)
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8')
    p += 46 + nlen + xlen + clen
  }
  return files
}

// 250 occurrences (> PAGE_SIZE de l'écran) + le jeu de base.
function bigFixture() {
  const data = fixture()
  for (let i = 0; i < 250; i++) {
    const id = `B${i}`
    data.tickets.push({ id, occurrence_no: 1000 + i, sc_number: `9${String(i).padStart(4, '0')}`, status: 'completed',
      issue_reception_date: `2026-0${1 + (i % 6)}-15`, created_by: U1, quality_issue: `Missing hardware ${i}` })
    data.lines.push({ id: `BL${i}`, occurrence_id: id, sort_order: 0, quality_issue: `Missing hardware ${i}`, categories: 'Hardware',
      plant: i % 2 ? 'QS' : 'NL', line_item: `00${i}`, affected_qty: 1, cost_furniture: 10.5, cost_freight: 2.25, cost_approx: 12.75 })
  }
  return data
}
const exportCtx = { t, lang: 'fr', reportName: 'Hardware manquant', reportDescription: 'Test', templateName: 'Modèle', userName: 'Émilie Tremblay',
  generatedAt: new Date('2026-09-15T14:30:00'), baseUrl: 'https://checkmate.example', today: '2026-09-15' }

test('export Excel : toutes les lignes, 3 onglets, types, zéros en tête, accents, formules neutralisées', async () => {
  const rows = buildRows(bigFixture())
  const cfg = baseConfig({ view: 'summary', summary: { dims: [{ field: 'plant' }] },
    groups: [{ id: 'g', label: 'HW', conditions: [{ id: 'c', field: 'category', op: 'in', values: ['Hardware', 'Damaged', 'Missing Component', EMPTY] }] }] })
  const res = run(rows, cfg)
  assert.ok(res.records.length > 100, 'plus de lignes que la pagination de l\'écran')
  const bytes = await exportReportXlsx(res, cfg, exportCtx)
  const buf = Buffer.from(bytes)
  const tmp = path.join(os.tmpdir(), `checkmate-report-test-${process.pid}.xlsx`)
  fs.writeFileSync(tmp, buf)

  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true })
  assert.deepEqual(wb.SheetNames, ['Données', 'Paramètres', 'Synthèse'])
  const data = XLSX.utils.sheet_to_json(wb.Sheets['Données'], { header: 1, raw: true, defval: null })
  assert.equal(data.length, res.records.length + 1)
  const header = data[0]
  assert.equal(header[0], 'N° occurrence (#)')
  assert.equal(header[header.length - 1], 'Lien Checkmate')

  const ws = wb.Sheets['Données']
  const col = (label) => header.indexOf(label)
  const rowOf = (occNo) => data.findIndex(r => r[0] === occNo)
  const r101 = rowOf(101)
  const cellAt = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
  // Identifiants : texte, zéros en tête préservés.
  const itemCell = data.slice(1).map((r, i) => ({ r: i + 1, v: r[col('Item')] })).find(x => x.v === '0012')
  assert.ok(itemCell, 'item 0012 présent')
  assert.equal(cellAt(itemCell.r, col('Item')).t, 's')
  assert.equal(cellAt(r101, col('Foliot ID')).v, '007000001')
  // Dates : vrais nombres de série au format date.
  const dcell = cellAt(r101, col('Date de réception (appel de service)'))
  assert.equal(dcell.t, 'n')
  assert.equal(dcell.v, dateSerial('2026-01-31'))
  assert.match(dcell.z, /yyyy/)
  // Montants : nombres.
  assert.equal(cellAt(r101, col('Coût pièce / mobilier')).t, 'n')
  // Accents et texte multiligne.
  assert.ok(data.some(r => r[col('Ship to (destination)')] === 'Hôtel Québec, QC'))
  assert.ok(data.some(r => r[col('Description (ligne)')] === 'ligne 1\nligne 2, "citée"'))
  // Texte ressemblant à une formule : chaîne, jamais de formule.
  const fr = data.findIndex(r => r[col('Problème (ligne)')] === '=HYPERLINK("http://x")')
  assert.ok(fr > 0)
  const fcell = cellAt(fr, col('Problème (ligne)'))
  assert.equal(fcell.t, 's')
  assert.equal(fcell.f, undefined)

  // Correspondance tableau ↔ totaux ↔ fichier.
  const fileCost = data.slice(1).reduce((s, r) => s + (r[col('Coût total net (ligne)')] || 0), 0)
  assert.equal(Math.round(fileCost * 100), Math.round(res.metrics.measures.cost_net.sum * 100))
  const synth = XLSX.utils.sheet_to_json(wb.Sheets['Synthèse'], { header: 1, raw: true, defval: null })
  const kCalls = synth.find(r => r[0] === 'Appels de service distincts')
  assert.equal(kCalls[1], res.metrics.calls)
  assert.ok(synth.some(r => r[0] === 'NL'), 'regroupement par usine présent')
  const params = XLSX.utils.sheet_to_json(wb.Sheets['Paramètres'], { header: 1, raw: true, defval: null })
  assert.ok(params.some(r => r[0] === 'Lignes exportées (onglet Données)' && r[1] === res.records.length))
  assert.ok(params.some(r => r[0] === 'Granularité'))

  // OOXML : volet figé, filtre automatique, lien hypertexte, formule absente.
  const parts = unzip(buf)
  assert.match(parts['xl/worksheets/sheet1.xml'], /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/)
  assert.match(parts['xl/worksheets/sheet1.xml'], new RegExp(`<autoFilter ref="A1:[A-Z]+${res.records.length + 1}"/>`))
  assert.doesNotMatch(parts['xl/worksheets/sheet1.xml'], /<f>/)
  assert.match(parts['xl/worksheets/_rels/sheet1.xml.rels'], /https:\/\/checkmate\.example\/tickets\/T1/)
  assert.match(parts['xl/workbook.xml'], /_xlnm\._FilterDatabase/)
  fs.rmSync(tmp, { force: true })
})

test('export CSV : toutes les lignes, BOM, délimiteurs / sauts de ligne, anti-formule', () => {
  const rows = buildRows(bigFixture())
  const cfg = baseConfig()
  const res = run(rows, cfg)
  const csv = exportReportCsv(res, cfg, exportCtx)
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  const parsed = XLSX.read(csv.slice(1), { type: 'string', raw: true })
  const grid = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, raw: true, defval: '' })
  assert.equal(grid.length, res.records.length + 1)
  assert.ok(csv.includes('"ligne 1\nligne 2, ""citée"""'))
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")"'))
  assert.ok(csv.includes('Hôtel Québec'))
  // Réglages régionaux à virgule décimale (fr-CA) : « ; » et décimales « , ».
  assert.deepEqual(csvFormatForLocale('fr-CA'), { delimiter: ';', decimal: ',' })
  assert.deepEqual(csvFormatForLocale('en-US'), { delimiter: ',', decimal: '.' })
  const csvFr = exportReportCsv(res, cfg, exportCtx, csvFormatForLocale('fr-CA'))
  const lineL1a = csvFr.split('\r\n').find(l => l.startsWith('101;'))
  assert.ok(lineL1a.includes(';0012;'), lineL1a)
  assert.ok(lineL1a.includes(';150;') || lineL1a.includes(';100;'), lineL1a)
  const b0 = csvFr.split('\r\n').find(l => l.startsWith('1000;'))
  assert.ok(b0.includes(';10,5;2,25;12,75;'), b0)
  assert.equal(csvField('-12', { isText: true }), "'-12")
  // Texte contenant l'AUTRE séparateur : toujours entre guillemets.
  assert.equal(csvField('a,=1+1', { delimiter: ';' }), '"a,=1+1"')
  assert.equal(csvField('a;=1+1', { delimiter: ',' }), '"a;=1+1"')
  assert.equal(csvField(-12, { isText: false }), '-12')
})

test('nom de fichier descriptif', () => {
  assert.equal(exportFileName({ slug: 'Hardware_Manquant', period: { from: '2026-01-01', to: '2026-08-31' }, ext: 'xlsx', today: '2026-09-15' }),
    'Checkmate_Hardware_Manquant_2026-01-01_2026-08-31.xlsx')
  assert.equal(slugify('Réclamations — Québec 2026'), 'Reclamations_Quebec_2026')
  assert.equal(exportFileName({ slug: 'X', period: null, ext: 'csv', today: '2026-09-15' }), 'Checkmate_X_toutes-dates_2026-09-15.csv')
})

test('indicateurs : kpiList identique à l\'écran et à la synthèse, part présente seulement avec un thème', () => {
  const rows = buildRows(fixture())
  const noTheme = kpiList(run(rows, baseConfig()), { t })
  assert.equal(noTheme.find(k => k.key === 'share'), undefined)
  const withTheme = kpiList(run(rows, baseConfig({ groups: [{ id: 'g', label: 'x', conditions: [{ id: 'c', field: 'category', op: 'in', values: ['Hardware'] }] }] })), { t })
  assert.equal(withTheme.find(k => k.key === 'share').value.v, 1 / 4)
  assert.match(withTheme.find(k => k.key === 'cost_net').note, /avant la ventilation/)
})

test('xlsxImage (export du tableau de bord) reste un classeur valide après factorisation du zip', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = buildXlsxWithImage({ sheetName: 'Chart', title: 'Coût', pngBase64: png, imgWidth: 10, imgHeight: 10 })
  const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer' })
  assert.deepEqual(wb.SheetNames, ['Chart'])
  assert.equal(wb.Sheets.Chart.A1.v, 'Coût')
})

// ── Droits ──────────────────────────────────────────────────────────────────
test('droits : partage réservé admin/manager, modification et suppression', () => {
  const cpm = { id: 'c', role: 'cpm' }, mgr = { id: 'm', role: 'manager' }, adm = { id: 'a', role: 'admin' }, other = { id: 'o', role: 'viewer' }
  assert.equal(reportRights(cpm).canShare, false)
  assert.equal(reportRights(mgr).canShare, true)
  assert.equal(reportRights({ ...adm, active: false }).isAdmin, false)
  assert.equal(canCreateWithVisibility(cpm, 'shared'), false)
  assert.equal(canCreateWithVisibility(cpm, 'private'), true)
  const mine = { owner_id: 'c', visibility: 'private' }
  const sharedByMgr = { owner_id: 'm', visibility: 'shared' }
  const privateOfMgr = { owner_id: 'm', visibility: 'private' }
  assert.equal(canViewSavedReport(sharedByMgr, other), true)
  assert.equal(canViewSavedReport(privateOfMgr, other), false)
  assert.equal(canUpdateSavedReport(mine, cpm), true)
  assert.equal(canUpdateSavedReport(mine, cpm, 'shared'), false)
  assert.equal(canUpdateSavedReport(sharedByMgr, cpm), false)
  assert.equal(canUpdateSavedReport(sharedByMgr, adm), true)
  assert.equal(canUpdateSavedReport(sharedByMgr, adm, 'private'), false)
  assert.equal(canUpdateSavedReport(privateOfMgr, adm), false)
  assert.equal(canDeleteSavedReport(sharedByMgr, cpm), false)
  assert.equal(canDeleteSavedReport(sharedByMgr, adm), true)
  assert.equal(canDeleteSavedReport(mine, cpm), true)
})

test('migration RLS : politiques cohérentes avec permissions.js', () => {
  const sql = fs.readFileSync(path.resolve(clientDir, '../server/src/db/migration_2026-09-15_saved_reports.sql'), 'utf8')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.saved_reports FROM anon/)
  for (const p of ['saved_reports_select', 'saved_reports_insert', 'saved_reports_update', 'saved_reports_delete']) assert.match(sql, new RegExp(`CREATE POLICY "${p}"`))
  assert.match(sql, /role IN \('admin', 'manager'\)/)
})

// ── Modèles et configuration ───────────────────────────────────────────────
test('modèles : champs existants, conditions complètes, normalisation sans perte', () => {
  for (const tpl of TEMPLATES) {
    const raw = tpl.config()
    const norm = normalizeConfig(raw)
    assert.deepEqual(norm.columns, raw.columns, tpl.id)
    assert.equal(norm.groups.length, raw.groups.length, tpl.id)
    assert.equal(norm.filters.length, raw.filters.length, tpl.id)
    const compiled = compileReport(norm, { today: '2026-09-15' })
    assert.deepEqual(compiled.incomplete, [], tpl.id)
  }
  const hwMissing = TEMPLATE_MAP.hardware_missing.config()
  const rows = buildRows(fixture())
  const res = run(rows, normalizeConfig({ ...hwMissing, period: { mode: 'none' } }))
  assert.deepEqual(ids(res), ['L1a', 'L2', 'T3:header'])
  const cleaned = normalizeConfig({ columns: ['item', 'n_existe_pas', 'text_line'], filters: [{ field: 'n_existe_pas', op: 'in', values: ['x'] }], sort: [{ field: 'zzz' }] })
  assert.deepEqual(cleaned.columns, ['item'])
  assert.equal(cleaned.filters.length, 0)
  assert.equal(cleaned.sort.length, 0)
})

// ── Intégration ────────────────────────────────────────────────────────────
// esbuild et vite build acceptent un composant JSX non importé (simple variable
// globale) : l'erreur n'apparaît qu'à l'exécution. On vérifie donc les imports.
test('intégration : routes et navigation du module', () => {
  const main = fs.readFileSync(path.join(clientDir, 'src/main.jsx'), 'utf8')
  const used = new Set([...main.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map(m => m[1]))
  for (const name of used) {
    const declared = new RegExp(`(import\\s+${name}\\b|import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}|function\\s+${name}\\b|const\\s+${name}\\b)`).test(main)
    assert.ok(declared, `composant <${name}> utilisé dans main.jsx sans import`)
  }
  assert.match(main, /path="reports"/)
  assert.match(main, /path="reports\/template\/:templateId"/)
  assert.match(main, /path="reports\/saved\/:savedId"/)
  const layout = fs.readFileSync(path.join(clientDir, 'src/components/layout/Layout.jsx'), 'utf8')
  assert.match(layout, /to: '\/reports'/)
})

// ── Traductions ────────────────────────────────────────────────────────────
test('traductions : FR complet (et EN), libellés exigés, clés utilisées présentes', () => {
  for (const lang of ['fr', 'en']) {
    for (const f of FIELDS) {
      assert.equal(typeof lookup(lang, `reports.fields.${f.id}`), 'string', `${lang} fields.${f.id}`)
      assert.equal(typeof lookup(lang, `reports.help.${f.id}`), 'string', `${lang} help.${f.id}`)
    }
    for (const g of FIELD_GROUPS) assert.equal(typeof lookup(lang, `reports.groups_fields.${g}`), 'string')
    for (const p of RELATIVE_PRESETS) assert.equal(typeof lookup(lang, `reports.period.presets.${p}`), 'string')
    for (const b of TIME_BUCKETS) assert.equal(typeof lookup(lang, `reports.time.${b}`), 'string')
    for (const g of GRANULARITIES) for (const s of ['', '_desc', '_badge', '_one'].map(x => x === '_one' ? `unit_${g}_one` : `${g}${x}`)) {
      assert.equal(typeof lookup(lang, `reports.granularity.${s}`), 'string', `${lang} granularity.${s}`)
    }
    for (const op of new Set(FIELDS.flatMap(f => f.ops))) assert.equal(typeof lookup(lang, `reports.ops.${op}`), 'string', `${lang} ops.${op}`)
    for (const tpl of TEMPLATES) {
      assert.equal(typeof lookup(lang, `reports.tpl.${tpl.id}.name`), 'string')
      for (const g of tpl.config().groups) assert.equal(typeof lookup(lang, g.labelKey), 'string', `${lang} ${g.labelKey}`)
    }
    assert.equal(typeof lookup(lang, 'nav.reports'), 'string')
  }
  assert.equal(lookup('fr', 'reports.title'), 'Rapports')
  assert.equal(lookup('fr', 'reports.filters.title'), 'Filtres')
  assert.equal(lookup('fr', 'reports.columns.title'), 'Colonnes')
  assert.equal(lookup('fr', 'reports.preview'), 'Aperçu')
  assert.equal(lookup('fr', 'reports.save.save'), 'Enregistrer')
  assert.equal(lookup('fr', 'reports.export.to_excel'), 'Exporter vers Excel')

  // Clés littérales t('…') des fichiers du module.
  const root = path.resolve(here, '../..')
  const files = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'tests') walk(p) } else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p) } }
  walk(root)
  const keys = new Set()
  for (const file of files) for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g)) keys.add(m[1])
  assert.ok(keys.size > 100)
  for (const lang of ['fr', 'en']) for (const k of keys) {
    const ok = typeof lookup(lang, k) === 'string' || (typeof lookup(lang, `${k}_one`) === 'string' && typeof lookup(lang, `${k}_other`) === 'string')
    assert.ok(ok, `${lang}: ${k}`)
  }
  // Toutes les clés demandées pendant les exports / indicateurs des tests existent.
  assert.deepEqual([...missingKeys], [])
})
