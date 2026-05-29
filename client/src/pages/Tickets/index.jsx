import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import toast from 'react-hot-toast'

const STATUSES = ['', 'not_started', 'wip', 'completed']
const DEPARTMENTS = ['','Client','Sales','Production','Shipping','Logistics','Planning',
  'Engineering','Supplier','Product Dev.','Ext. Sales','Install','NCW','VC']

export default function TicketsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ status: '', department: '', brand: '', search: '', page: 1 })

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => ticketApi.list(filters).then(r => r.data)
  })

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }))

  const handleExport = async () => {
    try {
      const res = await ticketApi.export(filters)
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = 'sqh-export.xlsx'; a.click()
    } catch { toast.error('Export failed') }
  }

  const tickets = data?.tickets || []
  const total   = data?.total || 0

  return (
    <>
      <PageHeader
        title={t('nav.tickets')}
        subtitle={`${total} tickets`}
        actions={
          <>
            <button className="btn-ghost" onClick={handleExport}>
              <i className="ti ti-download" aria-hidden="true" /> {t('common.export')}
            </button>
            <button className="btn-primary" onClick={() => navigate('/tickets/new')}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('ticket.new')}
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-5 py-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
          <i className="ti ti-search text-gray-400 text-base" aria-hidden="true" />
          <input
            className="outline-none text-sm w-48 placeholder:text-gray-400"
            placeholder={t('common.search')}
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
          />
        </div>

        <select
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none"
          value={filters.status}
          onChange={e => setFilter('status', e.target.value)}
        >
          <option value="">{t('common.all')} statuts</option>
          {STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>

        <select
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none"
          value={filters.department}
          onChange={e => setFilter('department', e.target.value)}
        >
          <option value="">{t('common.all')} depts.</option>
          {DEPARTMENTS.filter(Boolean).map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Table */}
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
                <tr
                  key={ticket.id}
                  className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/tickets/${ticket.id}`)}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{ticket.issue_reception_date}</td>
                  <td className="px-4 py-2.5 text-sm max-w-xs">
                    <div className="truncate">{ticket.quality_issue}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[140px] truncate">{ticket.ship_to}</td>
                  <td className="px-4 py-2.5"><BrandTag brand={ticket.brand} /></td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {ticket.department}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={ticket.status} /></td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">
                    {ticket.cost_approx ? `$${ticket.cost_approx.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > filters.page * 50 && (
        <div className="bg-white border-t border-gray-200 px-5 py-3 flex justify-between items-center text-sm text-gray-500">
          <span>Affichage {Math.min(total, filters.page * 50)} / {total}</span>
          <button
            className="btn-ghost"
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
          >
            Page suivante <i className="ti ti-arrow-right" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  )
}
