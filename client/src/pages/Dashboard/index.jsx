import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, Cell
} from 'recharts'
import { ticketApi, calcKpis, FISCAL_MONTH_ORDER, CURRENT_FISCAL_YEAR } from '../../services/api'
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

const BRAND_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#D97706', '#DC2626', '#059669', '#DB2777', '#9333EA']

export default function Dashboard() {
  const { t } = useTranslation()
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

  const isLoading = loadingCurrent || loadingPrev

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  const tickets     = currentYearTickets || []
  const prevTickets = prevYearTickets    || []
  const kpis        = calcKpis(tickets)
  const prevKpis    = calcKpis(prevTickets)

  // ── Trend helpers ──────────────────────────────────────────
  function ticketTrend() {
    if (!prevTickets.length) return null
    const diff = tickets.length - prevTickets.length
    const pct  = Math.round(Math.abs(diff) / prevTickets.length * 100)
    return { label: `${diff >= 0 ? '+' : '−'}${pct}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff <= 0 }
  }

  function costTrend() {
    if (!prevKpis.totalCost) return null
    const diff = kpis.totalCost - prevKpis.totalCost
    const pct  = Math.round(Math.abs(diff) / prevKpis.totalCost * 100)
    return { label: `${diff >= 0 ? '+' : '−'}${pct}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff <= 0 }
  }

  function completionTrend() {
    if (!prevKpis.completionPct) return null
    const diff = kpis.completionPct - prevKpis.completionPct
    return { label: `${diff >= 0 ? '+' : '−'}${Math.abs(diff)}% vs FY${CURRENT_FISCAL_YEAR - 1}`, positive: diff >= 0 }
  }

  // ── Chart data ─────────────────────────────────────────────
  const scPctData = FISCAL_MONTH_ORDER.map(({ fiscal, name, nameShort }) => {
    const monthTickets = tickets.filter(t => t.fiscal_month === fiscal)
    const scCost = monthTickets
      .filter(t => t.department !== 'Client' && t.cost_approx > 0)
      .reduce((sum, t) => sum + Number(t.cost_approx), 0)
    const revenue = MONTHLY_REVENUE[name] || 0
    const pct = revenue > 0 ? scCost / revenue * 100 : null
    return { name: nameShort, pct: pct !== null ? +pct.toFixed(3) : null, tolerance: TOLERANCE_PCT * 100 }
  }).filter(d => d.pct !== null)

  const eventsByMonthData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const fy2026 = tickets.filter(t => t.fiscal_month === fiscal).length
    const fy2025 = prevTickets.filter(t => t.fiscal_month === fiscal).length
    return { name: nameShort, fy2026: fy2026 || null, fy2025: fy2025 || null }
  })

  const deptCostData = Object.entries(kpis.costByDepartment)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  const catData = Object.entries(kpis.byCategory)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, count]) => ({ name, count }))

  // ── NEW: Brand trend (tickets by brand per fiscal month) ───
  const brands = [...new Set(tickets.map(t => t.brand).filter(Boolean))].sort()
  const brandTrendData = FISCAL_MONTH_ORDER.map(({ fiscal, nameShort }) => {
    const row = { name: nameShort }
    brands.forEach(b => {
      row[b] = tickets.filter(t => t.fiscal_month === fiscal && t.brand === b).length || null
    })
    return row
  }).filter(row => brands.some(b => row[b]))

  // ── NEW: Cost by plant ─────────────────────────────────────
  const plantCostMap = {}
  tickets.filter(t => t.plant && t.cost_approx > 0).forEach(t => {
    plantCostMap[t.plant] = (plantCostMap[t.plant] || 0) + Number(t.cost_approx)
  })
  const plantCostData = Object.entries(plantCostMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  // ── NEW: Top 10 clients by ticket count ───────────────────
  const clientMap = {}
  tickets.filter(t => t.ship_to).forEach(t => {
    const key = t.ship_to.length > 28 ? t.ship_to.slice(0, 28) + '…' : t.ship_to
    clientMap[key] = (clientMap[key] || 0) + 1
  })
  const topClientsData = Object.entries(clientMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const ytdRevenue     = Object.values(MONTHLY_REVENUE).reduce((s, v) => s + v, 0)
  const ytdPct         = ytdRevenue > 0 ? kpis.scCost / ytdRevenue * 100 : 0
  const aboveTolerance = ytdPct > 0.3

  return (
    <>
      <PageHeader
        title={t('nav.dashboard')}
        subtitle={`FY${CURRENT_FISCAL_YEAR} — Vue d'ensemble qualité & coûts`}
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={`Tickets FY${CURRENT_FISCAL_YEAR}`}
            value={tickets.length}
            icon="ti-clipboard-list"
            iconBg="#EFF6FF"
            iconColor="#2563EB"
            trend={ticketTrend()}
            sub={`${kpis.open} open`}
          />
          <KpiCard
            label={`Total Cost FY${CURRENT_FISCAL_YEAR}`}
            value={`$${Math.round(kpis.totalCost).toLocaleString()}`}
            icon="ti-currency-dollar"
            iconBg="#FFFBEB"
            iconColor="#D97706"
            trend={costTrend()}
            sub={`SC $${Math.round(kpis.scCost).toLocaleString()} (excl. Client)`}
          />
          <KpiCard
            label="SC Cost % YTD"
            value={`${ytdPct.toFixed(2)}%`}
            icon="ti-chart-line"
            iconBg={aboveTolerance ? "#FEF2F2" : "#F0FDF4"}
            iconColor={aboveTolerance ? "#DC2626" : "#16A34A"}
            trend={{ label: aboveTolerance ? '⚠ Above limit' : '✓ Within limit', positive: !aboveTolerance }}
            sub="Tolerance 0.30%"
            subColor="text-gray-400"
          />
          <KpiCard
            label={t('dashboard.completion_rate')}
            value={`${kpis.completionPct}%`}
            icon="ti-circle-check"
            iconBg="#F0FDF4"
            iconColor="#16A34A"
            trend={completionTrend()}
            sub={`${kpis.completed} completed`}
            subColor="text-green-500"
          />
        </div>

        {/* ── SC Cost % chart ── */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 mb-1">SC Cost % of Revenue — FY{CURRENT_FISCAL_YEAR}</div>
          <div className="text-xs text-gray-400 mb-4">SC cost (excl. Client) / monthly revenue · red line = 0.30% tolerance</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={scPctData} margin={{ top: 10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <Tooltip formatter={(v, name) => name === 'pct' ? [`${v.toFixed(3)}%`, 'SC Cost %'] : [`${v}%`, 'Tolerance']} />
              <ReferenceLine y={TOLERANCE_PCT * 100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: '0.3%', position: 'right', fontSize: 10, fill: '#EF4444' }} />
              <Bar dataKey="pct" name="pct" radius={[4, 4, 0, 0]}
                label={{ position: 'top', formatter: v => v > 0.5 ? `${v.toFixed(1)}%` : '', fontSize: 10, fill: '#374151' }}
              >
                {scPctData.map((entry, i) => (
                  <Cell key={i} fill={entry.pct > 0.3 ? '#DC2626' : '#2563EB'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Events by month ── */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 mb-4">
            Events by fiscal month — FY{CURRENT_FISCAL_YEAR} vs FY{CURRENT_FISCAL_YEAR - 1}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={eventsByMonthData} margin={{ top: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="fy2026" name={`FY${CURRENT_FISCAL_YEAR}`}     fill="#2563EB" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fy2025" name={`FY${CURRENT_FISCAL_YEAR - 1}`} fill="#93C5FD" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── NEW: Brand trend by fiscal month ── */}
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 mb-1">Tickets by brand — FY{CURRENT_FISCAL_YEAR}</div>
          <div className="text-xs text-gray-400 mb-4">Number of tickets per brand per fiscal month</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={brandTrendData} margin={{ top: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {brands.map((brand, i) => (
                <Bar key={brand} dataKey={brand} stackId="a" fill={BRAND_COLORS[i % BRAND_COLORS.length]} radius={i === brands.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Cost by dept + by plant ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">{t('dashboard.by_department')} — Cost FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={deptCostData} layout="vertical" margin={{ left: 70 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#F59E0B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── NEW: Cost by plant ── */}
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">Cost by plant — FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={plantCostData} layout="vertical" margin={{ left: 50 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={50} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#7C3AED" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── By category + Top 10 clients ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">{t('dashboard.by_category')} — FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={catData} layout="vertical" margin={{ left: 100 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── NEW: Top 10 clients ── */}
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">Top 10 clients — FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topClientsData} layout="vertical" margin={{ left: 140 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={140} />
                <Tooltip />
                <Bar dataKey="count" fill="#0891B2" radius={[0, 4, 4, 0]}
                  label={{ position: 'right', fontSize: 10, fill: '#6B7280' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Recent tickets ── */}
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold">{t('dashboard.recent')}</div>
            <button className="btn-ghost text-xs" onClick={() => navigate('/tickets')}>
              {t('dashboard.see_all')} <i className="ti ti-arrow-right" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['SC#', 'Issue', 'Ship To', 'Brand', 'Dept.', 'Status', 'Cost'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.slice(0, 8).map(tk => (
                  <tr key={tk.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/tickets/${tk.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{tk.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-sm max-w-xs truncate">{tk.quality_issue}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-32 truncate">{tk.ship_to}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={tk.brand} /></td>
                    <td className="px-4 py-2.5"><span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{tk.department}</span></td>
                    <td className="px-4 py-2.5"><StatusBadge status={tk.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{tk.cost_approx ? `$${Number(tk.cost_approx).toLocaleString()}` : '—'}</td>
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
