import { useState, useRef, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { fetchDashboardYear, revenueApi, FISCAL_MONTH_ORDER, currentFiscalYear } from '../../services/api'
import { localISODate, currentFiscalMonth } from '../../utils/fiscal'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'
import { useThemeStore } from '../../store/themeStore'
import { buildXlsxWithImage } from '../../utils/xlsxImage'
import toast from 'react-hot-toast'
import {
  computeDashboard, sanitizeFilters, inDashboardScope,
  ALL, TOLERANCE_PCT, SC_EXCLUDED_DEPT,
} from './metrics'

// Tous les calculs vivent dans ./metrics.js (module pur, testé par
// `npm run test:dashboard`) ; ce composant charge les données et affiche.
// Les revenus mensuels sont éditables via Référentiels › Revenus.

const BRAND_COLORS  = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA']
const OTHERS_COLOR  = '#94A3B8'
const DEPT_COLORS   = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA',
  '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#EC4899', '#22C55E', '#A855F7']
const STATUS_COLORS = {
  not_started:     '#94A3B8',
  service_desk:    '#3B82F6',
  sd_waiting_info: '#6366F1',
  quality_meeting: '#8B5CF6',
  wip:             '#F59E0B',
  completed:       '#10B981',
  cancelled:       '#EF4444',
}

// Rafraîchissement : un tableau de bord resté ouvert (en réunion, par exemple)
// se met à jour au retour sur l'onglet et toutes les 5 minutes ; avant, rien ne
// le rechargeait pendant 10 minutes, ni ensuite tant qu'on ne changeait pas de page.
const LIVE_QUERY = { staleTime: 60 * 1000, refetchOnWindowFocus: true, refetchInterval: 5 * 60 * 1000 }

