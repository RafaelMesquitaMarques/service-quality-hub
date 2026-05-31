import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, ReferenceLine
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

  const scPctData = FISCAL_MONTH_ORDER.map(({ fiscal, name, nameShort }) => {
    const monthTickets = tickets.filter(t => t.fiscal_month === fiscal)
    const scCost = monthTickets
      .filter(t => t.department !== 'Client' && t.cost_approx > 0)
      .reduce((sum, t) => sum + Number(t.cost_approx), 0)
    const revenue = MONTHLY_REVENUE[name] || 0
    const pct = revenue > 0 ? scCost / revenue * 100 : null
    return { name: nameShort, pct: pct !== null ? +pct.toFixed(3) : null, tolerance: TOLERANCE_PCT * 100, events: monthTickets.length }
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

  const ytdRevenue = Object.values(MONTHLY_REVENUE).reduce((s, v) => s + v, 0)
  const ytdPct     = ytdRevenue > 0 ? kpis.scCost / ytdRevenue * 100 : 0

  return (
    <>
      <PageHeader
        title={t('nav.dashboard')}
        subtitle={`FY${CURRENT_FISCAL_YEAR} — Vue d'ensemble qualité & coûts`}
      />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={`Tickets FY${CURRENT_FISCAL_YEAR}`}
            value={tickets.length}
            icon="ti-clipboard-list" iconBg="bg-blue-50 text-blue-600"
            sub={`${kpis.open} ouverts`}
          />
          <KpiCard
            label={t('dashboard.total_cost')}
            value={`$${Math.round(kpis.totalCost).toLocaleString()}`}
            icon="ti-currency-dollar" iconBg="bg-amber-50 text-amber-600"
            sub={`SC Cost $${Math.round(kpis.scCost).toLocaleString()} (excl. Client)`}
          />
          <KpiCard
            label="SC Cost % YTD"
            value={`${ytdPct.toFixed(2)}%`}
            icon="ti-chart-line" iconBg={ytdPct > 0.3 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}
            sub={`Tolérance 0.30% · ${ytdPct > 0.3 ? '⚠ Au-dessus' : '✓ En dessous'}`}
            subColor={ytdPct > 0.3 ? "text-red-500" : "text-green-500"}
          />
          <KpiCard
            label={t('dashboard.completion_rate')}
            value={`${kpis.completionPct}%`}
            icon="ti-circle-check" iconBg="bg-green-50 text-green-600"
            sub={`${kpis.completed} complétés`} subColor="text-green-500"
          />
        </div>

        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 mb-1">SC Cost % of Revenue — FY{CURRENT_FISCAL_YEAR}</div>
          <div className="text-xs text-gray-400 mb-4">Coût SC (excl. Client) / Revenus mensuels · Ligne rouge = tolérance 0.30%</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={scPctData} margin={{ top: 10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <Tooltip formatter={(v, name) => name === 'pct' ? [`${v.toFixed(3)}%`, 'SC Cost %'] : [`${v}%`, 'Tolérance']} />
              <ReferenceLine y={TOLERANCE_PCT * 100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: '0.3%', position: 'right', fontSize: 10, fill: '#EF4444' }} />
              <Bar dataKey="pct" name="pct" fill="#2563EB" radius={[4, 4, 0, 0]}
                label={{ position: 'top', formatter: v => v > 0.5 ? `${v.toFixed(1)}%` : '', fontSize: 10, fill: '#374151' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-900 mb-4">
            Événements par mois fiscal — FY{CURRENT_FISCAL_YEAR} vs FY{CURRENT_FISCAL_YEAR - 1}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={eventsByMonthData} margin={{ top: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="fy2026" name={`FY${CURRENT_FISCAL_YEAR}`}   fill="#2563EB" radius={[3, 3, 0, 0]} />
              <Bar dataKey="fy2025" name={`FY${CURRENT_FISCAL_YEAR - 1}`} fill="#93C5FD" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">{t('dashboard.by_department')} — Coût FY{CURRENT_FISCAL_YEAR}</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={deptCostData} layout="vertical" margin={{ left: 70 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#F59E0B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

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
        </div>

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
