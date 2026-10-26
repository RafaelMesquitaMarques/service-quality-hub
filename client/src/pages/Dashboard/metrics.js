// Calculs du tableau de bord — module PUR (aucun import React / Supabase), testé
// sous Node par `npm run test:dashboard` et rejoué sur les données réelles.
// Le composant (index.jsx) ne fait plus que charger les données et afficher.
//
// Règles (audit du 2026-10-26) :
// • Périmètre : occurrences en Réunion qualité ou Complétées (décision 2026-08-31).
// • Unité d'ÉVÉNEMENT = la LIGNE d'occurrence. L'historique importé (FY2025, et
//   FY2026 jusqu'en juin) compte une ligne Excel par événement ; une occurrence
//   saisie dans l'app regroupe plusieurs lignes. Compter les occurrences faisait
//   croire à une baisse de 29 % alors que le volume était stable. Une occurrence
//   sans ligne (import) compte 1 ; une ligne sans intitulé (réclamation annulée)
//   compte 0.
// • Coût d'une occurrence = Σ cost_approx de ses lignes dès qu'une ligne est
//   chiffrée (net du crédit fournisseur, nul ou négatif possible), sinon le coût
//   d'en-tête — porté par sa 1re ligne, comme le module Rapports.
// • Département / usine / catégorie vivent sur la ligne (repli sur l'en-tête) ;
//   marque, statut, client et mois fiscal sur l'occurrence. « Non défini » est
//   une valeur comme une autre (NONE) : chaque ventilation totalise exactement.
// • Client = project_name, repli ship_to (ship_to n'est plus saisi depuis juin).
// • Comparaison N-1 à date égale pour l'année en cours ; aucune tendance quand
//   l'année précédente n'a pas de données sur toute la période comparée.
// • Montants jamais arrondis ici : l'arrondi se fait à l'affichage seulement.

import { currentFiscalYear, currentFiscalMonth, FISCAL_MONTH_ORDER } from '../../utils/fiscal.js'
import { customerOf, groupKey, makeLabeler } from '../../utils/customer.js'

export const DASHBOARD_STATUSES = ['quality_meeting', 'completed']
export const inDashboardScope = tk => DASHBOARD_STATUSES.includes(tk.status)
export const STATUS_ORDER = ['not_started', 'service_desk', 'sd_waiting_info', 'quality_meeting', 'wip', 'completed', 'cancelled']

// Valeurs techniques, indépendantes de la langue (traduites à l'affichage).
export const NONE = '__none__'
export const OTHERS = '__others__'
export const ALL = 'all'

export const SC_EXCLUDED_DEPT = 'Client'   // le coût « SC » exclut ce département
export const TOLERANCE_PCT = 0.3           // tolérance SC % du revenu
export const BRAND_SERIES = 7              // marques nommées dans le graphique empilé (+ « Autres »)
export const TOP_N = 10

const clean = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
const orNone = v => clean(v) || NONE
const num = v => Number(v || 0)

// Marque : casse et espaces ignorés (« ResHall » / « Reshall » / « Res Hall »).
// Les codes hérités (HIEX, HOME 2…) ne sont PAS renommés ici : c'est une
// correction de données, pas d'affichage.
export const brandKey = v => clean(v).toLowerCase().replace(/\s+/g, '') || NONE

// Une ligne compte comme événement si elle porte un intitulé. Champ non chargé
// (undefined) : compte, pour ne jamais perdre d'événement par omission.
export const isTitled = l => l.quality_issue === undefined || clean(l.quality_issue) !== ''

