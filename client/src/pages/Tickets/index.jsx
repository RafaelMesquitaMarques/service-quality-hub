import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

const STATUSES = [
  '', 'not_started', 'wip', 'service_desk', 'quality_meeting', 'completed', 'cancelled'
]
const DEPARTMENTS = [
  '', 'Client', 'Shipping', 'Supplier', 'Production', 'Logistics',
  'Install', 'Ext. Sales', 'Int. Sales', 'NCW', 'Product Dev.',
  'Engineering', 'VC', 'Project Mgnt', 'EOI', 'Vietnam', 'Planning',
]
const FISCAL_YEARS = ['all', 2026, 2025, 2024]
const PAGE_SIZE    = 50

export default function TicketsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [filters, setFilters] = useState({
    fiscal_year: CURRENT_FISCAL_YEAR,
    status: '', department: '', brand: '', search: '', page: 1,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => ticketApi.list(filters).then(r => r.data),
  })

  // Fetch occurrence_lines costs for visible tickets
  const allTickets = data?.tickets || []
  const { data: lineCosts } = useQuery({
    queryKey: ['line-costs', allTickets.map(t => t.id)],
    queryFn: async () => {
      if (!allTickets.length) return {}
      const ids = allTickets.map(t => t.id)
      const { data: lines } = await supabase
        .from('occurrence_lines')
        .select('occurrence_id, cost_approx')
        .in('occurrence_id', ids)
      if (!lines) return {}
      // Sum cost per occurrence
      const costs = {}
      lines.forEach(l => {
        costs[l.occurrence_id] = (costs[l.occurrence_id] || 0) + Number(l.cost_approx || 0)
      })
      return costs
    },
    enabled: allTickets.length > 0,
  })

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }))

  const handleExport = async () => {
    try {
      const headers = ['sc_number', 'issue_reception_date', 'quality_issue', 'ship_to', 'brand', 'department', 'status', 'cost_approx']
      const rows = allTickets.map(t => headers.map(h => `"${(t[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `sqh-fy${filters.fiscal_year}.csv`; a.click()
    } catch { toast.error('Export failed') }
  }

  const total   = data?.total || 0
  const start   = (filters.page - 1) * PAGE_SIZE
  const tickets = allTickets.slice(start, start + PAGE_SIZE)
  const hasMore = start + PAGE_SIZE < total

  const getCost = (ticket) => {
    const lineTotal = lineCosts?.[ticket.id]
    if (lineTotal && lineTotal > 0) return lineTotal
    return ticket.cost_approx ? Number(ticket.cost_approx) : null
  }

  return (
    <>
      <PageHeader
        title={t('nav.tickets')}
        subtitle={`${total} occurrences · FY${filters.fiscal_year}`}
        actions={
          <>
            <button className="btn-ghost" onClick={handleExport}>
              <i className="ti ti-download" aria-hidden="true" /> {t('common.export')}
            </button>
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('ticket.new')}
            </button>
          </>
        }
      />

      {/* ── Filters ── */}
      <div className="bg-white dark:bg-[#0D1117] border-b border-gray-200 dark:border-gray-700/60 px-5 py-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-[#161B22]">
          <i className="ti ti-search text-gray-400 text-base" aria-hidden="true" />
          <input
            className="outline-none text-sm w-48 placeholder:text-gray-400 bg-transparent text-gray-900 dark:text-gray-100"
            placeholder={t('common.search')} value={filters.search}
            onChange={e => setFilter('search', e.target.value)} />
        </div>
        {[
          {
            value: filters.fiscal_year,
            onChange: e => setFilter('fiscal_year', e.target.value === 'all' ? 'all' : Number(e.target.value)),
            options: FISCAL_YEARS.map(fy => ({ value: fy, label: fy === 'all' ? 'Tous les FY' : `FY${fy}` }))
          },
          {
            value: filters.status,
            onChange: e => setFilter('status', e.target.value),
            options: [{ value: '', label: `${t('common.all')} statuts` }, ...STATUSES.filter(Boolean).map(s => ({ value: s, label: t(`status.${s}`) }))]
          },
          {
            value: filters.department,
            onChange: e => setFilter('department', e.target.value),
            options: [{ value: '', label: `${t('common.all')} depts.` }, ...DEPARTMENTS.filter(Boolean).map(d => ({ value: d, label: d }))]
          },
        ].map((sel, i) => (
          <select key={i}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={sel.value} onChange={sel.onChange}>
            {sel.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <EmptyState icon="ti-clipboard-off" message={t('common.no_results')} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0">
              <tr>
                {['SC#', t('ticket.reception_date'), t('ticket.issue'), t('ticket.ship_to'), t('ticket.brand'), t('ticket.department'), t('ticket.status'), t('ticket.cost')].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const cost = getCost(ticket)
                return (
                  <tr key={ticket.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
                    onClick={() => navigate(`/tickets/${ticket.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{ticket.issue_reception_date}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{ticket.ship_to}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={ticket.brand} /></td>
                    <td className="px-4 py-2.5">
                      {ticket.department
                        ? <span className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">{ticket.department}</span>
                        : <span className="text-xs text-gray-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={ticket.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900 dark:text-gray-100">
                      {cost ? `$${Math.round(cost).toLocaleString()}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {(hasMore || filters.page > 1) && (
        <div className="bg-white dark:bg-[#0D1117] border-t border-gray-200 dark:border-gray-700/60 px-5 py-3 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
          <span>{t('common.showing')} {start + 1}–{Math.min(start + PAGE_SIZE, total)} {t('common.of')} {total}</span>
          <div className="flex gap-2">
            {filters.page > 1 && (
              <button className="btn-ghost" onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                <i className="ti ti-arrow-left" aria-hidden="true" /> {t('common.previous')}
              </button>
            )}
            {hasMore && (
              <button className="btn-ghost" onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                {t('common.next')} <i className="ti ti-arrow-right" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <TicketModal onClose={() => { setShowModal(false); refetch() }} />
      )}
    </>
  )
}
