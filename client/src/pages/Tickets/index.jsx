import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

const STATUSES = ['', 'not_started', 'wip', 'completed']
const DEPARTMENTS = [
  '', 'Client', 'Shipping', 'Supplier', 'Production', 'Logistics',
  'Install', 'Ext. Sales', 'Int. Sales', 'NCW', 'Product Dev.',
  'Engineering', 'VC', 'Project Mgnt', 'EOI', 'Vietnam', 'Planning',
]
const FISCAL_YEARS = ['all', 2026, 2025, 2024]
const PAGE_SIZE = 50

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

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }))

  const handleExport = async () => {
    try {
      const allTickets = data?.tickets || []
      const headers = ['sc_number', 'issue_reception_date', 'quality_issue', 'ship_to', 'brand', 'department', 'status', 'cost_approx']
      const rows = allTickets.map(t => headers.map(h => `"${(t[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `sqh-fy${filters.fiscal_year}.csv`; a.click()
    } catch { toast.error('Export failed') }
  }

  const allTickets = data?.tickets || []
  const total      = data?.total   || 0
  const start      = (filters.page - 1) * PAGE_SIZE
  const tickets    = allTickets.slice(start, start + PAGE_SIZE)
  const hasMore    = start + PAGE_SIZE < total

  return (
    <>
      <PageHeader
        title={t('nav.tickets')}
        subtitle={`${total} tickets · FY${filters.fiscal_year}`}
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

      <div className="bg-white border-b border-gray-200 px-5 py-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
          <i className="ti ti-search text-gray-400 text-base" aria-hidden="true" />
          <input className="outline-none text-sm w-48 placeholder:text-gray-400"
            placeholder={t('common.search')} value={filters.search}
            onChange={e => setFilter('search', e.target.value)} />
        </div>
        <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none"
          value={filters.fiscal_year}
          onChange={e => setFilter('fiscal_year', e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {FISCAL_YEARS.map(fy => <option key={fy} value={fy}>{fy === 'all' ? 'Tous les FY' : `FY${fy}`}</option>)}
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none"
          value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">{t('common.all')} statuts</option>
          {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none"
          value={filters.department} onChange={e => setFilter('department', e.target.value)}>
          <option value="">{t('common.all')} depts.</option>
          {DEPARTMENTS.filter(Boolean).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <EmptyState icon="ti-clipboard-off" message={t('common.no_results')} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['SC#','Date réception','Problème','Ship To','Marque','Dépt.','Statut','Coût'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => (
                <tr key={ticket.id}
                  className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/tickets/${ticket.id}`)}>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{ticket.issue_reception_date}</td>
                  <td className="px-4 py-2.5 text-sm max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[140px] truncate">{ticket.ship_to}</td>
                  <td className="px-4 py-2.5"><BrandTag brand={ticket.brand} /></td>
                  <td className="px-4 py-2.5"><span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{ticket.department}</span></td>
                  <td className="px-4 py-2.5"><StatusBadge status={ticket.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">{ticket.cost_approx ? `$${Number(ticket.cost_approx).toLocaleString()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(hasMore || filters.page > 1) && (
        <div className="bg-white border-t border-gray-200 px-5 py-3 flex justify-between items-center text-sm text-gray-500">
          <span>Affichage {start + 1}–{Math.min(start + PAGE_SIZE, total)} / {total}</span>
          <div className="flex gap-2">
            {filters.page > 1 && (
              <button className="btn-ghost" onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                <i className="ti ti-arrow-left" aria-hidden="true" /> Précédent
              </button>
            )}
            {hasMore && (
              <button className="btn-ghost" onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                Suivant <i className="ti ti-arrow-right" aria-hidden="true" />
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