// ── Unités ────────────────────────────────────────────────────────────────────
// Une unité par ligne (une seule pour une occurrence sans ligne). Chaque unité
// porte ses événements (0/1), son coût, ses dimensions de ligne et les attributs
// de l'occurrence parente.
export function buildUnits(tickets, lines, { brandLabels, customerLabels } = {}) {
  const byOcc = new Map()
  for (const l of lines || []) {
    const arr = byOcc.get(l.occurrence_id)
    if (arr) arr.push(l)
    else byOcc.set(l.occurrence_id, [l])
  }
  const occs = [], units = []
  for (const tk of tickets || []) {
    if (!inDashboardScope(tk)) continue
    const ls = (byOcc.get(tk.id) || []).slice()
      .sort((a, b) => num(a.sort_order) - num(b.sort_order) || String(a.id).localeCompare(String(b.id)))
    const costedByLines = ls.some(l => l.cost_approx != null)
    const headerCost = tk.cost_approx == null ? null : Number(tk.cost_approx)

    const brand = brandKey(tk.brand)
    if (brandLabels && brand !== NONE) brandLabels.add(brand, clean(tk.brand))
    const customerName = customerOf(tk)
    const customer = customerName ? groupKey(customerName) : NONE
    if (customerLabels && customer !== NONE) customerLabels.add(customer, customerName)

    const occ = {
      id: tk.id, ticket: tk, fm: tk.fiscal_month, date: clean(tk.issue_reception_date).slice(0, 10),
      status: tk.status, brand, customer,
      lineCount: ls.length,
      costed: costedByLines || headerCost != null,
      cost: costedByLines ? ls.reduce((s, l) => s + num(l.cost_approx), 0) : headerCost,
      events: 0, units: [],
    }
    const parent = { occ, fm: occ.fm, date: occ.date, status: occ.status, brand, customer }
    if (ls.length === 0) {
      occ.units.push({ ...parent, events: 1, cost: num(headerCost),
        dept: orNone(tk.department), plant: orNone(tk.plant), category: orNone(tk.categories) })
    } else {
      ls.forEach((l, i) => occ.units.push({ ...parent,
        events: isTitled(l) ? 1 : 0,
        cost: costedByLines ? num(l.cost_approx) : (i === 0 ? num(headerCost) : 0),
        // clean() avant le repli : une valeur de ligne faite d'espaces retombe
        // sur l'en-tête comme une valeur vide.
        dept: orNone(clean(l.department) || tk.department),
        plant: orNone(clean(l.plant) || tk.plant),
        category: orNone(clean(l.categories) || tk.categories),
      }))
    }
    occ.events = occ.units.reduce((s, u) => s + u.events, 0)
    occs.push(occ)
    units.push(...occ.units)
  }
  return { occs, units }
}

// ── Filtres ───────────────────────────────────────────────────────────────────
// Département / usine : au niveau de l'unité (ligne). Marque / statut : portés par
// l'occurrence, recopiés sur chaque unité. Une occurrence est retenue dès qu'une
// de ses unités l'est (compteurs par occurrence : statut, complétion, récentes).
export const unitMatcher = (f) => (u) =>
  (f.department === ALL || u.dept === f.department) &&
  (f.plant === ALL || u.plant === f.plant) &&
  (f.brand === ALL || u.brand === f.brand) &&
  (f.status === ALL || u.status === f.status)

// ── Revenus ───────────────────────────────────────────────────────────────────
// Somme par (année, mois) ; avec un filtre usine, seul le revenu de cette usine
// (NONE = lignes « non ventilées », plant NULL).
export function revenueByFiscal(revenueRows, plantFilter) {
  const out = {}
  for (const r of revenueRows || []) {
    if (plantFilter !== ALL && (plantFilter === NONE ? r.plant != null : r.plant !== plantFilter)) continue
    const m = (out[r.fiscal_year] = out[r.fiscal_year] || {})
    m[r.fiscal_month] = (m[r.fiscal_month] || 0) + num(r.revenue)
  }
  return out
}

const cents = x => Math.round(x * 100) / 100 || 0   // || 0 : jamais −0
// Somme par clé ; une clé dont le total s'annule (au cent près) disparaît.
const sumBy = (units, valueOf, keyOf) => {
  const m = new Map()
  for (const u of units) {
    const v = valueOf(u)
    if (!v) continue
    const k = keyOf(u)
    m.set(k, (m.get(k) || 0) + v)
  }
  for (const [k, v] of m) {
    const r = cents(v)
    if (r === 0) m.delete(k)
    else m.set(k, r)
  }
  return m
}
const sortedEntries = m => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
const pctChange = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) * 100 : null)

