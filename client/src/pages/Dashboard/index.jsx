import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { ticketApi } from '../../services/api'
import { KpiCard, StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: allData, isLoading } = useQuery({
    queryKey: ['tickets', 'dashboard'],
    queryFn: () => ticketApi.list({ limit: 500 }).then(r => r.data.tickets)
  })

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  )

  const tickets = allData || []
  const open     = tickets.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const done     = tickets.filter(t => t.status === 'completed')
  const totalCost = tickets.reduce((a, t) => a + (t.cost_approx || 0), 0)
  const pct = tickets.length ? Math.round(done.length / tickets.length * 100) : 0

  // By category
  const catMap = {}
  tickets.forEach(t => { const c = t.categories || 'Other'; catMap[c] = (catMap[c] || 0) + 1 })
  const catData = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,6)
    .map(([name, count]) => ({ name, count }))

  // By department cost
  const deptMap = {}
  tickets.forEach(t => { deptMap[t.department] = (deptMap[t.department] || 0) + (t.cost_approx || 0) })
  const deptData = Object.entries(deptMap).sort((a,b) => b[1]-a[1]).slice(0,6)
    .map(([name, cost]) => ({ name, cost: Math.round(cost) }))

  return (
    <>
      <PageHeader title={t('nav.dashboard')} subtitle="Vue d'ensemble — qualité & coûts" />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={t('dashboard.open_tickets')}
            value={open.length}
            icon="ti-clipboard-list" iconBg="bg-blue-50 text-blue-600"
            sub={`${tickets.length} total`}
          />
          <KpiCard
            label={t('dashboard.total_cost')}
            value={`$${Math.round(totalCost).toLocaleString()}`}
            icon="ti-currency-dollar" iconBg="bg-amber-50 text-amber-600"
            sub="Expédition incl."
          />
          <KpiCard
            label={t('dashboard.completion_rate')}
            value={`${pct}%`}
            icon="ti-circle-check" iconBg="bg-green-50 text-green-600"
            sub={`${done.length} complétés`} subColor="text-green-500"
          />
          <KpiCard
            label={t('dashboard.next_meeting')}
            value="Vendr. 6 juin"
            icon="ti-calendar-event" iconBg="bg-gray-100 text-gray-500"
            sub="Revue qualité hebdo"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">{t('dashboard.by_category')}</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catData} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={60} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563EB" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-900 mb-4">{t('dashboard.by_department')}</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptData} layout="vertical" margin={{ left: 70 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={v => `$${v.toLocaleString()}`} />
                <Bar dataKey="cost" fill="#F59E0B" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent tickets */}
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
                  {['ID','Issue','Ship To','Brand','Status','Cost'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.slice(0, 8).map(t => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{t.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-sm max-w-xs truncate">{t.quality_issue}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{t.ship_to}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={t.brand} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{t.cost_approx ? `$${t.cost_approx.toLocaleString()}` : '—'}</td>
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
