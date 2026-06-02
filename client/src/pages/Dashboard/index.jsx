import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, Cell
} from 'recharts'
import { ticketApi, calcKpis, FISCAL_MONTH_ORDER, CURRENT_FISCAL_YEAR } from '../../services/api'
import { supabase } from '../../services/supabase'
import { KpiCard, StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'

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

export default function Dashboard() {
  const { t }    = useTranslation()
  const navigate = useNavigate()

  const { data: currentYearTickets, isLoading: loadingCurrent } = useQuery({
    queryKey: ['tickets', 'dashboard', CURRENT_FISCAL_YEAR],
    queryFn: () => ticketApi.list({ fiscal_year: CURRENT_FISCAL_YEAR }).then(r => r.data.tickets),
    staleTime: 5 * 60 * 1000,
  })

  const { data: prevYearTickets, isLoading: loadingPrev } = useQuery({
    queryKey: ['tickets', 'dashboard', CURRENT_FISCAL_YEAR - 1],
    queryFn: () => ticketApi.list({ fiscal_year: CURRENT_FISCAL_YEAR - 1 }).then(r => r.data.tickets),
    staleTime: 5 * 60 * 1000,
  })

  const tickets     = currentYearTickets || []
  const prevTickets = prevYearTickets    || []

  const { data: lineCosts } = useQuery({
    queryKey: ['line-costs-dashboard', tickets.map(t => t.id).join(',')],
    queryFn: async () => {
      if (!tickets.length) return {}
      const { data: lines } = await supabase
        .from('occurrence_lines')
        .select('occurrence_id, cost_approx, plant, department, categories')
        .in('occurrence_id', tickets.map(t => t.id))
      if (!lines) return {}
      const costs = {}
      lines.forEach(l => {
        if (!costs[l.occurrence_id]) costs[l.occurrence_id] = { total: 0, lines: [] }
        costs[l.occurrence_id].total += Number(l.cost_approx || 0)
        costs[l.occurrence_id].lines.push(l)
      })
      return costs
    },
    enabled: tickets.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const getTicketCost = (tk) => {
    const lc = lineCosts?.[tk.id]
    if (lc && lc.total > 0) return lc.total
    return Number(tk.cost_approx || 0)
  }

  const isLoading = loadingCurrent || loadingPrev

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  )

  // ── KPIs ──────────────────────────────────────────────────
  const totalCost = tickets.reduce((s, tk) => s + getTicketCost(tk), 0)
  const scCost    = tickets
    .filter(tk => tk.department !== 'Client')
    .reduce((s, tk) => s + getTicketCost(tk), 0)
  const open      = tickets.filter(tk => !['completed','cancelled'].includes(tk.status)).length
  const completed = tickets.filter(tk => tk.status === 'completed').length
  const completionPct = tickets.length > 0 ? Math.round(completed / tickets.length * 100) : 0

  const prevTotalCost = prevTickets.reduce((s, tk) => s + Number(tk.cost_approx || 0), 0)
  const prevCompletionPct = prevTickets.length > 0
    ? Math.round(prevTickets.filter(tk => tk.status === 'completed').length / prevTickets.length * 100) : 0

  function ticketTrend() {
    if (!prevTickets.length) return null
    const diff = tickets.length - prevTickets.length
    const pct  = Math.round(Math.abs(diff) / prevTickets.length * 100)
    return { label: `${diff >= 0 ? '+' : '−'}${pct}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff <= 0 }
  }
  function costTrend() {
    if (!prevTotalCost) return null
    const diff = totalCost - prevTotalCost
    const pct  = Math.round(Math.abs(diff) / prevTotalCost * 100)
    return { label: `${diff >= 0 ? '+' : '−'}${pct}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff <= 0 }
  }
  function completionTrend() {
    if (!prevCompletionPct) return null
    const diff = completionPct - prevCompletionPct
    return { label: `${diff >= 0 ? '+' : '−'}${Math.abs(diff)}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff >= 0 }
  }

  const ytdRevenue     = Object.values(MONTHLY_REVENUE).reduce((s, v) => s + v, 0)
  const ytdPct         = ytdRevenue > 0 ? scCost / ytdRevenue * 100 : 0
  const aboveTolerance = ytdPct > 0.3

  // ── SC Cost % chart ────────────────────────────────────────
  const scPctData = FISCAL_MONTH_ORDER.map(({ fiscal, name, nameShort }) => {
    const monthTickets = tickets.filter(t => t.fiscal_month === fiscal)
    const scCostMonth  = monthTickets
      .filter(t => t.department !== 'Client')
      .reduce((sum, t) => sum + getTicketCost(t), 0)
    const revenue = MONTHLY_REVENUE[name] || 0
    const pct     = revenue > 0 ? scCostMonth / revenue * 100 : null
    return { name: nameShort, pct: pct !== null ? +pct.toFixed(3) : null, tolerance: TOLERANCE_PCT * 100 }
  }).filter(d => d.pct !== null)

  // ── Events by month ────────────────────────────────────────
  const eventsByMonthData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => ({
    name:   nameShort,
    fy2026: tickets.filter(t => t.fiscal_month === fiscal).length || null,
    fy2025: prevTickets.filter(t => t.fiscal_month === fiscal).length || null,
  }))

  // ── Cost by department — sem limite, todos os departamentos ─
  const deptCostMap = {}
  if (lineCosts) {
    Object.values(lineCosts).forEach(({ lines }) => {
      lines.forEach(l => {
        if (l.department && l.cost_approx > 0) {
          deptCostMap[l.department] = (deptCostMap[l.department] || 0) + Number(l.cost_approx)
        }
      })
    })
  }
  // Fallback para tickets sem linhas
  tickets.filter(tk => !lineCosts?.[tk.id] && tk.department && tk.cost_approx > 0).forEach(tk => {
    deptCostMap[tk.department] = (deptCostMap[tk.department] || 0) + Number(tk.cost_approx)
  })
  const deptCostData = Object.entries(deptCostMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  // ── Cost by plant — altura dinâmica ────────────────────────
  const plantCostMap = {}
  if (lineCosts) {
    Object.values(lineCosts).forEach(({ lines }) => {
      lines.forEach(l => {
        if (l.plant && l.cost_approx > 0) {
          plantCostMap[l.plant] = (plantCostMap[l.plant] || 0) + Number(l.cost_approx)
        }
      })
    })
  }
  tickets.filter(tk => !lineCosts?.[tk.id] && tk.plant && tk.cost_approx > 0).forEach(tk => {
    plantCostMap[tk.plant] = (plantCostMap[tk.plant] || 0) + Number(tk.cost_approx)
  })
  const plantCostData = Object.entries(plantCostMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  // ── Categories — do ticket (sem limite) ────────────────────
  const catMap = {}
  tickets.forEach(tk => {
    if (tk.categories) catMap[tk.categories] = (catMap[tk.categories] || 0) + 1
  })
  const catData = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  // ── Brand trend ────────────────────────────────────────────
  const brands = [...new Set(tickets.map(t => t.brand).filter(Boolean))].sort()
  const brandTrendData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const row = { name: nameShort }
    brands.forEach(b => { row[b] = tickets.filter(t => t.fiscal_month === fiscal && t.brand === b).length || null })
    return row
  }).filter(row => brands.some(b => row[b]))

  // ── Top 10 clients ─────────────────────────────────────────
  const clientMap = {}
  tickets.filter(t => t.ship_to).forEach(t => {
    const key = t.ship_to.length > 28 ? t.ship_to.slice(0, 28) + '…' : t.ship_to
    clientMap[key] = (clientMap[key] || 0) + 1
  })
  const topClientsData = Object.entries(clientMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Alturas dinâmicas
  const deptHeight   = Math.max(240, deptCostData.length * 36)
  const plantHeight  = Math.max(200, plantCostData.length * 36)
  const catHeight    = Math.max(200, catData.length * 36)

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle={`FY${CURRENT_FISCAL_YEAR} — Vue d'ensemble qualité & coûts`} />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label={`Occurrences FY${CURRENT_FISCAL_YEAR}`} value={tickets.length}
            icon="ti-clipboard-list" iconBg="#EFF6FF" iconColor="#2563EB"
            trend={ticketTrend()} sub={`${open} ouvertes`} />
          <KpiCard label={`Total Cost FY${CURRENT_FISCAL_YEAR}`} value={`$${Math.round(totalCost).toLocaleString()}`}
            icon="ti-currency-dollar" iconBg="#FFFBEB" iconColor="#D97706"
            trend={costTrend()} sub={`SC $${Math.round(scCost).toLocaleString()} (excl. Client)`} />
          <KpiCard label="SC Cost % YTD" value={`${ytdPct.toFixed(2)}%`}
            icon="ti-chart-line"
            iconBg={aboveTolerance ? "#FEF2F2" : "#F0FDF4"}
            iconColor={aboveTolerance ? "#DC2626" : "#16A34A"}
            trend={{ label: aboveTolerance ? '⚠ Above limit' : '✓ Within limit', positive: !aboveTolerance }}
            sub="Tolerance 0.30%" subColor="text-gray-400" />
          <KpiCard label={t('dashboard.completion_rate')} value={`${completionPct}%`}
            icon="ti-circle-check" iconBg="#F0FDF4" iconColor="#16A34A"
            trend={completionTrend()} sub={`${completed} complétées`} subColor="text-green-500" />
        </div>

        {/* SC Cost % */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">SC Cost % of Revenue — FY{CURRENT_FISCAL_YEAR}</div>
          <div className="text-xs text-gray-400 mb-4">SC cost (excl. Client) / monthly revenue · red line = 0.30% tolerance</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={scPctData} margin={{ top: 10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <Tooltip formatter={(v, name) => name === 'pct' ? [`${v.toFixed(3)}%`, 'SC Cost %'] : [`${v}%`, 'Tolerance']} />
              <ReferenceLine y={TOLERANCE_PCT * 100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: '0.3%', position: 'right', fontSize: 10, fill: '#EF4444' }} />
              <Bar dataKey="pct" name="pct" radius={[4, 4, 0, 0]}>
                {scPctData.map((entry, i) => <Cell key={i} fill={entry.pct > 0.3 ? '#DC2626' : '#2563EB'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Events by month */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Events by fiscal month — FY{CURRENT_FISCAL_YEAR} vs FY{CURRENT_FISCAL_YEAR - 1}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={eventsByMonthData} margin={{ top: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip /><Legend />
              <Bar dataKey="fy2026" name={`FY${CURRENT_FISCAL_YEAR}`}     fill="#2563EB" radius={[3,3,0,0]} />
              <Bar dataKey="fy2025" name={`FY${CURRENT_FISCAL_YEAR - 1}`} fill="#93C5FD" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Brand trend */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Occurrences by brand — FY{CURRENT_FISCAL_YEAR}</div>
          <div className="text-xs text-gray-400 mb-4">Number of occurrences per brand per fiscal month</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={brandTrendData} margin={{ top: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip /><Legend />
              {brands.map((brand, i) => (
                <Bar key={brand} dataKey={brand} stackId="a" fill={BRAND_COLORS[i % BRAND_COLORS.length]}
                  radius={i === brands.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Dept + Plant */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t('dashboard.by_department')} — Cost FY{CURRENT_FISCAL_YEAR}
              <span className="ml-2 text-xs font-normal text-gray-400">({deptCostData.length} départements)</span>
            </div>
            <ResponsiveContainer width="100%" height={deptHeight}>
              <BarChart data={deptCostData} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#F59E0B" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Cost by plant — FY{CURRENT_FISCAL_YEAR}
              <span className="ml-2 text-xs font-normal text-gray-400">({plantCostData.length} usines)</span>
            </div>
            <ResponsiveContainer width="100%" height={plantHeight}>
              <BarChart data={plantCostData} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#7C3AED" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category + Top clients */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t('dashboard.by_category')} — FY{CURRENT_FISCAL_YEAR}
              <span className="ml-2 text-xs font-normal text-gray-400">({catData.length} catégories)</span>
            </div>
            <ResponsiveContainer width="100%" height={catHeight}>
              <BarChart data={catData} layout="vertical" margin={{ left: 110 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563EB" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Top 10 clients — FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={Math.max(240, topClientsData.length * 36)}>
              <BarChart data={topClientsData} layout="vertical" margin={{ left: 140 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={140} />
                <Tooltip />
                <Bar dataKey="count" fill="#0891B2" radius={[0,4,4,0]}
                  label={{ position:'right', fontSize:10, fill:'#6B7280' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
                  {['SC#', 'Issue', 'Ship To', 'Brand', 'Dept.', 'Status', 'Cost'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.slice(0, 8).map(tk => {
                  const cost = getTicketCost(tk)
                  return (
                    <tr key={tk.id}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                      onClick={() => navigate(`/tickets/${tk.id}`)}>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{tk.sc_number || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">{tk.quality_issue}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-32 truncate">{tk.ship_to}</td>
                      <td className="px-4 py-2.5"><BrandTag brand={tk.brand} /></td>
                      <td className="px-4 py-2.5"><span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">{tk.department}</span></td>
                      <td className="px-4 py-2.5"><StatusBadge status={tk.status} /></td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-900 dark:text-gray-100">
                        {cost > 0 ? `$${Math.round(cost).toLocaleString()}` : '—'}
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