// Montants arrondis à l'affichage seulement ; négatif (crédit fournisseur) signé.
const money  = v => {
  const n = Math.round(Number(v) || 0)
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString()}`
}
// Milliers : signe devant le $ (comme money) et une décimale sous 10 k$, sinon un
// crédit de −36 $ ou un client à 150 $ s'affichaient « $0k ».
const moneyK = v => {
  const k = (Number(v) || 0) / 1000
  const a = Math.abs(k)
  const s = a === 0 ? '0' : a < 10 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a))
  return `${k < 0 && s !== '0' ? '−' : ''}$${s}k`
}
const signedMoney = v => {
  const n = Math.round(Number(v) || 0)
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString()}`
}
const signedPct = p => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`
const truncate = (s, n = 28) => (s && s.length > n ? s.slice(0, n) + '…' : s)

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
function StatCard({ icon, iconBg, iconColor, label, value, sub, subColor, sub2, trend, spark, sparkColor }) {
  const gid = `spark-${(sparkColor || '#2563EB').replace('#', '')}`
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="flex items-start justify-between mb-2.5">
        <div style={{ background: iconBg, width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i className={`ti ${icon}`} style={{ fontSize: 18, color: iconColor }} aria-hidden="true" />
        </div>
        {trend && (
          <span title={trend.title} style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
            background: trend.neutral ? '#64748B1A' : (trend.positive ? '#16a34a' : '#dc2626') + '1A',
            color: trend.neutral ? '#64748B' : trend.positive ? '#16a34a' : '#dc2626',
          }}>
            {trend.label}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{value}</div>
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mt-0.5">{label}</div>
      {sub && <div className={`text-xs mt-1 ${subColor || 'text-gray-400'}`}>{sub}</div>}
      {sub2 && <div className="text-[11px] mt-0.5 text-amber-600 dark:text-amber-400">{sub2}</div>}
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
            {subtitle && <div className="text-xs text-gray-400 mt-0.5 truncate" title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</div>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

// ── Filter dropdown ────────────────────────────────────────────
// options : [{ value, label }]
function FilterSelect({ icon, value, onChange, options, allLabel, includeAll = true, highlight }) {
  const isActive = highlight != null ? highlight : value !== ALL
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
        {includeAll && <option value={ALL}>{allLabel}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <i className="ti ti-chevron-down text-xs text-gray-400 absolute right-2 pointer-events-none" aria-hidden="true" />
    </div>
  )
}

const timeOf = ms => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { dark } = useThemeStore()

  const deptPieRef = useRef(null)
  const today = localISODate()
  const thisFY = currentFiscalYear()
  const [filters, setFilters] = useState(() => ({
    fy: thisFY, department: ALL, brand: ALL, plant: ALL, status: ALL,
  }))
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const resetFilters = () => setFilters(f => ({ fy: f.fy, department: ALL, brand: ALL, plant: ALL, status: ALL }))

  // Plage de mois fiscaux (1 = Déc … 12 = Nov) de la table « comparaison
  // annuelle », appliquée aux DEUX années. L'année en cours est en plus comparée
  // à date égale (N-1 arrêtée au même jour) — voir metrics.js.
  const [deptCmp, setDeptCmp] = useState({ from: 1, to: 12 })
  const setDeptCmpFrom = v => setDeptCmp(r => ({ from: Number(v), to: Math.max(Number(v), r.to) }))
  const setDeptCmpTo   = v => setDeptCmp(r => ({ from: Math.min(Number(v), r.from), to: Number(v) }))
  const todayFM = currentFiscalMonth()
  const cmpFull = deptCmp.from === 1 && deptCmp.to === 12
  const cmpYtdActive = deptCmp.from === 1 && deptCmp.to === todayFM && todayFM !== 12
  const toggleCmpYtd = () => setDeptCmp(cmpYtdActive ? { from: 1, to: 12 } : { from: 1, to: todayFM })
  const fmShort = f => (FISCAL_MONTH_ORDER.find(m => m.fiscal === Number(f)) || {}).nameShort || String(f)

  // Occurrences + lignes d'une année dans UNE requête (cf. fetchDashboardYear) :
  // plus de chiffres calculés sur l'en-tête pendant que les lignes chargent.
  // Clé sous ['tickets'] : toute invalidation des occurrences (fiche, liste,
  // création) rafraîchit aussi le tableau de bord.
  const curQ = useQuery({
    queryKey: ['tickets', 'dashboard', filters.fy],
    queryFn: () => fetchDashboardYear(filters.fy, inDashboardScope),
    ...LIVE_QUERY,
  })
  const prevQ = useQuery({
    queryKey: ['tickets', 'dashboard', filters.fy - 1],
    queryFn: () => fetchDashboardYear(filters.fy - 1, inDashboardScope),
    ...LIVE_QUERY,
  })
  const revQ = useQuery({
    queryKey: ['monthly-revenue'],
    queryFn: revenueApi.all,
    ...LIVE_QUERY,
  })

  // Prêt quand l'année affichée est chargée et que N-1 et les revenus sont soit
  // chargés soit en erreur (la page s'affiche alors sans comparaison / sans SC %).
  const ready = !!curQ.data && (!!prevQ.data || prevQ.isError) && (!!revQ.data || revQ.isError)
  const d = useMemo(() => {
    if (!ready) return null
    return computeDashboard({
      cur: curQ.data,
      prev: prevQ.data || null,
      revenueRows: revQ.data || null,
      filters, today, cmpRange: deptCmp,
      labels: { none: t('dashboard.unclassified'), others: t('dashboard.others') },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, curQ.data, prevQ.data, revQ.data, filters, today, deptCmp, i18n.language])

  // Un filtre dont la valeur n'existe pas dans l'année choisie est remis à « tous ».
  useEffect(() => {
    if (!d) return
    const next = sanitizeFilters(filters, d.options)
    if (['department', 'plant', 'brand', 'status'].some(k => next[k] !== filters[k])) setFilters(next)
  }, [d, filters])

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tickets', 'dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['monthly-revenue'] })
  }
  const fetching = curQ.isFetching || prevQ.isFetching || revQ.isFetching
  const updatedAt = Math.min(...[curQ.dataUpdatedAt, prevQ.dataUpdatedAt, revQ.dataUpdatedAt].filter(Boolean))
  // Erreur d'actualisation alors que des données sont affichées : on garde les
  // chiffres, mais on dit de quand ils datent.
  const refreshFailed = !!curQ.data && (curQ.isRefetchError || prevQ.isRefetchError || revQ.isRefetchError)
  // N-1 jamais chargée : la page s'affiche sans comparaison, et le dit (sinon
  // les barres N-1 vides se liraient « 0 événement l'an dernier »).
  const prevFailed = prevQ.isError && !prevQ.data

  const activeCount = ['department', 'brand', 'plant', 'status'].filter(k => filters[k] !== ALL).length
  const fyOptions = [0, 1, 2].map(i => ({ value: String(thisFY - i), label: `FY${thisFY - i}` }))

  // chart helpers
  const axisColor = dark ? '#94A3B8' : '#64748B'
  const gridColor = dark ? '#1F2937' : '#EEF2F7'
  const palePrev  = dark ? '#334155' : '#CBD5E1'
  const pctLabel  = v => (v ? `${Number(v).toFixed(2)}%` : '')
  const tip   = (fmt) => <Tooltip cursor={{ fill: dark ? '#ffffff08' : '#00000006' }} content={(p) => <ChartTooltip {...p} dark={dark} fmt={fmt} />} />
  const NoData = () => (
    <div className="flex flex-col items-center justify-center text-gray-300 dark:text-gray-600" style={{ height: 180 }}>
      <i className="ti ti-chart-bar-off text-3xl mb-2" aria-hidden="true" />
      <span className="text-xs">{t('dashboard.no_data')}</span>
    </div>
  )

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] flex-shrink-0 z-10">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 pr-1">
        <i className="ti ti-adjustments-horizontal text-base" aria-hidden="true" />
        {t('dashboard.filters')}
      </div>
      <FilterSelect icon="ti-calendar" includeAll={false} highlight={false}
        value={String(filters.fy)} onChange={v => setFilter('fy', Number(v))} options={fyOptions} />
      {d && <>
        <FilterSelect icon="ti-building-factory" value={filters.plant} onChange={v => setFilter('plant', v)} options={d.options.plants} allLabel={t('ticket.plant')} />
        <FilterSelect icon="ti-tag" value={filters.brand} onChange={v => setFilter('brand', v)} options={d.options.brands} allLabel={t('ticket.brand')} />
        <FilterSelect icon="ti-building" value={filters.department} onChange={v => setFilter('department', v)} options={d.options.departments} allLabel={t('ticket.department')} />
        <FilterSelect icon="ti-flag" value={filters.status} onChange={v => setFilter('status', v)}
          options={d.options.statuses.map(s => ({ value: s, label: t(`status.${s}`) }))} allLabel={t('ticket.status')} />
      </>}
      <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
        {d && <span>{t('dashboard.showing_of', { n: d.kpi.occurrences, total: d.kpi.inScopeOccurrences })}</span>}
        {activeCount > 0 && (
          <button onClick={resetFilters} className="btn-ghost text-xs py-1 px-2.5 inline-flex items-center gap-1">
            <i className="ti ti-x text-xs" aria-hidden="true" /> {t('dashboard.clear')}
          </button>
        )}
        {d && prevFailed && (
          <span className="text-amber-600 dark:text-amber-400">{t('dashboard.prev_unavailable', { fy: filters.fy - 1 })}</span>
        )}
        {d && updatedAt > 0 && Number.isFinite(updatedAt) && (
          <span className={refreshFailed ? 'text-amber-600 dark:text-amber-400' : ''}>
            {refreshFailed ? t('dashboard.refresh_error', { time: timeOf(updatedAt) }) : t('dashboard.updated_at', { time: timeOf(updatedAt) })}
          </span>
        )}
        <button onClick={refreshAll} disabled={fetching} title={t('dashboard.refresh')}
          className="btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1 disabled:opacity-60">
          <i className={`ti ti-refresh text-sm ${fetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">{t('dashboard.refresh')}</span>
        </button>
      </div>
    </div>
  )

  const header = <PageHeader title={t('nav.dashboard')} subtitle={`FY${filters.fy} — ${t('dashboard.overview_subtitle')}`} />

  // Échec du chargement initial : jamais un tableau de bord vide présenté comme
  // une année parfaite (0 occurrence, 0 $, « ✓ En dessous limite »).
  if (!curQ.data && curQ.isError) return (
    <>
      {header}{toolbar}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <i className="ti ti-alert-triangle text-3xl text-red-500" aria-hidden="true" />
        <div className="text-sm text-gray-700 dark:text-gray-300">{t('dashboard.load_error')}</div>
        <div className="text-xs text-gray-400 max-w-md break-words">{curQ.error?.message}</div>
        <button className="btn-primary text-sm" onClick={() => curQ.refetch()}>{t('dashboard.retry')}</button>
      </div>
    </>
  )
  if (!d) return (
    <>
      {header}{toolbar}
      <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
    </>
  )

  const { kpi, trends, months, sc, breakdowns, deptCompare, recent, comparison } = d
  const prevFY = filters.fy - 1
  const hasPrev = !!prevQ.data
  const cutoff = comparison.cutoff
  const vsLabel = cutoff ? t('dashboard.vs_to_date', { fy: prevFY }) : `vs FY${prevFY}`
  const noCmpTitle = comparison.reason === 'coverage'
    ? t('dashboard.no_comparison', { fy: prevFY })
    : t('dashboard.comparison_unavailable')
  const trendBadge = (tr, lowerIsBetter) => {
    if (!comparison.available) return { label: t('dashboard.no_trend'), neutral: true, title: noCmpTitle }
    if (!tr) return null
    const better = lowerIsBetter ? tr.pct <= 0 : tr.pct >= 0
    return { label: `${signedPct(tr.pct)} ${vsLabel}`, positive: better }
  }
  const completionBadge = trends.completionPts
    ? { label: `${trends.completionPts.pts >= 0 ? '+' : '−'}${Math.abs(Math.round(trends.completionPts.pts))} pts ${vsLabel}`,
        positive: trends.completionPts.pts >= 0 }
    : null

  const inPeriod = months.filter(m => m.inPeriod)
  const partialMonth = months.find(m => m.partial)
  const sparkEvents = inPeriod.map(m => m.events)
  const sparkCost   = inPeriod.map(m => Math.round(m.cost))
  const sparkDone   = inPeriod.map(m => m.done)
  const sparkScPct  = sc.months.map(m => m.pct)
  const eventsByMonthData = months.map(m => ({
    name: m.partial ? `${m.name}*` : m.name,
    current: m.events || null,
    prev: m.prevEvents || null,
  }))
  const scPctData = sc.months.map(m => ({ name: m.partial ? `${m.name}*` : m.name, pct: m.pct, prevPct: m.prevPct }))
  const coveredRange = sc.coveredMonths.length
    ? `${fmShort(sc.coveredMonths[0])}–${fmShort(sc.coveredMonths[sc.coveredMonths.length - 1])}` : ''

  const deptCostData = breakdowns.deptCost
  const plantCostData = breakdowns.plantCost
  const catData = breakdowns.categoryEvents
  const topClientsData = breakdowns.topCustomersEvents
  const topClientsCostData = breakdowns.topCustomersCost
  const statusData = breakdowns.status.map(s => ({ ...s, name: t(`status.${s.key}`) }))
  const brandSeries = breakdowns.brand.series
  const brandTrendData = breakdowns.brand.rows
  // Σ des départements = coût total exactement (aucun arrondi avant la somme).
  const deptPieTotal = deptCostData.reduce((s, x) => s + x.cost, 0)
  // Départements au net négatif (crédit > coûts) : sans surface dans le
  // camembert, nommés dans son sous-titre et le titre de l'export pour que les
  // parts dessinées et le total annoncé se réconcilient.
  const pieExcluded = deptCostData.filter(x => x.cost < 0)
  const pieExcludedNote = pieExcluded.length
    ? t('dashboard.pie_excluded', { list: pieExcluded.map(x => `${x.name} ${money(x.cost)}`).join(', ') }) : ''
  const partialNote = partialMonth ? t('dashboard.partial_month', { month: partialMonth.name, date: today }) : ''

  // Résumé des filtres actifs (sous-titres, export Excel) : un chiffre exporté
  // ou capturé doit dire sur quoi il porte.
  const optionLabel = (list, v) => (list.find(o => o.value === v) || {}).label || v
  const filterSummary = [
    filters.plant !== ALL && `${t('ticket.plant')} ${optionLabel(d.options.plants, filters.plant)}`,
    filters.brand !== ALL && `${t('ticket.brand')} ${optionLabel(d.options.brands, filters.brand)}`,
    filters.department !== ALL && `${t('ticket.department')} ${optionLabel(d.options.departments, filters.department)}`,
    filters.status !== ALL && t(`status.${filters.status}`),
  ].filter(Boolean).join(' · ')

  const deptHeight  = Math.max(220, deptCostData.length * 34)
  const plantHeight = Math.max(180, plantCostData.length * 34)
  const catHeight   = Math.max(180, catData.length * 34)

  // ── Dept-cost pie: always-on labels with collision-avoided leader lines ──
  // Geometry is fixed so the label y-positions can be de-collided up front, then
  // stacked down each side (Excel-style) instead of piling up near 12 o'clock.
  // Parts négatives (crédit > coûts) : sans surface dans un camembert, elles
  // restent dans le total et l'export mais ne sont pas dessinées.
  const pieData = deptCostData.filter(x => x.cost > 0)
  const PIE_H = 520, PIE_R = 140, PIE_MARGIN_Y = 12
  const PIE_CY = PIE_MARGIN_Y + (PIE_H - 2 * PIE_MARGIN_Y) / 2
  const pieInk = dark ? '#e6edf3' : '#111827'
  const pieLabelLayout = (() => {
    const RAD = Math.PI / 180
    const total = pieData.reduce((s, x) => s + x.cost, 0) || 1
    let acc = 0
    const items = pieData.map(x => {
      const a = -(90 - (acc + x.cost / total / 2) * 360) * RAD   // slice mid-angle (start 12 o'clock, clockwise)
      acc += x.cost / total
      const cos = Math.cos(a), sin = Math.sin(a)
      return { name: x.name, value: x.cost, cos, sin, side: cos >= 0 ? 1 : -1,
        idealY: PIE_CY + (PIE_R + 18) * sin, y: 0 }
    })
    const GAP = 15, MIN_Y = 12, MAX_Y = PIE_H - 12
    ;[-1, 1].forEach(side => {
      const arr = items.filter(it => it.side === side).sort((a, b) => a.idealY - b.idealY)
      let prev = -Infinity
      arr.forEach(it => { it.y = Math.max(it.idealY, prev + GAP); prev = it.y })       // push apart downward
      const over = arr.length ? arr[arr.length - 1].y - MAX_Y : 0
      if (over > 0) arr.forEach(it => { it.y -= over })                                // pull back if past bottom
      if (arr.length && arr[0].y < MIN_Y) { const dd = MIN_Y - arr[0].y; arr.forEach(it => { it.y += dd }) }
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
  // The chart SVG is rasterized to PNG, then embedded via buildXlsxWithImage.
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
        title: t('dashboard.export_title', {
          fy: filters.fy, filters: filterSummary ? ` — ${filterSummary}` : '', total: money(deptPieTotal),
        }) + (pieExcludedNote ? ` (${pieExcludedNote})` : ''),
        pngBase64, imgWidth: w, imgHeight: h,
      })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url; a.download = `${t('dashboard.export_file')}-FY${filters.fy}.xlsx`; a.click()
      URL.revokeObjectURL(url)
      toast.success(t('common.save'))
    } catch (e) {
      console.error(e)
      toast.error(t('common.error'))
    }
  }

  // SC % : verdict de tolérance seulement pour l'ensemble (ou une usine).
  const scSub = sc.ytdPct == null
    ? (sc.revenueAvailable ? t('dashboard.revenue_missing') : t('dashboard.revenue_unavailable'))
    : sc.verdict
      ? `${t('dashboard.tolerance')} ${TOLERANCE_PCT.toFixed(2)}% · ${coveredRange}`
      : t('dashboard.sc_filtered')
  const scUncovered = sc.ytdPct != null && Math.round(sc.uncoveredScCost) !== 0
    ? t('dashboard.sc_uncovered', { amount: money(sc.uncoveredScCost) }) : null
  const cmpRangeLabel = cmpFull ? '' : ` · ${fmShort(deptCmp.from)}–${fmShort(deptCmp.to)}`
  const cmpSubtitle = `FY${filters.fy} vs FY${prevFY}${cmpRangeLabel} · ${cutoff ? t('dashboard.to_date', { date: today }) : (cmpFull ? t('dashboard.full_year') : '')}`

  return (
    <>
      {header}
      {/* Sticky filter toolbar — lives outside the scroll area so it stays put while charts scroll */}
      {toolbar}

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon="ti-clipboard-list" iconBg="#EFF6FF" iconColor="#2563EB"
            label={t('dashboard.events')} value={kpi.events.toLocaleString()}
            sub={t('dashboard.events_kpi_sub', { occ: kpi.occurrences, open: kpi.open })}
            trend={trendBadge(trends.events, true)}
            spark={sparkEvents} sparkColor="#2563EB" />
          <StatCard icon="ti-currency-dollar" iconBg="#FFFBEB" iconColor="#D97706"
            label={t('dashboard.total_cost_label')} value={money(kpi.totalCost)}
            sub={`SC ${money(kpi.scCost)} (excl. ${SC_EXCLUDED_DEPT})`}
            sub2={kpi.uncosted ? t('dashboard.uncosted', { count: kpi.uncosted }) : null}
            trend={trendBadge(trends.cost, true)}
            spark={sparkCost} sparkColor="#D97706" />
          <StatCard icon="ti-chart-line"
            iconBg={!sc.verdict || sc.ytdPct == null ? '#F1F5F9' : sc.above ? '#FEF2F2' : '#F0FDF4'}
            iconColor={!sc.verdict || sc.ytdPct == null ? '#64748B' : sc.above ? '#DC2626' : '#16A34A'}
            label={t('dashboard.sc_cost_ytd')} value={sc.ytdPct != null ? `${sc.ytdPct.toFixed(2)}%` : '—'}
            sub={scSub} subColor="text-gray-400" sub2={scUncovered}
            trend={sc.verdict && sc.ytdPct != null ? { label: sc.above ? t('dashboard.above_limit') : t('dashboard.within_limit'), positive: !sc.above } : null}
            spark={sparkScPct.length > 1 ? sparkScPct : null} sparkColor={sc.verdict && sc.above ? '#DC2626' : '#16A34A'} />
          <StatCard icon="ti-circle-check" iconBg="#F0FDF4" iconColor="#16A34A"
            label={t('dashboard.completion_rate')} value={kpi.completionPct != null ? `${Math.round(kpi.completionPct)}%` : '—'}
            sub={`${kpi.completed} ${t('dashboard.completed')} / ${kpi.occurrences} occurrences`} subColor="text-green-500"
            trend={completionBadge}
            spark={sparkDone} sparkColor="#16A34A" />
        </div>

        {/* SC cost % + Status donut */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ChartCard icon="ti-chart-line" color="#2563EB"
              title={t('dashboard.sc_cost_chart')}
              subtitle={sc.verdict ? t('dashboard.sc_cost_subtitle') : t('dashboard.sc_filtered')}>
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
                    {sc.verdict && (
                      <ReferenceLine y={TOLERANCE_PCT} stroke="#EF4444" strokeDasharray="4 4"
                        label={{ value: `${TOLERANCE_PCT}%`, position: 'right', fontSize: 10, fill: '#EF4444' }} />
                    )}
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    {hasPrev && (
                      <Bar dataKey="prevPct" name={`FY${prevFY}`} fill={palePrev} radius={[5, 5, 0, 0]} maxBarSize={40}>
                        <LabelList dataKey="prevPct" position="top" offset={6} fontSize={9} fill={axisColor} formatter={pctLabel} />
                      </Bar>
                    )}
                    <Bar dataKey="pct" name={`FY${filters.fy}`} fill="#3B82F6" radius={[5, 5, 0, 0]} maxBarSize={40}>
                      {scPctData.map((entry, i) => <Cell key={i} fill={sc.verdict && entry.pct > TOLERANCE_PCT ? '#DC2626' : 'url(#gradSc)'} />)}
                      <LabelList dataKey="pct" position="top" offset={6} fontSize={9} fontWeight={700} fill={axisColor} formatter={pctLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 text-xs" style={{ height: 180 }}>
                  <i className="ti ti-chart-bar-off text-3xl mb-2 text-gray-300 dark:text-gray-600" aria-hidden="true" />
                  {sc.revenueAvailable ? t('dashboard.revenue_missing') : t('dashboard.revenue_unavailable')}
                </div>
              )}
            </ChartCard>
          </div>

          <ChartCard icon="ti-chart-donut" color="#8B5CF6" title={t('dashboard.status_distribution')}>
            {statusData.length ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                      {statusData.map(s => <Cell key={s.key} fill={STATUS_COLORS[s.key]} />)}
                    </Pie>
                    {tip()}
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-x-0 flex flex-col items-center pointer-events-none" style={{ top: 84 }}>
                  <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kpi.occurrences}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{t('dashboard.occurrences')}</span>
                </div>
              </div>
            ) : <NoData />}
          </ChartCard>
        </div>

        {/* Events by month + Brand trend — 2 per row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard icon="ti-calendar-stats" color="#2563EB"
          title={t('dashboard.events_chart')}
          subtitle={`${hasPrev ? t('dashboard.events_subtitle', { fy: filters.fy, prev: prevFY }) : t('dashboard.events_subtitle_single', { fy: filters.fy })}${partialNote ? ` · ${partialNote}` : ''}`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={eventsByMonthData} margin={{ top: 22 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={gridColor} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
              {tip()}
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {hasPrev && (
                <Bar dataKey="prev" name={`FY${prevFY}`} fill={palePrev} radius={[4, 4, 0, 0]} maxBarSize={30}>
                  <LabelList dataKey="prev" position="top" offset={6} fontSize={9} fill={axisColor} formatter={v => v || ''} />
                </Bar>
              )}
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
                {brandSeries.map((s, i) => (
                  <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name} stackId="a"
                    fill={s.dataKey === 'b_others' ? OTHERS_COLOR : BRAND_COLORS[i % BRAND_COLORS.length]} maxBarSize={46}
                    radius={i === brandSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                    {i === brandSeries.length - 1 && (
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

        {/* Top clients — by events + by cost */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard icon="ti-users" color="#0891B2" title={t('dashboard.top_clients')} subtitle={t('dashboard.top_clients_subtitle')}>
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
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} width={140} tickFormatter={s => truncate(s)} />
                  {tip()}
                  <Bar dataKey="count" name={t('dashboard.events')} fill="url(#gradCyan)" radius={[0, 5, 5, 0]} maxBarSize={24}
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
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} width={140} tickFormatter={s => truncate(s)} />
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
                  <Bar dataKey="count" name={t('dashboard.events')} fill="url(#gradBlue)" radius={[0, 5, 5, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartCard>

          <ChartCard icon="ti-chart-pie" color="#F59E0B"
          title={t('dashboard.by_department')}
          subtitle={`FY${filters.fy}${filterSummary ? ` · ${filterSummary}` : ''} · ${money(deptPieTotal)}${pieExcludedNote ? ` · ${pieExcludedNote}` : ''}`}
          right={pieData.length ? (
            <button onClick={exportDeptCosts}
              className="btn-ghost text-xs py-1 px-2.5 inline-flex items-center gap-1">
              <i className="ti ti-file-spreadsheet text-sm" aria-hidden="true" /> {t('dashboard.export_excel')}
            </button>
          ) : null}>
          {pieData.length ? (
            <div ref={deptPieRef}>
              <ResponsiveContainer width="100%" height={PIE_H}>
                <PieChart margin={{ top: PIE_MARGIN_Y, right: 120, bottom: PIE_MARGIN_Y, left: 120 }}>
                  <Pie data={pieData} dataKey="cost" nameKey="name" cx="50%" cy="50%"
                    outerRadius={PIE_R} paddingAngle={0} startAngle={90} endAngle={-270}
                    stroke={dark ? '#0D1117' : '#ffffff'} strokeWidth={1}
                    labelLine={false} label={renderPieLabel} isAnimationActive={false}>
                    {pieData.map((x, i) => <Cell key={x.key} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />)}
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
            subtitle={cmpSubtitle}
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
                  options={FISCAL_MONTH_ORDER.map(m => ({ value: String(m.fiscal), label: m.nameShort }))} />
                <span className="text-xs text-gray-400">–</span>
                <FilterSelect includeAll={false} highlight={deptCmp.to !== 12}
                  value={String(deptCmp.to)} onChange={setDeptCmpTo}
                  options={FISCAL_MONTH_ORDER.map(m => ({ value: String(m.fiscal), label: m.nameShort }))} />
              </div>
            }>
          {!deptCompare.available ? (
            <div className="text-xs text-gray-400 py-6 text-center">{noCmpTitle}</div>
          ) : deptCompare.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left font-medium py-2 pr-4">{t('ticket.department')}</th>
                    <th className="text-right font-medium py-2 px-4">{`FY${filters.fy}${cmpRangeLabel}`}</th>
                    <th className="text-right font-medium py-2 px-4">{`FY${prevFY}${cmpRangeLabel}${cutoff ? ` · ≤ ${cutoff}` : ''}`}</th>
                    <th className="text-right font-medium py-2 px-4">{t('dashboard.gap')}</th>
                    <th className="text-right font-medium py-2 pl-4">+/-%</th>
                  </tr>
                </thead>
                <tbody>
                  {deptCompare.rows.map(r => (
                    <tr key={r.key} className="border-b border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                      <td className="text-left py-2 pr-4">{r.name}</td>
                      <td className="text-right py-2 px-4 font-mono">{money(r.cur)}</td>
                      <td className="text-right py-2 px-4 font-mono text-gray-500 dark:text-gray-400">{money(r.prev)}</td>
                      <td className="text-right py-2 px-4 font-mono">{signedMoney(r.gap)}</td>
                      <td className="text-right py-2 pl-4 font-bold">{r.pct != null ? signedPct(r.pct) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-semibold">
                    <td className="text-left py-2 pr-4">{t('dashboard.total')}</td>
                    <td className="text-right py-2 px-4 font-mono">{money(deptCompare.totals.cur)}</td>
                    <td className="text-right py-2 px-4 font-mono">{money(deptCompare.totals.prev)}</td>
                    <td className="text-right py-2 px-4 font-mono">{signedMoney(deptCompare.totals.gap)}</td>
                    <td className="text-right py-2 pl-4 font-bold">{deptCompare.totals.pct != null ? signedPct(deptCompare.totals.pct) : '—'}</td>
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
                  {[t('ticket.sc_number'), t('dashboard.col_issue'), t('dashboard.col_client'), t('ticket.brand'),
                    t('ticket.department'), t('ticket.status'), t('ticket.cost')].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">{t('dashboard.no_data')}</td></tr>
                )}
                {recent.map(r => (
                  <tr key={r.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                    onClick={() => navigate(`/tickets/${r.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{r.ticket.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">{r.ticket.quality_issue}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-32 truncate">{r.customer || '—'}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={r.ticket.brand} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.depts.map(dep => (
                          <span key={dep} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full whitespace-nowrap">{dep}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-gray-100">
                      {r.cost != null ? money(r.cost) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </>
  )
}