// Options d'un filtre : NONE d'abord, puis ordre alphabétique des libellés.
function optionList(values, labelOf) {
  const set = new Set(values)
  const hasNone = set.delete(NONE)
  const opts = [...set].map(v => ({ value: v, label: labelOf(v) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return hasNone ? [{ value: NONE, label: labelOf(NONE) }, ...opts] : opts
}

// ── Calcul complet ────────────────────────────────────────────────────────────
// cur / prev : { tickets, lines } de l'année affichée et de la précédente
//   (prev = null si indisponible → aucune comparaison).
// revenueRows : lignes monthly_revenue, ou null si le revenu n'a pas pu être lu.
// filters : { fy, department, plant, brand, status } — ALL ou une valeur.
// today : « YYYY-MM-DD » (date locale) ; cmpRange : { from, to } mois fiscaux
//   du tableau de comparaison par département ; labels : { none, others }.
export function computeDashboard({ cur, prev, revenueRows, filters, today, cmpRange = { from: 1, to: 12 }, labels = {} }) {
  const noneLabel = labels.none || '(Non défini)'
  const othersLabel = labels.others || 'Others'
  // Libellés appris sur l'année affichée ; N-1 ne sert qu'aux clés absentes de
  // l'année affichée (sinon FY2026 « Avid » s'affichait « AVID », l'orthographe
  // de FY2025).
  const L = { brand: makeLabeler(), customer: makeLabeler() }
  const Lp = { brand: makeLabeler(), customer: makeLabeler() }
  const C = buildUnits(cur?.tickets, cur?.lines, { brandLabels: L.brand, customerLabels: L.customer })
  const P = prev ? buildUnits(prev.tickets, prev.lines, { brandLabels: Lp.brand, customerLabels: Lp.customer }) : null
  const labelOf = (kind, k) => (L[kind].has(k) ? L[kind].label(k) : Lp[kind].label(k))

  const valueLabel = v => (v === NONE ? noneLabel : v)
  const brandName = k => (k === NONE ? noneLabel : k === OTHERS ? othersLabel : labelOf('brand', k))
  const customerName = k => (k === NONE ? noneLabel : labelOf('customer', k))

  // Période : l'année en cours s'arrête au mois du jour — ou au dernier mois qui
  // a des données (date de réception future saisie par erreur) : chaque unité
  // comptée dans un KPI apparaît aussi dans les séries mensuelles.
  const todayDate = parseISODate(today)
  const isCurrentFY = filters.fy === currentFiscalYear(todayDate)
  const todayMonth = isCurrentFY ? currentFiscalMonth(todayDate) : 12
  const lastMonth = isCurrentFY ? Math.max(todayMonth, ...C.occs.map(o => Number(o.fm) || 0)) : 12

  // Options des filtres : année affichée, sans filtre.
  const options = {
    departments: optionList(C.units.map(u => u.dept), valueLabel),
    plants:      optionList(C.units.map(u => u.plant), valueLabel),
    brands:      optionList(C.units.map(u => u.brand), brandName),
    statuses:    STATUS_ORDER.filter(s => C.occs.some(o => o.status === s)),
  }

  const match = unitMatcher(filters)
  const units = C.units.filter(match)
  const occs = C.occs.filter(o => o.units.some(match))

  // ── Fenêtre de comparaison N-1 ──
  // Année en cours : N-1 arrêtée au même jour de l'an dernier (le mois en cours
  // n'est pas comparé à un mois complet). Année close : années complètes.
  const cutoff = isCurrentFY && today ? `${Number(today.slice(0, 4)) - 1}${today.slice(4, 10)}` : null
  const inPrevWindow = u => !cutoff || (u.date && u.date <= cutoff)
  let comparison = { available: false, reason: prev ? 'coverage' : 'unavailable', cutoff }
  let prevUnits = [], prevOccs = []
  if (P) {
    // Couverture : N-1 doit avoir des données sur chaque mois comparé (le mois
    // en cours, partiel, excepté). Sinon (ex. FY2024 = 3 jours de novembre) on
    // n'affiche aucune tendance plutôt qu'un « +11 750 % ».
    const required = isCurrentFY ? todayMonth - 1 : 12
    const present = new Set(P.occs.filter(o => !cutoff || (o.date && o.date <= cutoff)).map(o => o.fm))
    let covered = P.occs.length > 0
    for (let m = 1; m <= required; m++) if (!present.has(m)) covered = false
    if (covered) comparison = { available: true, reason: null, cutoff }
    prevUnits = P.units.filter(u => match(u) && inPrevWindow(u))
    prevOccs = P.occs.filter(o => (!cutoff || (o.date && o.date <= cutoff)) && o.units.some(match))
  }

  // ── KPI ──
  const sumEvents = arr => arr.reduce((s, u) => s + u.events, 0)
  // Sommes d'argent arrondies au cent : 10.10 + 20.20 − 30.30 vaut −3.6e-15 en
  // flottant, qu'un test « ≠ 0 » prendrait pour un montant (tendance de +3e19 %).
  const sumCost = arr => cents(arr.reduce((s, u) => s + u.cost, 0))
  const isSc = u => u.dept !== SC_EXCLUDED_DEPT
  const events = sumEvents(units)
  const totalCost = sumCost(units)
  const scCost = sumCost(units.filter(isSc))
  const completed = occs.filter(o => o.status === 'completed').length
  const kpi = {
    events,
    occurrences: occs.length,
    inScopeOccurrences: C.occs.length,
    open: occs.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length,
    completed,
    completionPct: occs.length ? completed / occs.length * 100 : null,
    uncosted: occs.filter(o => !o.costed).length,
    totalCost, scCost,
  }

  const prevEvents = sumEvents(prevUnits)
  const prevCost = sumCost(prevUnits)
  const prevCompleted = prevOccs.filter(o => o.status === 'completed').length
  const prevCompletionPct = prevOccs.length ? prevCompleted / prevOccs.length * 100 : null
  const trends = { events: null, cost: null, completionPts: null }
  if (comparison.available) {
    trends.events = prevEvents ? { pct: pctChange(events, prevEvents), prev: prevEvents } : null
    trends.cost = prevCost ? { pct: pctChange(totalCost, prevCost), prev: prevCost } : null
    // FY2025 est complétée à 100 % par construction (bascule en masse des
    // importées) : un écart de complétion n'aurait aucun sens.
    if (kpi.completionPct != null && prevCompletionPct != null && prevCompleted < prevOccs.length) {
      trends.completionPts = { pts: kpi.completionPct - prevCompletionPct, prev: prevCompletionPct }
    }
  }

  // ── Séries mensuelles ──
  const byMonth = (arr, valueOf) => {
    const m = {}
    for (const u of arr) m[u.fm] = (m[u.fm] || 0) + valueOf(u)
    return m
  }
  const evCur = byMonth(units, u => u.events)
  const evPrevFull = P ? byMonth(P.units.filter(match), u => u.events) : {}
  const costCur = byMonth(units, u => u.cost)
  const doneCur = {}
  for (const o of occs) if (o.status === 'completed') doneCur[o.fm] = (doneCur[o.fm] || 0) + 1
  const occCur = {}
  for (const o of occs) occCur[o.fm] = (occCur[o.fm] || 0) + 1

  const months = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => ({
    fm: fiscal, name: nameShort,
    inPeriod: fiscal <= lastMonth,
    partial: isCurrentFY && fiscal === todayMonth,
    events: fiscal <= lastMonth ? (evCur[fiscal] || 0) : null,
    occurrences: fiscal <= lastMonth ? (occCur[fiscal] || 0) : null,
    prevEvents: P ? (evPrevFull[fiscal] || 0) : null,
    cost: fiscal <= lastMonth ? (costCur[fiscal] || 0) : null,
    done: fiscal <= lastMonth ? (doneCur[fiscal] || 0) : null,
  }))
  const inPeriod = months.filter(m => m.inPeriod)

  // ── SC % du revenu ──
  const revAvailable = Array.isArray(revenueRows)
  const rev = revenueByFiscal(revenueRows, filters.plant)
  const revCur = rev[filters.fy] || {}, revPrev = rev[filters.fy - 1] || {}
  const scByMonthCur = byMonth(units.filter(isSc), u => u.cost)
  const scByMonthPrev = P ? byMonth(P.units.filter(u => match(u) && isSc(u)), u => u.cost) : {}
  const scMonths = inPeriod
    .map(m => {
      const revenue = revCur[m.fm] || 0
      const prevRevenue = revPrev[m.fm] || 0
      return {
        fm: m.fm, name: m.name, partial: m.partial, revenue, prevRevenue,
        scCost: scByMonthCur[m.fm] || 0, prevScCost: scByMonthPrev[m.fm] || 0,
        pct: revenue > 0 ? (scByMonthCur[m.fm] || 0) / revenue * 100 : null,
        // Pas de repli sur le revenu de l'année affichée : sans revenu N-1, pas de barre N-1.
        prevPct: P && prevRevenue > 0 ? (scByMonthPrev[m.fm] || 0) / prevRevenue * 100 : null,
      }
    })
    .filter(m => m.pct !== null)
  // Cumul : numérateur et dénominateur sur les MÊMES mois (ceux qui ont un revenu).
  const ytdRevenue = scMonths.reduce((s, m) => s + m.revenue, 0)
  const scCovered = scMonths.reduce((s, m) => s + m.scCost, 0)
  // Le verdict de tolérance n'a de sens que pour l'ensemble de l'activité, ou une
  // usine (qui a son revenu propre). Sous un filtre département / marque / statut,
  // le numérateur est une PART du coût, rapportée au revenu total : la valeur reste
  // affichée, mais sans feu vert / rouge.
  const verdict = filters.department === ALL && filters.brand === ALL && filters.status === ALL
  const ytdPct = ytdRevenue > 0 ? scCovered / ytdRevenue * 100 : null
  const sc = {
    revenueAvailable: revAvailable,
    ytdPct, ytdRevenue, scCovered,
    uncoveredScCost: scCost - scCovered,   // coût SC des mois sans revenu saisi
    coveredMonths: scMonths.map(m => m.fm),
    months: scMonths,
    verdict,
    above: verdict && ytdPct != null && ytdPct > TOLERANCE_PCT,
  }

  // ── Ventilations ──
  const deptCost = sortedEntries(sumBy(units, u => u.cost, u => u.dept)).map(([key, cost]) => ({ key, name: valueLabel(key), cost }))
  const plantCost = sortedEntries(sumBy(units, u => u.cost, u => u.plant)).map(([key, cost]) => ({ key, name: valueLabel(key), cost }))
  const categoryEvents = sortedEntries(sumBy(units, u => u.events, u => u.category)).map(([key, count]) => ({ key, name: valueLabel(key), count }))
  const withCustomer = units.filter(u => u.customer !== NONE)
  const topCustomersEvents = sortedEntries(sumBy(withCustomer, u => u.events, u => u.customer)).slice(0, TOP_N)
    .map(([key, count]) => ({ key, name: customerName(key), count }))
  const topCustomersCost = sortedEntries(sumBy(withCustomer, u => u.cost, u => u.customer)).slice(0, TOP_N)
    .map(([key, cost]) => ({ key, name: customerName(key), cost }))
  const status = STATUS_ORDER.map(key => ({ key, value: occs.filter(o => o.status === key).length })).filter(d => d.value > 0)

  // Marques par mois (événements) : les BRAND_SERIES marques les plus fréquentes
  // de l'année, le reste (et « non défini ») regroupé dans « Autres » — 8 couleurs
  // pour 30 séries rendaient le graphique illisible. Clés de série neutres (b0…)
  // car recharts lit un « . » dans dataKey comme un chemin.
  const brandTotals = sortedEntries(sumBy(units.filter(u => u.brand !== NONE), u => u.events, u => u.brand))
  const named = brandTotals.slice(0, BRAND_SERIES).map(([k]) => k)
  const hasOthers = units.some(u => u.events && !named.includes(u.brand))
  const brandSeries = [...named.map((key, i) => ({ dataKey: `b${i}`, key, name: brandName(key) })),
    ...(hasOthers ? [{ dataKey: 'b_others', key: OTHERS, name: othersLabel }] : [])]
  const seriesOf = new Map(brandSeries.map(s => [s.key, s.dataKey]))
  const brandRows = inPeriod.map(m => {
    const row = { name: m.name, total: 0 }
    brandSeries.forEach(s => { row[s.dataKey] = 0 })
    for (const u of units) {
      if (u.fm !== m.fm || !u.events) continue
      const dk = seriesOf.get(u.brand) || 'b_others'
      row[dk] += u.events
      row.total += u.events
    }
    brandSeries.forEach(s => { if (!row[s.dataKey]) row[s.dataKey] = null })
    return row
  }).filter(r => r.total > 0)

  // ── Comparaison par département ──
  const inRange = u => u.fm >= cmpRange.from && u.fm <= cmpRange.to
  const cmpCur = sumBy(units.filter(inRange), u => u.cost, u => u.dept)
  const cmpPrev = sumBy(prevUnits.filter(inRange), u => u.cost, u => u.dept)
  const deptRows = [...new Set([...cmpCur.keys(), ...cmpPrev.keys()])]
    .map(key => {
      const c = cmpCur.get(key) || 0, p = cmpPrev.get(key) || 0
      // Même formule que les tendances KPI (|N-1| au dénominateur : un N-1 net
      // négatif — crédit fournisseur — a lui aussi un écart en %).
      return { key, name: valueLabel(key), cur: c, prev: p, gap: cents(c - p), pct: pctChange(c, p) }
    })
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev || a.name.localeCompare(b.name))
  const tCur = cents(deptRows.reduce((s, r) => s + r.cur, 0)), tPrev = cents(deptRows.reduce((s, r) => s + r.prev, 0))
  const deptCompare = {
    // Même règle de couverture que les KPI : pas de « +20 700 % » face à FY2024.
    available: comparison.available, cutoff,
    rows: deptRows,
    totals: { cur: tCur, prev: tPrev, gap: cents(tCur - tPrev), pct: pctChange(tCur, tPrev) },
  }

  // ── Occurrences récentes ──
  const recent = occs.slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.id).localeCompare(String(b.id))))
    .slice(0, 8)
    .map(o => ({
      id: o.id, ticket: o.ticket, status: o.status, events: o.events,
      customer: o.customer === NONE ? null : customerName(o.customer),
      depts: [...new Set(o.units.map(u => u.dept))].map(valueLabel),
      cost: o.costed ? o.cost : null,
    }))

  return {
    isCurrentFY, lastMonth, comparison, options,
    kpi, trends, months, sc,
    breakdowns: { deptCost, plantCost, categoryEvents, topCustomersEvents, topCustomersCost, status, brand: { series: brandSeries, rows: brandRows } },
    deptCompare, recent,
  }
}

// « YYYY-MM-DD » → Date locale à midi (évite tout décalage de fuseau).
function parseISODate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}

// Filtres dont la valeur n'existe plus dans les options (changement d'année) :
// remis à ALL, sinon le sélecteur affichait « tous » pendant qu'un filtre périmé
// vidait tous les graphiques.
export function sanitizeFilters(filters, options) {
  const ok = (v, list) => v === ALL || list.includes(v)
  const next = { ...filters }
  if (!ok(filters.department, options.departments.map(o => o.value))) next.department = ALL
  if (!ok(filters.plant, options.plants.map(o => o.value))) next.plant = ALL
  if (!ok(filters.brand, options.brands.map(o => o.value))) next.brand = ALL
  if (!ok(filters.status, options.statuses)) next.status = ALL
  return next
}
