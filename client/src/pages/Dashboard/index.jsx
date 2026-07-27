import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { ticketApi, fetchOccurrenceLines, revenueApi, FISCAL_MONTH_ORDER, CURRENT_FISCAL_YEAR, getFiscalMonth } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'
import { useThemeStore } from '../../store/themeStore'
import { buildXlsxWithImage } from '../../utils/xlsxImage'
import toast from 'react-hot-toast'

// Les revenus mensuels sont désormais éditables (table monthly_revenue), via
// Référentiels › Revenus. Voir revenueApi + la requête ['monthly-revenue'].

const TOLERANCE_PCT = 0.003
const BRAND_COLORS  = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA']
const DEPT_COLORS   = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA',
  '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#EC4899', '#22C55E', '#A855F7']
const STATUS_ORDER  = ['not_started', 'service_desk', 'quality_meeting', 'wip', 'completed', 'cancelled']
const STATUS_COLORS = {
  not_started:     '#94A3B8',
  service_desk:    '#3B82F6',
  quality_meeting: '#8B5CF6',
  wip:             '#F59E0B',
  completed:       '#10B981',
  cancelled:       '#EF4444',
}

const money  = v => `$${Math.round(Number(v) || 0).toLocaleString()}`
const moneyK = v => `$${Math.round((Number(v) || 0) / 1000)}k`
const signedMoney = v => {
  const n = Math.round(Number(v) || 0)
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString()}`
}

// ── Custom tooltip (theme-aware) ───────────────────────────────
function ChartTooltip({ active, payload, label, dark, fmt }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: dark ? '#0D1117' : '#ffffff',
      border: `1px solid ${dark ? '#30363d' : '#e5e7eb'}`,
      borderRadius: 10, padding: '8px 12px', fontSize: 12,
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
    }}>
      {label != null && label !== '' && (
        <div style={{ fontWeight: 700, marginBottom: 5, color: dark ? '#e6edf3' : '#111827' }}>{label}</div>
      )}
      {payload.filter(p => p.value != null).map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.7 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color || p.payload?.fill, flexShrink: 0 }} />
          <span style={{ color: dark ? '#9ca3af' : '#6b7280' }}>{p.name}</span>
          <span style={{ fontWeight: 700, marginLeft: 'auto', paddingLeft: 12, color: dark ? '#e6edf3' : '#111827' }}>
            {fmt ? fmt(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── KPI card with sparkline ────────────────────────────────────
function StatCard({ icon, iconBg, iconColor, label, value, sub, subColor, trend, spark, sparkColor }) {
  const gid = `spark-${(sparkColor || '#2563EB').replace('#', '')}`
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="flex items-start justify-between mb-2.5">
        <div style={{ background: iconBg, width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 18, color: iconColor }} aria-hidden="true" />
        </div>
        {trend && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
            background: (trend.positive ? '#16a34a' : '#dc2626') + '1A',
            color: trend.positive ? '#16a34a' : '#dc2626',
          }}>
            {trend.label}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{value}</div>
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mt-0.5">{label}</div>
      {sub && <div className={`text-xs mt-1 ${subColor || 'text-gray-400'}`}>{sub}</div>}
      {spark && spark.length > 1 && (
        <div style={{ height: 36, margin: '6px -16px -16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.6}
                fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Section / chart card ───────────────────────────────────────
function ChartCard({ icon, color, title, subtitle, right, children }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <div style={{ background: color + '1A', width: 30, height: 30, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className={`ti ${icon}`} style={{ fontSize: 15, color }} aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate">{title}</div>
            {subtitle && <div className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</div>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

// ── Filter dropdown ────────────────────────────────────────────
function FilterSelect({ icon, value, onChange, options, allLabel, includeAll = true, optionLabel = (o) => o, highlight }) {
  const isActive = highlight != null ? highlight : value !== 'all'
  return (
    <div className="relative inline-flex items-center">
      {icon && <i className={`ti ${icon} text-sm text-gray-400 absolute left-2.5 pointer-events-none`} aria-hidden="true" />}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`appearance-none text-xs font-medium rounded-lg border cursor-pointer transition-colors
          ${isActive
            ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300'}
          ${icon ? 'pl-7' : 'pl-2.5'} pr-7 py-1.5`}
      >
        {includeAll && <option value="all">{allLabel}</option>}
        {options.map(o => <option key={o} value={o}>{optionLabel(o)}</option>)}
      </select>
      <i className="ti ti-chevron-down text-xs text-gray-400 absolute right-2 pointer-events-none" aria-hidden="true" />
    </div>
  )
}

export default function Dashboard() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const { dark } = useThemeStore()

  const deptPieRef = useRef(null)
  const [filters, setFilters] = useState({
    fy: CURRENT_FISCAL_YEAR, department: 'all', brand: 'all', plant: 'all', status: 'all',
  })
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const resetFilters = () => setFilters(f => ({ fy: f.fy, department: 'all', brand: 'all', plant: 'all', status: 'all' }))

  // Plage de mois fiscaux (1 = Déc … 12 = Nov) pour la table « comparaison
  // annuelle » : les DEUX années sont agrégées sur la même période, ce qui
  // permet une vraie comparaison « à ce jour » (sinon l'année précédente
  // complète est comparée à une année courante partielle).
  const [deptCmp, setDeptCmp] = useState({ from: 1, to: 12 })
  const setDeptCmpFrom = v => setDeptCmp(r => ({ from: Number(v), to: Math.max(Number(v), r.to) }))
  const setDeptCmpTo   = v => setDeptCmp(r => ({ from: Math.min(Number(v), r.from), to: Number(v) }))
  const now = new Date()
  const currentFiscalMonth = getFiscalMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`) || 12
  const cmpFull = deptCmp.from === 1 && deptCmp.to === 12
  const cmpYtdActive = deptCmp.from === 1 && deptCmp.to === currentFiscalMonth && currentFiscalMonth !== 12
  const toggleCmpYtd = () => setDeptCmp(cmpYtdActive ? { from: 1, to: 12 } : { from: 1, to: currentFiscalMonth })
  const fmShort = f => (FISCAL_MONTH_ORDER.find(m => m.fiscal === Number(f)) || {}).nameShort || String(f)

  const { data: currentYearTickets, isLoading: loadingCurrent } = useQuery({
    queryKey: ['tickets', 'dashboard', filters.fy],
    queryFn: () => ticketApi.list({ fiscal_year: filters.fy }).then(r => r.data.tickets),
    staleTime: 10 * 60 * 1000,
    keepPreviousData: true,
  })

  const { data: prevYearTickets } = useQuery({
    queryKey: ['tickets', 'dashboard', filters.fy - 1],
    queryFn: () => ticketApi.list({ fiscal_year: filters.fy - 1 }).then(r => r.data.tickets),
    staleTime: 10 * 60 * 1000,
    keepPreviousData: true,
  })

  // Per-line rows for the current & previous fiscal year — costs are aggregated
  // from these (occurrence_lines), not the occurrence-level fields.
  const curIds  = (currentYearTickets || []).map(t => t.id)
  const prevIds = (prevYearTickets    || []).map(t => t.id)
  const { data: curLinesRaw } = useQuery({
    queryKey: ['dashboard-lines', curIds],
    queryFn: () => fetchOccurrenceLines(curIds),
    enabled: curIds.length > 0,
    staleTime: 10 * 60 * 1000,
    keepPreviousData: true,
  })
  const { data: prevLinesRaw } = useQuery({
    queryKey: ['dashboard-lines', prevIds],
    queryFn: () => fetchOccurrenceLines(prevIds),
    enabled: prevIds.length > 0,
    staleTime: 10 * 60 * 1000,
    keepPreviousData: true,
  })

  // Revenus mensuels (éditables via Référentiels › Revenus).
  const { data: revenueRows } = useQuery({
    queryKey: ['monthly-revenue'],
    queryFn: revenueApi.all,
    staleTime: 10 * 60 * 1000,
  })

  if (loadingCurrent && !currentYearTickets) return (
    <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  )

  const rawTickets = currentYearTickets || []
  const rawPrev    = prevYearTickets    || []

  // Filter option lists (from the unfiltered year so they never disappear)
  const uniq = (arr, key) => [...new Set(arr.map(t => t[key]).filter(Boolean))].sort()
  // « (Non défini) » : filtre pour isoler le coût/les occurrences sans département
  // (correspond à la part « (Non défini) » du camembert). Un coût est non défini
  // quand ni la ligne ni l'occurrence n'a de département → ⟺ occurrence sans dépt.
  const NO_DEPT = t('dashboard.unclassified')
  const deptOptions   = rawTickets.some(tk => !tk.department)
    ? [NO_DEPT, ...uniq(rawTickets, 'department')] : uniq(rawTickets, 'department')
  const brandOptions  = uniq(rawTickets, 'brand')
  const plantOptions  = uniq(rawTickets, 'plant')
  const statusOptions = STATUS_ORDER.filter(s => rawTickets.some(t => t.status === s))
  const deptMatch = (dep) => filters.department === 'all' || dep === filters.department
    || (filters.department === NO_DEPT && !dep)

  const match = (tk) =>
    deptMatch(tk.department) &&
    (filters.brand      === 'all' || tk.brand      === filters.brand) &&
    (filters.plant      === 'all' || tk.plant      === filters.plant) &&
    (filters.status     === 'all' || tk.status     === filters.status)

  const tickets     = rawTickets.filter(match)
  const prevTickets = rawPrev.filter(match)
  const activeCount = ['department', 'brand', 'plant', 'status'].filter(k => filters[k] !== 'all').length

  // Revenus par mois fiscal, pour l'année courante et la précédente. Les lignes
  // sont ventilées par usine (plant NULL = totaux non ventilés) : on somme.
  // Avec un filtre usine actif, seul le revenu de cette usine compte — un mois
  // sans revenu pour cette usine disparaît du graphique « SC Cost % ».
  const revByFY = {}
  ;(revenueRows || []).forEach(r => {
    if (filters.plant !== 'all' && r.plant !== filters.plant) return
    const m = (revByFY[r.fiscal_year] = revByFY[r.fiscal_year] || {})
    m[r.fiscal_month] = (m[r.fiscal_month] || 0) + (Number(r.revenue) || 0)
  })
  const revenueByFM     = revByFY[filters.fy]     || {}
  const prevRevenueByFM = revByFY[filters.fy - 1] || {}
  const revenueAvailable = Object.values(revenueByFM).some(v => v > 0)

  // ── Cost units (per line) ──────────────────────────────────
  // Le coût vient des lignes (occurrence_lines). Chaque ligne devient une
  // « unité de coût » portant sa valeur/dépt/usine/catégorie + les attributs de
  // l'occurrence parente (mois fiscal, marque, statut, client). Repli sur le
  // coût au niveau occurrence pour les occurrences sans ligne (comme la liste).
  const groupByOcc = (rows) => {
    const m = {}
    ;(rows || []).forEach(l => { (m[l.occurrence_id] = m[l.occurrence_id] || []).push(l) })
    return m
  }
  const curByOcc  = groupByOcc(curLinesRaw)
  const prevByOcc = groupByOcc(prevLinesRaw)
  const buildUnits = (occs, byOcc) => {
    const units = []
    occs.forEach(tk => {
      const ls = byOcc[tk.id] || []
      const lineSum = ls.reduce((s, l) => s + Number(l.cost_approx || 0), 0)
      const parent = { fiscal_month: tk.fiscal_month, brand: tk.brand, status: tk.status, ship_to: tk.ship_to, occId: tk.id }
      // Détail par ligne SEULEMENT si les lignes portent un coût (> 0), sinon repli
      // sur le coût + dépt/usine/catégorie au niveau occurrence — exactement comme
      // la liste (getCost). Sans ça, les occurrences dont le coût est au niveau
      // occurrence (lignes à 0) comptaient pour $0 et le total s'effondrait.
      if (lineSum > 0) {
        // Une ligne non classée hérite de la classification de l'occurrence
        // (sinon son coût tomberait dans « non défini » alors que l'occurrence
        // a bien un département) — sans ça, le détail ne totalise pas le KPI.
        ls.forEach(l => units.push({ cost: Number(l.cost_approx || 0),
          department: l.department || tk.department || null,
          plant: l.plant || tk.plant || null,
          categories: l.categories || tk.categories || null, ...parent }))
      } else {
        units.push({ cost: Number(tk.cost_approx || 0),
          department: tk.department || null, plant: tk.plant || null, categories: tk.categories || null, ...parent })
      }
    })
    return units
  }
  // Coût : dépt/usine filtrés au niveau LIGNE ; marque/statut au niveau occurrence.
  const unitMatch = (u) =>
    deptMatch(u.department) &&
    (filters.brand      === 'all' || u.brand      === filters.brand) &&
    (filters.plant      === 'all' || u.plant      === filters.plant) &&
    (filters.status     === 'all' || u.status     === filters.status)
  const costUnits = buildUnits(rawTickets, curByOcc).filter(unitMatch)
  const prevUnits = buildUnits(rawPrev,    prevByOcc).filter(unitMatch)

  // Coût par occurrence (tableau « récentes ») = somme de ses lignes, repli sur le header.
  const occLineCost = {}
  ;(curLinesRaw || []).forEach(l => { occLineCost[l.occurrence_id] = (occLineCost[l.occurrence_id] || 0) + Number(l.cost_approx || 0) })
  const getTicketCost = (tk) => (occLineCost[tk.id] > 0 ? occLineCost[tk.id] : Number(tk.cost_approx || 0))

  // ── KPIs ───────────────────────────────────────────────────
  const totalCost = costUnits.reduce((s, u) => s + u.cost, 0)
  const scCost    = costUnits.filter(u => u.department !== 'Client').reduce((s, u) => s + u.cost, 0)
  const open      = tickets.filter(tk => !['completed', 'cancelled'].includes(tk.status)).length
  const completed = tickets.filter(tk => tk.status === 'completed').length
  const completionPct = tickets.length > 0 ? Math.round(completed / tickets.length * 100) : 0

  const prevTotalCost = prevUnits.reduce((s, u) => s + u.cost, 0)
  const prevCompletionPct = prevTickets.length > 0
    ? Math.round(prevTickets.filter(tk => tk.status === 'completed').length / prevTickets.length * 100) : 0

  const vsLabel = `vs FY${filters.fy - 1}`
  const pctTrend = (cur, prev, lowerIsBetter) => {
    if (!prev) return null
    const diff = cur - prev
    const pct  = Math.round(Math.abs(diff) / prev * 100)
    return { label: `${diff >= 0 ? '+' : '−'}${pct}% ${vsLabel}`, positive: lowerIsBetter ? diff <= 0 : diff >= 0 }
  }
  const ticketTrend = pctTrend(tickets.length, prevTickets.length, true)
  const costTrend   = pctTrend(totalCost, prevTotalCost, true)
  const completionTrend = prevCompletionPct
    ? { label: `${completionPct - prevCompletionPct >= 0 ? '+' : '−'}${Math.abs(completionPct - prevCompletionPct)}% ${vsLabel}`,
        positive: completionPct - prevCompletionPct >= 0 }
    : null

  const ytdRevenue     = Object.values(revenueByFM).reduce((s, v) => s + v, 0)
  const ytdPct         = ytdRevenue > 0 ? scCost / ytdRevenue * 100 : null
  const aboveTolerance = ytdPct != null && ytdPct > 0.3

  // ── Per-month series (charts + sparklines) ─────────────────
  const monthCount = fiscal => tickets.filter(t => t.fiscal_month === fiscal).length
  const monthCost  = fiscal => costUnits.filter(u => u.fiscal_month === fiscal).reduce((s, u) => s + u.cost, 0)
  const monthDone  = fiscal => tickets.filter(t => t.fiscal_month === fiscal && t.status === 'completed').length

  const sparkCounts = FISCAL_MONTH_ORDER.map(m => monthCount(m.fiscal))
  const sparkCost   = FISCAL_MONTH_ORDER.map(m => Math.round(monthCost(m.fiscal)))
  const sparkDone   = FISCAL_MONTH_ORDER.map(m => monthDone(m.fiscal))

  // SC cost as % of revenue — current FY (dark) vs previous FY (pale), side by side.
  // Client is excluded from the numerator. Revenue is per fiscal month (table
  // monthly_revenue). A month shows only if it has a revenue > 0 → renseigner un
  // mois le fait apparaître. La barre pâle (année N-1) utilise le revenu de N-1
  // s'il existe, sinon celui de l'année courante en repli.
  const scMonthCost = (units, fiscal) => units
    .filter(u => u.fiscal_month === fiscal && u.department !== 'Client')
    .reduce((sum, u) => sum + u.cost, 0)
  const scPctData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const revenue     = revenueByFM[fiscal] || 0
    const prevRevenue = prevRevenueByFM[fiscal] || revenue
    const pct     = revenue > 0 ? +(scMonthCost(costUnits, fiscal) / revenue * 100).toFixed(3) : null
    const prevPct = prevRevenue > 0 ? +(scMonthCost(prevUnits, fiscal) / prevRevenue * 100).toFixed(3) : null
    return { name: nameShort, pct, prevPct }
  }).filter(d => d.pct !== null)
  const sparkScPct = scPctData.map(d => d.pct)

  const eventsByMonthData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => ({
    name:    nameShort,
    current: tickets.filter(t => t.fiscal_month === fiscal).length || null,
    prev:    prevTickets.filter(t => t.fiscal_month === fiscal).length || null,
  }))

  const byCount = (map) => Object.entries(map).sort((a, b) => b[1] - a[1])
  const clientKey = s => (s.length > 28 ? s.slice(0, 28) + '…' : s)
  // Coûts par dépt / usine / client : agrégés depuis les unités de coût (par ligne).
  // Le coût sans département/usine va dans un bucket « non défini » pour que le
  // détail totalise EXACTEMENT le KPI (rien n'est perdu). Client garde ship_to.
  const UNCLASSIFIED = t('dashboard.unclassified')
  const deptCostMap = {}, plantCostMap = {}, clientCostMap = {}
  costUnits.forEach(u => {
    if (u.cost > 0) {
      deptCostMap[u.department || UNCLASSIFIED]  = (deptCostMap[u.department || UNCLASSIFIED] || 0) + u.cost
      plantCostMap[u.plant || UNCLASSIFIED]      = (plantCostMap[u.plant || UNCLASSIFIED] || 0) + u.cost
      if (u.ship_to) clientCostMap[clientKey(u.ship_to)] = (clientCostMap[clientKey(u.ship_to)] || 0) + u.cost
    }
  })
  // Comptes (catégorie, nb par client) : restent au niveau occurrence.
  const catMap = {}, clientMap = {}
  tickets.forEach(tk => {
    if (tk.categories) catMap[tk.categories] = (catMap[tk.categories] || 0) + 1
    if (tk.ship_to)    clientMap[clientKey(tk.ship_to)] = (clientMap[clientKey(tk.ship_to)] || 0) + 1
  })
  const deptCostData  = byCount(deptCostMap).map(([name, cost]) => ({ name, cost: Math.round(cost) }))
  // Total « année fiscale entière » pour le camembert et son export Excel —
  // indépendant de la plage de mois de la table de comparaison.
  const deptPieTotal  = deptCostData.reduce((s, d) => s + d.cost, 0)
  const plantCostData = byCount(plantCostMap).map(([name, cost]) => ({ name, cost: Math.round(cost) }))
  const catData       = byCount(catMap).map(([name, count]) => ({ name, count }))
  const topClientsData = byCount(clientMap).slice(0, 10).map(([name, count]) => ({ name, count }))
  const topClientsCostData = byCount(clientCostMap).slice(0, 10).map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  // Cost by department — current fiscal year vs previous (respects active filters).
  // Borné à la plage de mois fiscaux deptCmp, appliquée aux DEUX années pour une
  // comparaison à périmètre égal. Plage pleine = aucun filtre de mois, afin de ne
  // pas exclure les unités sans mois fiscal (comportement historique).
  const inCmpRange = u => cmpFull || (u.fiscal_month >= deptCmp.from && u.fiscal_month <= deptCmp.to)
  const cmpDeptCostMap = {}, prevDeptCostMap = {}
  costUnits.forEach(u => {
    if (u.cost > 0 && inCmpRange(u)) cmpDeptCostMap[u.department || UNCLASSIFIED] = (cmpDeptCostMap[u.department || UNCLASSIFIED] || 0) + u.cost
  })
  prevUnits.forEach(u => {
    if (u.cost > 0 && inCmpRange(u)) prevDeptCostMap[u.department || UNCLASSIFIED] = (prevDeptCostMap[u.department || UNCLASSIFIED] || 0) + u.cost
  })
  const deptCompareData = [...new Set([...Object.keys(cmpDeptCostMap), ...Object.keys(prevDeptCostMap)])]
    .map(name => {
      const cur = Math.round(cmpDeptCostMap[name] || 0)
      const prev = Math.round(prevDeptCostMap[name] || 0)
      const gap = cur - prev
      const pct = prev > 0 ? Math.round(gap / prev * 100) : null
      return { name, cur, prev, gap, pct }
    })
    .sort((a, b) => b.cur - a.cur)
  const deptCompareTotals = deptCompareData.reduce((acc, d) => {
    acc.cur += d.cur; acc.prev += d.prev; return acc
  }, { cur: 0, prev: 0 })
  deptCompareTotals.gap = deptCompareTotals.cur - deptCompareTotals.prev
  deptCompareTotals.pct = deptCompareTotals.prev > 0
    ? Math.round(deptCompareTotals.gap / deptCompareTotals.prev * 100) : null

  const brands = brandOptions
  const brandTrendData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const row = { name: nameShort }
    let total = 0
    brands.forEach(b => {
      const n = tickets.filter(t => t.fiscal_month === fiscal && t.brand === b).length
      row[b] = n || null
      total += n
    })
    row.total = total || null
    return row
  }).filter(row => brands.some(b => row[b]))

  const statusData = STATUS_ORDER
    .map(key => ({ key, name: t(`status.${key}`), value: tickets.filter(t => t.status === key).length }))
    .filter(d => d.value > 0)

  // chart helpers
  const axisColor = dark ? '#94A3B8' : '#64748B'
  const gridColor = dark ? '#1F2937' : '#EEF2F7'
  const palePrev  = dark ? '#334155' : '#CBD5E1'
  const pctLabel  = v => (v ? `${Number(v).toFixed(2)}%` : '')

  // ── Dept-cost pie: always-on labels with collision-avoided leader lines ──
  // Geometry is fixed so the label y-positions can be de-collided up front, then
  // stacked down each side (Excel-style) instead of piling up near 12 o'clock.
  const PIE_H = 520, PIE_R = 140, PIE_MARGIN_Y = 12
  const PIE_CY = PIE_MARGIN_Y + (PIE_H - 2 * PIE_MARGIN_Y) / 2
  const pieInk = dark ? '#e6edf3' : '#111827'
  const pieLabelLayout = (() => {
    const RAD = Math.PI / 180
    const total = deptCostData.reduce((s, d) => s + d.cost, 0) || 1
    let acc = 0
    const items = deptCostData.map(d => {
      const a = -(90 - (acc + d.cost / total / 2) * 360) * RAD   // slice mid-angle (start 12 o'clock, clockwise)
      acc += d.cost / total
      const cos = Math.cos(a), sin = Math.sin(a)
      return { name: d.name, value: d.cost, cos, sin, side: cos >= 0 ? 1 : -1,
        idealY: PIE_CY + (PIE_R + 18) * sin, y: 0 }
    })
    const GAP = 15, MIN_Y = 12, MAX_Y = PIE_H - 12
    ;[-1, 1].forEach(side => {
      const arr = items.filter(it => it.side === side).sort((a, b) => a.idealY - b.idealY)
      let prev = -Infinity
      arr.forEach(it => { it.y = Math.max(it.idealY, prev + GAP); prev = it.y })       // push apart downward
      const over = arr.length ? arr[arr.length - 1].y - MAX_Y : 0
      if (over > 0) arr.forEach(it => { it.y -= over })                                // pull back if past bottom
      if (arr.length && arr[0].y < MIN_Y) { const d = MIN_Y - arr[0].y; arr.forEach(it => { it.y += d }) }
    })
    return Object.fromEntries(items.map(it => [it.name, it]))
  })()
  const renderPieLabel = ({ cx, cy, outerRadius, name }) => {
    const it = pieLabelLayout[name]
    if (!it) return null
    const sx = cx + outerRadius * it.cos
    const sy = cy + outerRadius * it.sin
    const mx = cx + it.side * (outerRadius + 16)
    const tx = cx + it.side * (outerRadius + 40)
    return (
      <g>
        <polyline points={`${sx},${sy} ${mx},${it.y} ${tx},${it.y}`} stroke={axisColor} strokeWidth={1} fill="none" />
        <text x={tx + it.side * 4} y={it.y} textAnchor={it.side > 0 ? 'start' : 'end'} dominantBaseline="central"
          fontSize={11} fill={pieInk}>
          {`${name}  ${money(it.value)}`}
        </text>
      </g>
    )
  }

  // Export the department pie AS AN IMAGE embedded in an .xlsx (not a table).
  // The chart SVG is rasterized to PNG, then embedded via exceljs (SheetJS can't
  // embed images). exceljs is dynamically imported so it never affects the main
  // bundle/build and only loads when the button is clicked.
  const exportDeptCosts = async () => {
    try {
      const svgEl = deptPieRef.current?.querySelector('svg')
      if (!svgEl) { toast.error(t('common.error')); return }
      const rect = svgEl.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height))
      const clone = svgEl.cloneNode(true)
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', w); clone.setAttribute('height', h)
      const svgStr = new XMLSerializer().serializeToString(clone)
      const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr)

      const scale = 2 // hi-res so the chart stays crisp in Excel
      const pngBase64 = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = w * scale; canvas.height = h * scale
          const ctx = canvas.getContext('2d')
          ctx.scale(scale, scale)
          ctx.fillStyle = dark ? '#0D1117' : '#ffffff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/png').split(',')[1])
        }
        img.onerror = reject
        img.src = svgUrl
      })

      const bytes = buildXlsxWithImage({
        sheetName: `Dept FY${filters.fy}`,
        title: `Coût par département — FY${filters.fy} — ${money(deptPieTotal)}`,
        pngBase64, imgWidth: w, imgHeight: h,
      })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url; a.download = `cout-par-departement-FY${filters.fy}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      toast.success(t('common.save'))
    } catch (e) {
      console.error(e)
      toast.error(t('common.error'))
    }
  }
  const tip   = (fmt) => <Tooltip cursor={{ fill: dark ? '#ffffff08' : '#00000006' }} content={(p) => <ChartTooltip {...p} dark={dark} fmt={fmt} />} />
  const NoData = () => (
    <div className="flex flex-col items-center justify-center text-gray-300 dark:text-gray-600" style={{ height: 180 }}>
      <i className="ti ti-chart-bar-off text-3xl mb-2" aria-hidden="true" />
      <span className="text-xs">{t('dashboard.no_data')}</span>
    </div>
  )
  const deptHeight  = Math.max(220, deptCostData.length * 34)
  const plantHeight = Math.max(180, plantCostData.length * 34)
  const catHeight   = Math.max(180, catData.length * 34)

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={`FY${filters.fy} — ${t('dashboard.overview_subtitle')}`} />
      {/* Sticky filter toolbar — lives outside the scroll area so it stays put while charts scroll */}
      <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] flex-shrink-0 z-10">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 pr-1">
            <i className="ti ti-adjustments-horizontal text-base" aria-hidden="true" />
            {t('dashboard.filters')}
          </div>
          <FilterSelect icon="ti-calendar" includeAll={false} highlight={false}
            value={String(filters.fy)} onChange={v => setFilter('fy', Number(v))}
            options={[CURRENT_FISCAL_YEAR, CURRENT_FISCAL_YEAR - 1, CURRENT_FISCAL_YEAR - 2].map(y => String(y))}
            optionLabel={y => `FY${y}`} />
          <FilterSelect icon="ti-building-factory" value={filters.plant} onChange={v => setFilter('plant', v)} options={plantOptions} allLabel={t('ticket.plant')} />
          <FilterSelect icon="ti-tag" value={filters.brand} onChange={v => setFilter('brand', v)} options={brandOptions} allLabel={t('ticket.brand')} />
          <FilterSelect icon="ti-building" value={filters.department} onChange={v => setFilter('department', v)} options={deptOptions} allLabel={t('ticket.department')} />
          <FilterSelect icon="ti-flag" value={filters.status} onChange={v => setFilter('status', v)}
            options={statusOptions} optionLabel={o => t(`status.${o}`)} allLabel={t('ticket.status')} />
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
            <span>{t('dashboard.showing_of', { n: tickets.length, total: rawTickets.length })}</span>
            {activeCount > 0 && (
              <button onClick={resetFilters} className="btn-ghost text-xs py-1 px-2.5 inline-flex items-center gap-1">
                <i className="ti ti-x text-xs" aria-hidden="true" /> {t('dashboard.clear')}
              </button>
            )}
          </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon="ti-clipboard-list" iconBg="#EFF6FF" iconColor="#2563EB"
            label={t('dashboard.occurrences')} value={tickets.length}
            sub={`${open} ${t('dashboard.open')}`} trend={ticketTrend}
            spark={sparkCounts} sparkColor="#2563EB" />
          <StatCard icon="ti-currency-dollar" iconBg="#FFFBEB" iconColor="#D97706"
            label={t('dashboard.total_cost_label')} value={money(totalCost)}
            sub={`SC ${money(scCost)} (excl. Client)`} trend={costTrend}
            spark={sparkCost} sparkColor="#D97706" />
          <StatCard icon="ti-chart-line"
            iconBg={aboveTolerance ? '#FEF2F2' : '#F0FDF4'} iconColor={aboveTolerance ? '#DC2626' : '#16A34A'}
            label={t('dashboard.sc_cost_ytd')} value={ytdPct != null ? `${ytdPct.toFixed(2)}%` : '—'}
            sub={ytdPct != null ? `${t('dashboard.tolerance')} 0.30%` : t('dashboard.revenue_note', { fy: CURRENT_FISCAL_YEAR })}
            subColor="text-gray-400"
            trend={ytdPct != null ? { label: aboveTolerance ? t('dashboard.above_limit') : t('dashboard.within_limit'), positive: !aboveTolerance } : null}
            spark={revenueAvailable ? sparkScPct : null} sparkColor={aboveTolerance ? '#DC2626' : '#16A34A'} />
          <StatCard icon="ti-circle-check" iconBg="#F0FDF4" iconColor="#16A34A"
            label={t('dashboard.completion_rate')} value={`${completionPct}%`}
            sub={`${completed} ${t('dashboard.completed')}`} subColor="text-green-500" trend={completionTrend}
            spark={sparkDone} sparkColor="#16A34A" />
        </div>

        {/* SC cost % + Status donut */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ChartCard icon="ti-chart-line" color="#2563EB"
              title={t('dashboard.sc_cost_chart')} subtitle={t('dashboard.sc_cost_subtitle')}>
              {scPctData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={scPctData} margin={{ top: 24 }} barCategoryGap="22%">
                    <defs>
                      <linearGradient id="gradSc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={gridColor} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
                    {tip(v => `${Number(v).toFixed(3)}%`)}
                    <ReferenceLine y={TOLERANCE_PCT * 100} stroke="#EF4444" strokeDasharray="4 4"
                      label={{ value: '0.3%', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="prevPct" name={`FY${filters.fy - 1}`} fill={palePrev} radius={[5, 5, 0, 0]} maxBarSize={40}>
                      <LabelList dataKey="prevPct" position="top" offset={6} fontSize={9} fill={axisColor} formatter={pctLabel} />
                    </Bar>
                    <Bar dataKey="pct" name={`FY${filters.fy}`} radius={[5, 5, 0, 0]} maxBarSize={40}>
                      {scPctData.map((entry, i) => <Cell key={i} fill={entry.pct > 0.3 ? '#DC2626' : 'url(#gradSc)'} />)}
                      <LabelList dataKey="pct" position="top" offset={6} fontSize={9} fontWeight={700} fill={axisColor} formatter={pctLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <NoData />}
            </ChartCard>
          </div>

          <ChartCard icon="ti-chart-donut" color="#8B5CF6" title={t('dashboard.status_distribution')}>
            {statusData.length ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                      {statusData.map(d => <Cell key={d.key} fill={STATUS_COLORS[d.key]} />)}
                    </Pie>
                    {tip()}
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-x-0 flex flex-col items-center pointer-events-none" style={{ top: 84 }}>
                  <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tickets.length}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{t('dashboard.occurrences')}</span>
                </div>
              </div>
            ) : <NoData />}
          </ChartCard>
        </div>

        {/* Events by month + Brand trend — 2 per row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard icon="ti-calendar-stats" color="#2563EB"
          title={t('dashboard.events_chart')} subtitle={`FY${filters.fy} vs FY${filters.fy - 1}`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={eventsByMonthData} margin={{ top: 22 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={gridColor} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
              {tip()}
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="prev" name={`FY${filters.fy - 1}`} fill={palePrev} radius={[4, 4, 0, 0]} maxBarSize={30}>
                <LabelList dataKey="prev" position="top" offset={6} fontSize={9} fill={axisColor} formatter={v => v || ''} />
              </Bar>
              <Bar dataKey="current" name={`FY${filters.fy}`} fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={30}>
                <LabelList dataKey="current" position="top" offset={6} fontSize={9} fontWeight={700} fill={axisColor} formatter={v => v || ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Brand trend */}
        <ChartCard icon="ti-tag" color="#7C3AED"
          title={t('dashboard.tickets_by_brand')} subtitle={t('dashboard.tickets_by_brand_subtitle')}>
          {brandTrendData.length ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={brandTrendData} margin={{ top: 28 }}>
                <CartesianGrid vertical={false} stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false}
                  domain={[0, dataMax => Math.ceil(dataMax * 1.05)]} />
                {tip()}
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {brands.map((brand, i) => (
                  <Bar key={brand} dataKey={brand} stackId="a" fill={BRAND_COLORS[i % BRAND_COLORS.length]} maxBarSize={46}
                    radius={i === brands.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                    {i === brands.length - 1 && (
                      <LabelList dataKey="total" position="top" offset={8}
                        fill={axisColor} fontSize={11} fontWeight={700} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : <NoData />}
        </ChartCard>
        </div>

        {/* Dept + Plant cost */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard icon="ti-building" color="#F59E0B"
            title={t('dashboard.by_department')}
            right={<span className="text-xs text-gray-400">{deptCostData.length} {t('dashboard.departments')}</span>}>
            {deptCostData.length ? (
              <ResponsiveContainer width="100%" height={deptHeight}>
                <BarChart data={deptCostData} layout="vertical" margin={{ left: 80 }}>
                  <defs>
                    <linearGradient id="gradAmber" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#FBBF24" /><stop offset="100%" stopColor="#F59E0B" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={moneyK} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={80} />
                  {tip(money)}
                  <Bar dataKey="cost" name={t('ticket.cost')} fill="url(#gradAmber)" radius={[0, 5, 5, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>

          <ChartCard icon="ti-building-factory" color="#7C3AED"
            title={t('dashboard.cost_by_plant')}
            right={<span className="text-xs text-gray-400">{plantCostData.length} {t('dashboard.plants_count')}</span>}>
            {plantCostData.length ? (
              <ResponsiveContainer width="100%" height={plantHeight}>
                <BarChart data={plantCostData} layout="vertical" margin={{ left: 60 }}>
                  <defs>
                    <linearGradient id="gradViolet" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#A78BFA" /><stop offset="100%" stopColor="#7C3AED" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={moneyK} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={60} />
                  {tip(money)}
                  <Bar dataKey="cost" name={t('ticket.cost')} fill="url(#gradViolet)" radius={[0, 5, 5, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>
        </div>

        {/* Top clients — by occurrences + by cost */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard icon="ti-users" color="#0891B2" title={t('dashboard.top_clients')}>
            {topClientsData.length ? (
              <ResponsiveContainer width="100%" height={Math.max(220, topClientsData.length * 34)}>
                <BarChart data={topClientsData} layout="vertical" margin={{ left: 140, right: 24 }}>
                  <defs>
                    <linearGradient id="gradCyan" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#0891B2" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} width={140} />
                  {tip()}
                  <Bar dataKey="count" name={t('dashboard.occurrences')} fill="url(#gradCyan)" radius={[0, 5, 5, 0]} maxBarSize={24}
                    label={{ position: 'right', fontSize: 10, fill: axisColor }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>

          <ChartCard icon="ti-currency-dollar" color="#059669"
            title={t('dashboard.top_clients_cost')} subtitle={t('dashboard.top_clients_cost_subtitle')}>
            {topClientsCostData.length ? (
              <ResponsiveContainer width="100%" height={Math.max(220, topClientsCostData.length * 34)}>
                <BarChart data={topClientsCostData} layout="vertical" margin={{ left: 140, right: 48 }}>
                  <defs>
                    <linearGradient id="gradEmerald" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#34D399" /><stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={moneyK} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} width={140} />
                  {tip(money)}
                  <Bar dataKey="cost" name={t('ticket.cost')} fill="url(#gradEmerald)" radius={[0, 5, 5, 0]} maxBarSize={24}>
                    <LabelList dataKey="cost" position="right" offset={6} fontSize={10} fill={axisColor} formatter={moneyK} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>
        </div>

        {/* By category + Cost by department pie — 2 per row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard icon="ti-category" color="#2563EB"
            title={t('dashboard.by_category')}
            right={<span className="text-xs text-gray-400">{catData.length} {t('dashboard.categories')}</span>}>
            {catData.length ? (
              <ResponsiveContainer width="100%" height={catHeight}>
                <BarChart data={catData} layout="vertical" margin={{ left: 110 }}>
                  <defs>
                    <linearGradient id="gradBlue" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#60A5FA" /><stop offset="100%" stopColor="#2563EB" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} width={110} />
                  {tip()}
                  <Bar dataKey="count" name={t('dashboard.occurrences')} fill="url(#gradBlue)" radius={[0, 5, 5, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>

          <ChartCard icon="ti-chart-pie" color="#F59E0B"
          title={t('dashboard.by_department')}
          subtitle={`FY${filters.fy} · ${money(deptPieTotal)}`}
          right={deptCostData.length ? (
            <button onClick={exportDeptCosts}
              className="btn-ghost text-xs py-1 px-2.5 inline-flex items-center gap-1">
              <i className="ti ti-file-spreadsheet text-sm" aria-hidden="true" /> {t('dashboard.export_excel')}
            </button>
          ) : null}>
          {deptCostData.length ? (
            <div ref={deptPieRef}>
              <ResponsiveContainer width="100%" height={PIE_H}>
                <PieChart margin={{ top: PIE_MARGIN_Y, right: 120, bottom: PIE_MARGIN_Y, left: 120 }}>
                  <Pie data={deptCostData} dataKey="cost" nameKey="name" cx="50%" cy="50%"
                    outerRadius={PIE_R} paddingAngle={0} startAngle={90} endAngle={-270}
                    stroke={dark ? '#0D1117' : '#ffffff'} strokeWidth={1}
                    labelLine={false} label={renderPieLabel} isAnimationActive={false}>
                    {deptCostData.map((d, i) => <Cell key={d.name} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />)}
                  </Pie>
                  {tip(money)}
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData />}
          </ChartCard>
        </div>

        {/* Dept FY vs FY comparison table */}
        <div className="grid grid-cols-1 gap-4">
          <ChartCard icon="ti-table" color="#F59E0B"
            title={t('dashboard.dept_comparison')}
            subtitle={cmpFull
              ? `FY${filters.fy} ${t('dashboard.ytd')} vs FY${filters.fy - 1} ${t('dashboard.ytd')}`
              : `FY${filters.fy} vs FY${filters.fy - 1} · ${fmShort(deptCmp.from)} – ${fmShort(deptCmp.to)}`}
            right={
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <button onClick={toggleCmpYtd} title={t('dashboard.cmp_ytd_tip')}
                  className={`text-xs font-medium rounded-lg border px-2.5 py-1.5 transition-colors ${cmpYtdActive
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300'}`}>
                  {t('dashboard.cmp_ytd')}
                </button>
                <FilterSelect icon="ti-calendar" includeAll={false} highlight={deptCmp.from !== 1}
                  value={String(deptCmp.from)} onChange={setDeptCmpFrom}
                  options={FISCAL_MONTH_ORDER.map(m => String(m.fiscal))} optionLabel={fmShort} />
                <span className="text-xs text-gray-400">–</span>
                <FilterSelect includeAll={false} highlight={deptCmp.to !== 12}
                  value={String(deptCmp.to)} onChange={setDeptCmpTo}
                  options={FISCAL_MONTH_ORDER.map(m => String(m.fiscal))} optionLabel={fmShort} />
              </div>
            }>
          {deptCompareData.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left font-medium py-2 pr-4">{t('ticket.department')}</th>
                    <th className="text-right font-medium py-2 px-4">{cmpFull ? `FY${filters.fy} ${t('dashboard.ytd')}` : `FY${filters.fy} · ${fmShort(deptCmp.from)}–${fmShort(deptCmp.to)}`}</th>
                    <th className="text-right font-medium py-2 px-4">{cmpFull ? `FY${filters.fy - 1} ${t('dashboard.ytd')}` : `FY${filters.fy - 1} · ${fmShort(deptCmp.from)}–${fmShort(deptCmp.to)}`}</th>
                    <th className="text-right font-medium py-2 px-4">{t('dashboard.gap')}</th>
                    <th className="text-right font-medium py-2 pl-4">+/-%</th>
                  </tr>
                </thead>
                <tbody>
                  {deptCompareData.map(d => (
                    <tr key={d.name} className="border-b border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                      <td className="text-left py-2 pr-4">{d.name}</td>
                      <td className="text-right py-2 px-4 font-mono">{money(d.cur)}</td>
                      <td className="text-right py-2 px-4 font-mono text-gray-500 dark:text-gray-400">{money(d.prev)}</td>
                      <td className="text-right py-2 px-4 font-mono">{signedMoney(d.gap)}</td>
                      <td className="text-right py-2 pl-4 font-bold">{d.pct != null ? `${d.pct >= 0 ? '+' : '−'}${Math.abs(d.pct)}%` : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-semibold">
                    <td className="text-left py-2 pr-4">{t('dashboard.total')}</td>
                    <td className="text-right py-2 px-4 font-mono">{money(deptCompareTotals.cur)}</td>
                    <td className="text-right py-2 px-4 font-mono">{money(deptCompareTotals.prev)}</td>
                    <td className="text-right py-2 px-4 font-mono">{signedMoney(deptCompareTotals.gap)}</td>
                    <td className="text-right py-2 pl-4 font-bold">{deptCompareTotals.pct != null ? `${deptCompareTotals.pct >= 0 ? '+' : '−'}${Math.abs(deptCompareTotals.pct)}%` : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <NoData />}
          </ChartCard>
        </div>

        {/* Recent occurrences */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.recent')}</div>
            <button className="btn-ghost text-xs" onClick={() => navigate('/tickets')}>
              {t('dashboard.see_all')} <i className="ti ti-arrow-right" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-[#161B22]">
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  {['SC#', 'Issue', 'Project', 'Brand', 'Dept.', 'Status', 'Cost'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">{t('dashboard.no_data')}</td></tr>
                )}
                {tickets.slice(0, 8).map(tk => {
                  const cost = getTicketCost(tk)
                  return (
                    <tr key={tk.id}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                      onClick={() => navigate(`/tickets/${tk.id}`)}>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{tk.sc_number || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">{tk.quality_issue}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-32 truncate">{tk.project_name}</td>
                      <td className="px-4 py-2.5"><BrandTag brand={tk.brand} /></td>
                      <td className="px-4 py-2.5"><span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">{tk.department}</span></td>
                      <td className="px-4 py-2.5"><StatusBadge status={tk.status} /></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-gray-100">
                        {cost > 0 ? money(cost) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </>
  )
}
