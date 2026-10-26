// Tests des calculs du tableau de bord — `npm run test:dashboard` (Node ≥ 22,
// sans dépendance). Couvre : unité d'événement (ligne), règle de coût (lignes
// chiffrées / repli en-tête), dimensions de ligne et « non défini », filtres,
// client (project_name / ship_to), comparaison N-1 à date égale et couverture,
// SC % (mêmes mois au numérateur et au dénominateur, verdict sous filtre),
// séries mensuelles, marques, table de comparaison, récentes, calendrier fiscal.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildUnits, computeDashboard, sanitizeFilters, brandKey, isTitled,
  NONE, ALL, OTHERS, BRAND_SERIES,
} from '../metrics.js'
import {
  getFiscalYear, getFiscalMonth, fiscalFieldsOf, currentFiscalYear, currentFiscalMonth,
  localISODate, fiscalYearsDown,
} from '../../../utils/fiscal.js'
import { customerOf, groupKey, makeLabeler } from '../../../utils/customer.js'

// ── Fabriques ────────────────────────────────────────────────────────────────
let seq = 0
const tk = (o = {}) => {
  const date = o.date || '2026-01-15'
  const f = fiscalFieldsOf(date)
  return {
    id: o.id || `t${++seq}`, status: 'completed', brand: 'ResHall', project_name: null, ship_to: null,
    department: null, plant: null, categories: null, cost_approx: null,
    issue_reception_date: date, fiscal_year: f.fiscal_year, fiscal_month: f.fiscal_month, ...o,
  }
}
const ln = (occ, o = {}) => ({
  id: o.id || `l${++seq}`, occurrence_id: occ.id, sort_order: 0, quality_issue: 'Pièce abîmée',
  cost_approx: null, department: null, plant: null, categories: null, ...o,
})
const F = (o = {}) => ({ fy: 2026, department: ALL, plant: ALL, brand: ALL, status: ALL, ...o })
const run = (cur, prev, o = {}) => computeDashboard({
  cur, prev, revenueRows: o.revenue === undefined ? [] : o.revenue,
  filters: F(o.filters), today: o.today || '2026-10-26', cmpRange: o.cmpRange,
  labels: { none: '(Non défini)', others: 'Autres' },
})
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

// ── Calendrier fiscal ────────────────────────────────────────────────────────
test('calendrier fiscal : décembre ouvre l\'année suivante', () => {
  assert.equal(getFiscalYear('2025-12'), 2026)
  assert.equal(getFiscalMonth('2025-12'), 1)
  assert.equal(getFiscalYear('2026-11'), 2026)
  assert.equal(getFiscalMonth('2026-11'), 12)
  assert.equal(getFiscalMonth('2026-10'), 11)
  assert.deepEqual(fiscalFieldsOf('2026-12-01'), { date_yyyy_mm: '2026-12', fiscal_year: 2027, fiscal_month: 1 })
  assert.equal(fiscalFieldsOf(''), null)
  assert.equal(fiscalFieldsOf(null), null)
})

