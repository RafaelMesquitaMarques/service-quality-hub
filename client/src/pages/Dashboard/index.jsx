import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell, CartesianGrid,
} from 'recharts'
import { ticketApi, FISCAL_MONTH_ORDER, CURRENT_FISCAL_YEAR } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'
import { useThemeStore } from '../../store/themeStore'

const MONTHLY_REVENUE = {
  December:  9998777,
  January:   11129308,
  February:  10260000,
  March:     13754000,
  April:     14690997,
  May:       11000000,
}

const TOLERANCE_PCT = 0.003
const BRAND_COLORS  = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA']
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

  const [filters, setFilters] = useState({
    fy: CURRENT_FISCAL_YEAR, department: 'all', brand: 'all', plant: 'all', status: 'all',
  })
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const resetFilters = () => setFilters(f => ({ fy: f.fy, department: 'all', brand: 'all', plant: 'all', status: 'all' }))

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

  if (loadingCurrent && !currentYearTickets) return (
    <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  )

  const rawTickets = currentYearTickets || []
  const rawPrev    = prevYearTickets    || []

  // Filter option lists (from the unfiltered year so they never disappear)
  const uniq = (arr, key) => [...new Set(arr.map(t => t[key]).filter(Boolean))].sort()
  const deptOptions   = uniq(rawTickets, 'department')
  const brandOptions  = uniq(rawTickets, 'brand')
  const plantOptions  = uniq(rawTickets, 'plant')
  const statusOptions = STATUS_ORDER.filter(s => rawTickets.some(t => t.status === s))

  const match = (tk) =>
    (filters.department === 'all' || tk.department === filters.department) &&
    (filters.brand      === 'all' || tk.brand      === filters.brand) &&
    (filters.plant      === 'all' || tk.plant      === filters.plant) &&
    (filters.status     === 'all' || tk.status     === filters.status)

  const tickets     = rawTickets.filter(match)
  const prevTickets = rawPrev.filter(match)
  const activeCount = ['department', 'brand', 'plant', 'status'].filter(k => filters[k] !== 'all').length

  const getTicketCost = (tk) => Number(tk.real_cost || tk.cost_approx || 0)
  const revenueAvailable = filters.fy === CURRENT_FISCAL_YEAR

  // ── KPIs ───────────────────────────────────────────────────
  const totalCost = tickets.reduce((s, tk) => s + getTicketCost(tk), 0)
  const scCost    = tickets.filter(tk => tk.department !== 'Client').reduce((s, tk) => s + getTicketCost(tk), 0)
  const open      = tickets.filter(tk => !['completed', 'cancelled'].includes(tk.status)).length
  const completed = tickets.filter(tk => tk.status === 'completed').length
  const completionPct = tickets.length > 0 ? Math.round(completed / tickets.length * 100) : 0

  const prevTotalCost = prevTickets.reduce((s, tk) => s + getTicketCost(tk), 0)
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

  const ytdRevenue     = revenueAvailable ? Object.values(MONTHLY_REVENUE).reduce((s, v) => s + v, 0) : 0
  const ytdPct         = ytdRevenue > 0 ? scCost / ytdRevenue * 100 : null
  const aboveTolerance = ytdPct != null && ytdPct > 0.3

  // ── Per-month series (charts + sparklines) ─────────────────
  const monthCount = fiscal => tickets.filter(t => t.fiscal_month === fiscal).length
  const monthCost  = fiscal => tickets.filter(t => t.fiscal_month === fiscal).reduce((s, t) => s + getTicketCost(t), 0)
  const monthDone  = fiscal => tickets.filter(t => t.fiscal_month === fiscal && t.status === 'completed').length

  const sparkCounts = FISCAL_MONTH_ORDER.map(m => monthCount(m.fiscal))
  const sparkCost   = FISCAL_MONTH_ORDER.map(m => Math.round(monthCost(m.fiscal)))
  const sparkDone   = FISCAL_MONTH_ORDER.map(m => monthDone(m.fiscal))

  const scPctData = FISCAL_MONTH_ORDER.map(({ fiscal, name, nameShort }) => {
    const scCostMonth = tickets.filter(t => t.fiscal_month === fiscal && t.department !== 'Client')
      .reduce((sum, t) => sum + getTicketCost(t), 0)
    const revenue = revenueAvailable ? (MONTHLY_REVENUE[name] || 0) : 0
    const pct     = revenue > 0 ? scCostMonth / revenue * 100 : null
    return { name: nameShort, pct: pct !== null ? +pct.toFixed(3) : null }
  }).filter(d => d.pct !== null)
  const sparkScPct = scPctData.map(d => d.pct)

  const eventsByMonthData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => ({
    name:    nameShort,
    current: tickets.filter(t => t.fiscal_month === fiscal).length || null,
    prev:    prevTickets.filter(t => t.fiscal_month === fiscal).length || null,
  }))

  const byCount = (map) => Object.entries(map).sort((a, b) => b[1] - a[1])
  const deptCostMap = {}, plantCostMap = {}, catMap = {}, clientMap = {}
  tickets.forEach(tk => {
    const cost = getTicketCost(tk)
    if (tk.department && cost > 0) deptCostMap[tk.department]   = (deptCostMap[tk.department] || 0) + cost
    if (tk.plant && cost > 0)      plantCostMap[tk.plant]       = (plantCostMap[tk.plant] || 0) + cost
    if (tk.categories)             catMap[tk.categories]        = (catMap[tk.categories] || 0) + 1
    if (tk.ship_to) {
      const key = tk.ship_to.length > 28 ? tk.ship_to.slice(0, 28) + '…' : tk.ship_to
      clientMap[key] = (clientMap[key] || 0) + 1
    }
  })
  const deptCostData  = byCount(deptCostMap).map(([name, cost]) => ({ name, cost: Math.round(cost) }))
  const plantCostData = byCount(plantCostMap).map(([name, cost]) => ({ name, cost: Math.round(cost) }))
  const catData       = byCount(catMap).map(([name, count]) => ({ name, count }))
  const topClientsData = byCount(clientMap).slice(0, 10).map(([name, count]) => ({ name, count }))

  const brands = brandOptions
  const brandTrendData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const row = { name: nameShort }
    brands.forEach(b => { row[b] = tickets.filter(t => t.fiscal_month === fiscal && t.brand === b).length || null })
    return row
  }).filter(row => brands.some(b => row[b]))

  const statusData = STATUS_ORDER
    .map(key => ({ key, name: t(`status.${key}`), value: tickets.filter(t => t.status === key).length }))
    .filter(d => d.value > 0)

  // chart helpers
  const axisColor = dark ? '#94A3B8' : '#64748B'
  const gridColor = dark ? '#1F2937' : '#EEF2F7'
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
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Filters */}
        <div className="card p-3 flex items-center gap-2 flex-wrap">
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
                  <BarChart data={scPctData} margin={{ top: 10 }}>
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
                    <Bar dataKey="pct" name="SC Cost %" radius={[5, 5, 0, 0]} maxBarSize={46}>
                      {scPctData.map((entry, i) => <Cell key={i} fill={entry.pct > 0.3 ? '#DC2626' : 'url(#gradSc)'} />)}
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

        {/* Events by month (area) */}
        <ChartCard icon="ti-calendar-stats" color="#2563EB"
          title={t('dashboard.events_chart')} subtitle={`FY${filters.fy} vs FY${filters.fy - 1}`}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={eventsByMonthData} margin={{ top: 5 }}>
              <defs>
                <linearGradient id="gradCur" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPrev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#94A3B8" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#94A3B8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={gridColor} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
              {tip()}
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="prev" name={`FY${filters.fy - 1}`} stroke="#94A3B8" strokeWidth={2}
                fill="url(#gradPrev)" connectNulls dot={false} />
              <Area type="monotone" dataKey="current" name={`FY${filters.fy}`} stroke="#2563EB" strokeWidth={2.5}
                fill="url(#gradCur)" connectNulls dot={{ r: 3, fill: '#2563EB' }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Brand trend */}
        <ChartCard icon="ti-tag" color="#7C3AED"
          title={t('dashboard.tickets_by_brand')} subtitle={t('dashboard.tickets_by_brand_subtitle')}>
          {brandTrendData.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={brandTrendData} margin={{ top: 5 }}>
                <CartesianGrid vertical={false} stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                {tip()}
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {brands.map((brand, i) => (
                  <Bar key={brand} dataKey={brand} stackId="a" fill={BRAND_COLORS[i % BRAND_COLORS.length]} maxBarSize={46}
                    radius={i === brands.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : <NoData />}
        </ChartCard>

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

        {/* Category + Top clients */}
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