test('année fiscale en cours calculée à la date du jour (bascule du 1er décembre)', () => {
  assert.equal(currentFiscalYear(new Date(2026, 10, 30, 23, 59)), 2026)   // 30 nov.
  assert.equal(currentFiscalYear(new Date(2026, 11, 1, 0, 1)), 2027)      // 1er déc.
  assert.equal(currentFiscalMonth(new Date(2026, 11, 1)), 1)
  assert.equal(currentFiscalMonth(new Date(2026, 9, 26)), 11)
  assert.equal(localISODate(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
  assert.deepEqual(fiscalYearsDown(2024, new Date(2026, 11, 2)), [2027, 2026, 2025, 2024])
})

// ── Client ───────────────────────────────────────────────────────────────────
test('client = project_name, repli ship_to ; clé tolérante ; libellé le plus fréquent', () => {
  assert.equal(customerOf({ project_name: '  SBS Phoenix ', ship_to: 'X' }), 'SBS Phoenix')
  assert.equal(customerOf({ project_name: '', ship_to: 'H2S Powell, TN' }), 'H2S Powell, TN')
  assert.equal(customerOf({ project_name: null, ship_to: null }), null)
  assert.equal(groupKey('H2S Henderson , NV'), groupKey('h2s  henderson, NV'))
  const lab = makeLabeler()
  lab.add('k', 'HELP USA, NY'); lab.add('k', 'Help USA, NY'); lab.add('k', 'HELP USA, NY')
  assert.equal(lab.label('k'), 'HELP USA, NY')
})

// ── Unités ───────────────────────────────────────────────────────────────────
test('événements : 1 par ligne titrée, 1 pour une occurrence sans ligne, 0 pour une ligne sans intitulé', () => {
  const a = tk(), b = tk(), c = tk(), out = tk({ status: 'service_desk' })
  const lines = [ln(a), ln(a), ln(a, { quality_issue: '  ' }), ln(c, { quality_issue: null }), ln(out)]
  const { occs, units } = buildUnits([a, b, c, out], lines)
  assert.equal(occs.length, 3, 'hors périmètre exclu')
  const ev = Object.fromEntries(occs.map(o => [o.id, o.events]))
  assert.deepEqual(ev, { [a.id]: 2, [b.id]: 1, [c.id]: 0 })
  assert.equal(units.length, 5)
  assert.equal(isTitled({}), true, 'champ non chargé : compte')
})

test('coût : Σ des lignes dès qu\'une ligne est chiffrée (nul ou négatif inclus), sinon en-tête sur la 1re ligne', () => {
  const a = tk({ cost_approx: 9999 }), b = tk({ cost_approx: 500 }), c = tk({ cost_approx: 300 }), d = tk()
  const lines = [
    ln(a, { cost_approx: 100, sort_order: 0 }), ln(a, { cost_approx: null, sort_order: 1 }), ln(a, { cost_approx: -150, sort_order: 2 }),
    ln(b, { sort_order: 1, department: 'Install' }), ln(b, { sort_order: 0, department: 'Supplier' }),
  ]
  const { occs, units } = buildUnits([a, b, c, d], lines)
  const byId = Object.fromEntries(occs.map(o => [o.id, o]))
  assert.equal(byId[a.id].cost, -50, 'en-tête ignoré dès qu\'une ligne est chiffrée')
  assert.equal(byId[b.id].cost, 500)
  // l'en-tête va sur la ligne de plus petit sort_order (Supplier)
  const bUnits = units.filter(u => u.occ.id === b.id)
  assert.deepEqual(bUnits.map(u => [u.dept, u.cost]), [['Supplier', 500], ['Install', 0]])
  assert.equal(byId[c.id].cost, 300, 'occurrence sans ligne : coût d\'en-tête')
  assert.equal(byId[d.id].costed, false)
  assert.equal(byId[d.id].cost, null)
  assert.equal(units.reduce((s, u) => s + u.cost, 0), -50 + 500 + 300)
})

test('dimensions : ligne, repli en-tête, puis NONE', () => {
  const a = tk({ department: 'Production', plant: 'QS', categories: 'Wood' })
  const b = tk()
  const lines = [ln(a, { department: 'Install' }), ln(a), ln(b, { plant: 'NL' })]
  const { units } = buildUnits([a, b], lines)
  assert.deepEqual(units.map(u => [u.dept, u.plant, u.category]), [
    ['Install', 'QS', 'Wood'], ['Production', 'QS', 'Wood'], [NONE, 'NL', NONE],
  ])
})

test('marque : casse et espaces ignorés, codes hérités conservés', () => {
  assert.equal(brandKey('ResHall'), brandKey('Res Hall'))
  assert.equal(brandKey('reshall '), brandKey('ResHall'))
  assert.notEqual(brandKey('HIEX'), brandKey('Holiday Inn Express'))
  assert.equal(brandKey(''), NONE)
  assert.equal(brandKey(null), NONE)
})

// ── KPI et ventilations ──────────────────────────────────────────────────────
function sample() {
  const a = tk({ date: '2026-01-10', project_name: 'SBS Phoenix', brand: 'HIEX' })
  const b = tk({ date: '2026-02-03', ship_to: 'H2S Powell, TN', cost_approx: 1000, department: 'Ext. Sales', plant: 'QS', brand: 'Tru' })
  const c = tk({ date: '2026-02-20', project_name: 'sbs  phoenix', status: 'quality_meeting', brand: 'Res Hall' })
  const d = tk({ date: '2026-03-02', project_name: 'Notre Dame', status: 'not_started', cost_approx: 50000 })
  const lines = [
    ln(a, { cost_approx: 200, department: 'Install', plant: 'NL', categories: 'Damaged' }),
    ln(a, { cost_approx: 300, department: 'Client', plant: 'NL', categories: 'Hardware' }),
    ln(c, { cost_approx: 50, department: 'Install', plant: 'QS' }),
    ln(c, { cost_approx: null, department: null, plant: null }),
  ]
  return { tickets: [a, b, c, d], lines, ids: { a, b, c, d } }
}

test('KPI : événements, occurrences, coût, SC hors Client, complétion', () => {
  const r = run(sample(), null)
  assert.equal(r.kpi.events, 2 + 1 + 2)
  assert.equal(r.kpi.occurrences, 3)
  assert.equal(r.kpi.open, 1)
  assert.equal(r.kpi.completed, 2)
  near(r.kpi.completionPct, 200 / 3)
  assert.equal(r.kpi.totalCost, 200 + 300 + 1000 + 50)
  assert.equal(r.kpi.scCost, 1550 - 300)
  assert.equal(r.kpi.uncosted, 0)
})

test('ventilations : chaque somme retombe exactement sur le KPI', () => {
  const r = run(sample(), null)
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0)
  assert.equal(sum(r.breakdowns.deptCost, 'cost'), r.kpi.totalCost)
  assert.equal(sum(r.breakdowns.plantCost, 'cost'), r.kpi.totalCost)
  assert.equal(sum(r.breakdowns.categoryEvents, 'count'), r.kpi.events)
  assert.equal(sum(r.months.filter(m => m.inPeriod), 'events'), r.kpi.events)
  assert.equal(sum(r.months.filter(m => m.inPeriod), 'cost'), r.kpi.totalCost)
  assert.equal(sum(r.breakdowns.status, 'value'), r.kpi.occurrences)
  assert.equal(sum(r.breakdowns.brand.rows, 'total'), r.kpi.events)
  // le non-défini est une valeur comme une autre
  assert.ok(r.breakdowns.deptCost.find(x => x.key === NONE) === undefined, 'ligne non chiffrée : pas de coût non défini')
  assert.equal(r.breakdowns.categoryEvents.find(x => x.key === NONE).count, 3)
  assert.equal(r.breakdowns.categoryEvents.find(x => x.key === NONE).name, '(Non défini)')
})

test('clients : project_name et ship_to, variantes regroupées, sans client exclus du top', () => {
  const r = run(sample(), null)
  const ev = r.breakdowns.topCustomersEvents
  assert.deepEqual(ev.map(x => [x.name, x.count]), [['SBS Phoenix', 4], ['H2S Powell, TN', 1]])
  assert.deepEqual(r.breakdowns.topCustomersCost.map(x => [x.name, x.cost]), [['H2S Powell, TN', 1000], ['SBS Phoenix', 550]])
})

test('filtres : département et usine au niveau de la ligne, marque et statut au niveau de l\'occurrence', () => {
  const s = sample()
  const dep = run(s, null, { filters: { department: 'Install' } })
  assert.equal(dep.kpi.events, 2, 'seules les lignes Install')
  assert.equal(dep.kpi.totalCost, 250)
  assert.equal(dep.kpi.occurrences, 2, 'occurrences ayant au moins une ligne Install')
  const none = run(s, null, { filters: { department: NONE } })
  assert.equal(none.kpi.events, 1)
  const plant = run(s, null, { filters: { plant: 'QS' } })
  assert.equal(plant.kpi.events, 2, 'b (en-tête QS) + 1re ligne de c ; la 2e ligne de c est sans usine')
  assert.equal(plant.kpi.totalCost, 1050)
  const brand = run(s, null, { filters: { brand: brandKey('ResHall') } })
  assert.equal(brand.kpi.events, 2, '« Res Hall » saisi = ResHall')
  const st = run(s, null, { filters: { status: 'quality_meeting' } })
  assert.equal(st.kpi.occurrences, 1)
  assert.equal(st.kpi.completionPct, 0)
})

test('occurrences non chiffrées signalées', () => {
  const a = tk(), b = tk({ cost_approx: 0 })
  const r = run({ tickets: [a, b], lines: [ln(a)] }, null)
  assert.equal(r.kpi.uncosted, 1, 'un 0 $ saisi est un coût')
  assert.equal(r.recent.find(x => x.id === a.id).cost, null)
  assert.equal(r.recent.find(x => x.id === b.id).cost, 0)
})

// ── Comparaison N-1 ──────────────────────────────────────────────────────────
function years() {
  const cur = [], prev = []
  // FY2026 : un événement par mois de déc. à oct.
  for (let m = 1; m <= 11; m++) {
    const cal = m === 1 ? '2025-12' : `2026-${String(m - 1).padStart(2, '0')}`
    cur.push(tk({ date: `${cal}-10`, cost_approx: 100 }))
  }
  // FY2025 : deux par mois sur l'année entière, l'un le 10, l'autre le 28.
  for (let m = 1; m <= 12; m++) {
    const cal = m === 1 ? '2024-12' : `2025-${String(m - 1).padStart(2, '0')}`
    prev.push(tk({ date: `${cal}-10`, cost_approx: 100 }), tk({ date: `${cal}-28`, cost_approx: 100 }))
  }
  return { cur: { tickets: cur, lines: [] }, prev: { tickets: prev, lines: [] } }
}

test('année en cours : N-1 arrêtée au même jour de l\'an dernier', () => {
  const { cur, prev } = years()
  const r = run(cur, prev, { today: '2026-10-26' })
  assert.equal(r.isCurrentFY, true)
  assert.equal(r.lastMonth, 11)
  assert.equal(r.comparison.cutoff, '2025-10-26')
  assert.equal(r.comparison.available, true)
  // N-1 jusqu'au 26 oct. 2025 : 10 mois × 2 + le 10 octobre = 21
  assert.equal(r.trends.events.prev, 21)
  near(r.trends.events.pct, (11 - 21) / 21 * 100)
  assert.equal(r.trends.cost.prev, 2100)
  // le graphique mensuel garde les mois complets de N-1
  assert.equal(r.months.find(m => m.fm === 11).prevEvents, 2)
  assert.equal(r.months.find(m => m.fm === 11).partial, true)
  assert.equal(r.months.find(m => m.fm === 12).events, null, 'mois futur : pas de barre')
  assert.equal(r.months.filter(m => m.inPeriod).length, 11)
})

test('année close : années complètes', () => {
  const { cur, prev } = years()
  const r = run({ tickets: prev.tickets, lines: [] }, { tickets: [], lines: [] }, { filters: { fy: 2025 } })
  assert.equal(r.isCurrentFY, false)
  assert.equal(r.lastMonth, 12)
  assert.equal(r.comparison.cutoff, null)
  assert.equal(r.comparison.available, false, 'N-1 vide : aucune tendance')
  assert.equal(r.trends.events, null)
  const r2 = run(cur, prev, { filters: { fy: 2026 }, today: '2027-02-01' })
  assert.equal(r2.isCurrentFY, false)
  assert.equal(r2.trends.events.prev, 24)
})

test('couverture : pas de tendance quand N-1 n\'a pas de données sur toute la période (FY2024 = 3 jours)', () => {
  const stub = [tk({ date: '2024-11-27' }), tk({ date: '2024-11-28' })]
  const fy25 = years().prev.tickets
  const r = run({ tickets: fy25, lines: [] }, { tickets: stub, lines: [] }, { filters: { fy: 2025 } })
  assert.equal(r.comparison.available, false)
  assert.equal(r.comparison.reason, 'coverage')
  assert.equal(r.trends.events, null)
  assert.equal(r.trends.cost, null)
  assert.equal(r.trends.completionPts, null)
})

test('1er décembre : FY2027 comparée au 1er décembre de FY2026', () => {
  const cur = [tk({ date: '2026-12-01' })]
  const prev = [tk({ date: '2025-12-01' }), tk({ date: '2025-12-02' })]
  const r = run({ tickets: cur, lines: [] }, { tickets: prev, lines: [] }, { filters: { fy: 2027 }, today: '2026-12-01' })
  assert.equal(r.isCurrentFY, true)
  assert.equal(r.lastMonth, 1)
  assert.equal(r.comparison.available, true)
  assert.equal(r.trends.events.prev, 1)
})

test('complétion : écart en points, masqué quand N-1 est complétée par construction', () => {
  const { cur, prev } = years()
  cur.tickets[0].status = 'quality_meeting'
  const r = run(cur, prev)
  assert.equal(r.trends.completionPts, null, 'N-1 à 100 %')
  prev.tickets[0].status = 'quality_meeting'
  const r2 = run(cur, prev)
  near(r2.trends.completionPts.pts, 10 / 11 * 100 - 20 / 21 * 100)
})

// ── SC % ─────────────────────────────────────────────────────────────────────
test('SC % cumul : coût et revenu sur les mêmes mois ; Client exclu ; écart signalé', () => {
  const a = tk({ date: '2025-12-05', cost_approx: 300 })
  const b = tk({ date: '2026-01-05', cost_approx: 500 })
  const c = tk({ date: '2026-01-06', cost_approx: 200, department: 'Client' })
  const revenue = [{ fiscal_year: 2026, fiscal_month: 1, plant: 'QS', revenue: 60000 }, { fiscal_year: 2026, fiscal_month: 1, plant: null, revenue: 40000 }]
  const r = run({ tickets: [a, b, c], lines: [] }, null, { revenue })
  assert.equal(r.kpi.scCost, 800)
  near(r.sc.ytdPct, 300 / 100000 * 100)
  assert.equal(r.sc.uncoveredScCost, 500, 'janvier sans revenu : hors calcul, mais signalé')
  assert.deepEqual(r.sc.coveredMonths, [1])
  assert.equal(r.sc.verdict, true)
  assert.equal(r.sc.above, false)
})

test('SC % : filtre usine = revenu de l\'usine ; filtre département = pas de verdict', () => {
  const a = tk({ date: '2025-12-05', cost_approx: 300, plant: 'QS', department: 'Install' })
  const b = tk({ date: '2025-12-06', cost_approx: 700, plant: 'NL', department: 'Install' })
  const revenue = [
    { fiscal_year: 2026, fiscal_month: 1, plant: 'QS', revenue: 10000 },
    { fiscal_year: 2026, fiscal_month: 1, plant: 'NL', revenue: 90000 },
  ]
  const qs = run({ tickets: [a, b], lines: [] }, null, { revenue, filters: { plant: 'QS' } })
  near(qs.sc.ytdPct, 3)
  assert.equal(qs.sc.verdict, true)
  assert.equal(qs.sc.above, true)
  const dep = run({ tickets: [a, b], lines: [] }, null, { revenue, filters: { department: 'Install' } })
  near(dep.sc.ytdPct, 1)
  assert.equal(dep.sc.verdict, false)
  assert.equal(dep.sc.above, false)
})

test('SC % : pas de repli sur le revenu de l\'année affichée pour N-1 ; mois futur exclu ; revenu illisible', () => {
  const a = tk({ date: '2025-12-05', cost_approx: 100 })
  const p = tk({ date: '2024-12-05', cost_approx: 100 })
  const revenue = [
    { fiscal_year: 2026, fiscal_month: 1, plant: null, revenue: 1000 },
    { fiscal_year: 2026, fiscal_month: 12, plant: null, revenue: 1000 },
  ]
  const r = run({ tickets: [a], lines: [] }, { tickets: [p], lines: [] }, { revenue })
  assert.equal(r.sc.months.length, 1, 'novembre (futur) exclu même avec un revenu saisi')
  assert.equal(r.sc.months[0].prevPct, null)
  const un = run({ tickets: [a], lines: [] }, null, { revenue: null })
  assert.equal(un.sc.revenueAvailable, false)
  assert.equal(un.sc.ytdPct, null)
})

// ── Marques ──────────────────────────────────────────────────────────────────
test('marques : 7 séries nommées + « Autres » (avec le non défini), totaux mensuels = événements', () => {
  const tickets = []
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  names.forEach((n, i) => { for (let k = 0; k <= 9 - i; k++) tickets.push(tk({ brand: n })) })
  tickets.push(tk({ brand: '' }))
  const r = run({ tickets, lines: [] }, null)
  const s = r.breakdowns.brand.series
  assert.equal(s.length, BRAND_SERIES + 1)
  assert.deepEqual(s.slice(0, 7).map(x => x.name), ['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  assert.equal(s[7].key, OTHERS)
  assert.equal(s[7].name, 'Autres')
  const row = r.breakdowns.brand.rows[0]
  assert.equal(row.b_others, 3 + 2 + 1, 'H + I + sans marque')
  assert.equal(row.total, r.kpi.events)
})

// ── Comparaison par département ──────────────────────────────────────────────
test('comparaison par département : plage de mois sur les deux années + date égale', () => {
  const { cur, prev } = years()
  cur.tickets.forEach((x, i) => { x.department = i % 2 ? 'Install' : 'Supplier' })
  prev.tickets.forEach(x => { x.department = 'Install' })
  const r = run(cur, prev, { cmpRange: { from: 1, to: 12 } })
  assert.equal(r.deptCompare.totals.cur, 1100)
  assert.equal(r.deptCompare.totals.prev, 2100)
  const inst = r.deptCompare.rows.find(x => x.key === 'Install')
  assert.equal(inst.prev, 2100)
  near(inst.pct, (500 - 2100) / 2100 * 100)
  assert.equal(r.deptCompare.rows.find(x => x.key === 'Supplier').pct, null)
  const q1 = run(cur, prev, { cmpRange: { from: 1, to: 3 } })
  assert.equal(q1.deptCompare.totals.cur, 300)
  assert.equal(q1.deptCompare.totals.prev, 600)
})

// ── Récentes, options, filtres périmés ───────────────────────────────────────
test('récentes : date décroissante, départements dérivés des lignes', () => {
  const s = sample()
  const r = run(s, null)
  assert.deepEqual(r.recent.map(x => x.id), [s.ids.c.id, s.ids.b.id, s.ids.a.id])
  assert.deepEqual(r.recent[0].depts, ['Install', '(Non défini)'])
  assert.equal(r.recent[0].customer, 'SBS Phoenix')
})

test('options : non défini en tête ; filtres absents de l\'année remis à « tous »', () => {
  const r = run(sample(), null)
  assert.equal(r.options.departments[0].value, NONE)
  assert.ok(r.options.brands.some(o => o.label === 'Res Hall'))
  const f = sanitizeFilters(F({ department: 'Vietnam', plant: 'QS', brand: 'zzz', status: 'cancelled' }), r.options)
  assert.deepEqual([f.department, f.plant, f.brand, f.status], [ALL, 'QS', ALL, ALL])
})

// ── Cas limites relevés par la revue adverse (mutations non détectées) ──────
test('couverture de l\'année en cours : un mois manquant en N-1 coupe la tendance, sauf le mois en cours', () => {
  const { cur, prev } = years()
  const sansMai = { tickets: prev.tickets.filter(x => x.fiscal_month !== 5), lines: [] }
  const r = run(cur, sansMai)
  assert.equal(r.comparison.available, false)
  assert.equal(r.comparison.reason, 'coverage')
  assert.equal(r.trends.events, null)
  assert.equal(r.deptCompare.available, false, 'la table par département suit la même règle')
  // octobre (mois en cours) absent de N-1 : la comparaison reste possible
  const sansOct = { tickets: prev.tickets.filter(x => x.fiscal_month !== 11), lines: [] }
  assert.equal(run(cur, sansOct).comparison.available, true)
})

test('couverture : la complétion dépend bien de la disponibilité de la comparaison', () => {
  const stub = [tk({ date: '2024-11-27', status: 'quality_meeting' }), tk({ date: '2024-11-28' })]
  const fy25 = years().prev.tickets
  fy25[0].status = 'quality_meeting'
  const r = run({ tickets: fy25, lines: [] }, { tickets: stub, lines: [] }, { filters: { fy: 2025 } })
  assert.equal(r.comparison.available, false)
  assert.equal(r.trends.completionPts, null)
})

test('N-1 : une occurrence sans date sort de la fenêtre à date mais reste dans les barres mensuelles', () => {
  const { cur, prev } = years()
  const sansDate = tk({ date: '2025-01-15' })
  sansDate.issue_reception_date = null
  prev.tickets.push(sansDate)
  const r = run(cur, prev)
  assert.equal(r.trends.events.prev, 21)
  assert.equal(r.months.find(m => m.fm === sansDate.fiscal_month).prevEvents, 3)
})

test('filtres appliqués aussi à N-1 : tendances, barres, SC % N-1 (Client exclu), table par département', () => {
  const cur = [tk({ date: '2025-12-05', department: 'Install', cost_approx: 100 }), tk({ date: '2025-12-06', department: 'Supplier', cost_approx: 900 })]
  const prev = [
    tk({ date: '2024-12-05', department: 'Install', cost_approx: 50 }),
    tk({ date: '2024-12-06', department: 'Supplier', cost_approx: 400 }),
    tk({ date: '2024-12-07', department: 'Client', cost_approx: 7000 }),
  ]
  const revenue = [{ fiscal_year: 2026, fiscal_month: 1, plant: null, revenue: 10000 }, { fiscal_year: 2025, fiscal_month: 1, plant: null, revenue: 10000 }]
  const all = run({ tickets: cur, lines: [] }, { tickets: prev, lines: [] }, { revenue, today: '2025-12-20', filters: { fy: 2026 } })
  near(all.sc.months[0].prevPct, 450 / 10000 * 100)   // Client exclu du numérateur N-1
  const r = run({ tickets: cur, lines: [] }, { tickets: prev, lines: [] }, { revenue, today: '2025-12-20', filters: { fy: 2026, department: 'Install' } })
  assert.equal(r.trends.events.prev, 1)
  assert.equal(r.trends.cost.prev, 50)
  near(r.trends.cost.pct, 100)
  assert.equal(r.months[0].prevEvents, 1)
  near(r.sc.months[0].prevPct, 0.5)
  assert.deepEqual(r.deptCompare.rows.map(x => [x.key, x.cur, x.prev]), [['Install', 100, 50]])
})

test('verdict SC % : retiré sous un filtre marque ou statut ; usine « non définie » = revenu non ventilé', () => {
  const a = tk({ date: '2025-12-05', cost_approx: 100, brand: 'Tru', plant: null })
  const revenue = [{ fiscal_year: 2026, fiscal_month: 1, plant: null, revenue: 1000 }, { fiscal_year: 2026, fiscal_month: 1, plant: 'QS', revenue: 9000 }]
  assert.equal(run({ tickets: [a], lines: [] }, null, { revenue, filters: { brand: brandKey('Tru') } }).sc.verdict, false)
  assert.equal(run({ tickets: [a], lines: [] }, null, { revenue, filters: { status: 'completed' } }).sc.verdict, false)
  const none = run({ tickets: [a], lines: [] }, null, { revenue, filters: { plant: NONE } })
  assert.equal(none.sc.ytdRevenue, 1000)
  near(none.sc.ytdPct, 10)
  assert.equal(none.sc.verdict, true)
})

test('tendances : N-1 nul → pas de pourcentage ; N-1 négatif → écart rapporté à |N-1|', () => {
  const cur = [tk({ date: '2025-12-05', cost_approx: 100 })]
  const prevZero = [tk({ date: '2024-12-05', cost_approx: 0 })]
  const r0 = run({ tickets: cur, lines: [] }, { tickets: prevZero, lines: [] }, { today: '2025-12-20', filters: { fy: 2026 } })
  assert.equal(r0.trends.cost, null)
  const p = tk({ date: '2024-12-05' })
  const r1 = run({ tickets: cur, lines: [] }, { tickets: [p], lines: [ln(p, { cost_approx: -200 })] }, { today: '2025-12-20', filters: { fy: 2026 } })
  near(r1.trends.cost.pct, (100 - -200) / 200 * 100)
  near(r1.deptCompare.totals.pct, 150)
})

test('cents : un N-1 qui s\'annule en flottant (10.10 + 20.20 − 30.30) ne donne ni tendance ni part fantôme', () => {
  const cur = [tk({ date: '2025-12-05', cost_approx: 100 })]
  const p = tk({ date: '2024-12-05', department: 'Install' })
  const lines = [ln(p, { cost_approx: 10.10 }), ln(p, { cost_approx: 20.20 }), ln(p, { cost_approx: -30.30 })]
  const r = run({ tickets: cur, lines: [] }, { tickets: [p], lines }, { today: '2025-12-20', filters: { fy: 2026 } })
  assert.equal(r.trends.cost, null)
  assert.equal(r.deptCompare.rows.find(x => x.key === 'Install'), undefined)
  const own = run({ tickets: [p], lines }, null, { filters: { fy: 2025 }, today: '2025-12-20' })
  assert.equal(own.kpi.totalCost, 0)
  assert.equal(own.breakdowns.deptCost.length, 0)
})

test('ligne chiffrée à 0 $ : prime sur l\'en-tête ; valeur de ligne faite d\'espaces → repli sur l\'en-tête', () => {
  const a = tk({ cost_approx: 800, department: 'Production', plant: 'QS', categories: 'Wood' })
  const r = run({ tickets: [a], lines: [ln(a, { cost_approx: 0, department: '  ', plant: ' ', categories: '\t' })] }, null)
  assert.equal(r.kpi.totalCost, 0)
  assert.equal(r.kpi.uncosted, 0)
  const { units } = buildUnits([a], [ln(a, { department: '  ', plant: ' ', categories: '\t' })])
  assert.deepEqual([units[0].dept, units[0].plant, units[0].category], ['Production', 'QS', 'Wood'])
})

test('clients : une occurrence sans client n\'entre dans aucun top', () => {
  const a = tk({ project_name: '  ', ship_to: null, cost_approx: 99999 }), b = tk({ project_name: 'SBS Phoenix', cost_approx: 1 })
  const r = run({ tickets: [a, b], lines: [] }, null)
  assert.deepEqual(r.breakdowns.topCustomersCost.map(x => x.name), ['SBS Phoenix'])
  assert.deepEqual(r.breakdowns.topCustomersEvents.map(x => x.name), ['SBS Phoenix'])
  assert.ok(!r.breakdowns.topCustomersCost.some(x => x.key === NONE))
})

test('libellés : appris sur l\'année affichée, N-1 seulement en repli', () => {
  const cur = [tk({ date: '2025-12-05', brand: 'Avid', project_name: 'Acme Corp' })]
  const prev = [tk({ date: '2024-12-05', brand: 'AVID', project_name: 'ACME CORP' }), tk({ date: '2024-12-06', brand: 'AVID', project_name: 'ACME CORP' })]
  const r = run({ tickets: cur, lines: [] }, { tickets: prev, lines: [] }, { today: '2025-12-20', filters: { fy: 2026 } })
  assert.equal(r.options.brands.find(o => o.value === brandKey('Avid')).label, 'Avid')
  assert.equal(r.breakdowns.topCustomersEvents[0].name, 'Acme Corp')
})

test('date future saisie par erreur : la période s\'étend, chaque unité comptée apparaît dans un mois', () => {
  const a = tk({ date: '2026-01-10', cost_approx: 100 }), b = tk({ date: '2026-11-03', cost_approx: 500, brand: 'Zeta' })
  const r = run({ tickets: [a, b], lines: [] }, null, { today: '2026-10-26' })
  assert.equal(r.lastMonth, 12)
  assert.equal(r.months.find(m => m.fm === 11).partial, true, 'le mois en cours reste octobre')
  const inP = r.months.filter(m => m.inPeriod)
  assert.equal(inP.reduce((s, m) => s + m.events, 0), r.kpi.events)
  assert.equal(inP.reduce((s, m) => s + m.cost, 0), r.kpi.totalCost)
  assert.equal(r.breakdowns.brand.rows.reduce((s, x) => s + x.total, 0), r.kpi.events)
})

test('récentes : à date égale, ordre des id ; non chiffrées comptées sur les seules occurrences filtrées', () => {
  const a = tk({ id: 'b-2', date: '2026-03-01', department: 'Install' }), b = tk({ id: 'a-1', date: '2026-03-01', department: 'Supplier', cost_approx: 5 })
  const r = run({ tickets: [a, b], lines: [] }, null)
  assert.deepEqual(r.recent.map(x => x.id), ['a-1', 'b-2'])
  assert.equal(r.kpi.uncosted, 1)
  assert.equal(run({ tickets: [a, b], lines: [] }, null, { filters: { department: 'Supplier' } }).kpi.uncosted, 0)
})
