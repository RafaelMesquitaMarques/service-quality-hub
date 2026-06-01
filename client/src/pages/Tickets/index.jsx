import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

const STATUSES = ['', 'not_started', 'wip', 'service_desk', 'quality_meeting', 'completed', 'cancelled']
const DEPARTMENTS = [
  '', 'Client', 'Shipping', 'Supplier', 'Production', 'Logistics',
  'Install', 'Ext. Sales', 'Int. Sales', 'NCW', 'Product Dev.',
  'Engineering', 'VC', 'Project Mgnt', 'EOI', 'Vietnam', 'Planning',
]
const BRANDS      = ['', 'HIEX', 'HOME 2', 'INDEP', 'ResHall', 'SBG', 'STWD']
const FISCAL_YEARS = ['all', 2026, 2025, 2024]
const PAGE_SIZE    = 100

export default function TicketsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showModal,  setShowModal]  = useState(false)
  const [selected,   setSelected]   = useState(new Set())
  const [filters, setFilters] = useState({
    fiscal_year: CURRENT_FISCAL_YEAR,
    status: '', department: '', brand: '', search: '', page: 1,
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => ticketApi.list(filters).then(r => r.data),
  })

  const allTickets = data?.tickets || []
  const total      = data?.total   || 0

  // Fetch costs from occurrence_lines
  const { data: lineCosts } = useQuery({
    queryKey: ['line-costs', allTickets.map(t => t.id).join(',')],
    queryFn: async () => {
      if (!allTickets.length) return {}
      const { data: lines } = await supabase
        .from('occurrence_lines')
        .select('occurrence_id, cost_approx')
        .in('occurrence_id', allTickets.map(t => t.id))
      if (!lines) return {}
      const costs = {}
      lines.forEach(l => { costs[l.occurrence_id] = (costs[l.occurrence_id] || 0) + Number(l.cost_approx || 0) })
      return costs
    },
    enabled: allTickets.length > 0,
  })

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }))

  // Client-side multi-column search
  const searched = useMemo(() => {
    const q = filters.search.toLowerCase().trim()
    if (!q) return allTickets
    return allTickets.filter(tk =>
      [tk.sc_number, tk.quality_issue, tk.ship_to, tk.sold_to, tk.brand, tk.department, tk.categories, tk.ref_so]
        .some(v => v && String(v).toLowerCase().includes(q))
    )
  }, [allTickets, filters.search])

  const start   = (filters.page - 1) * PAGE_SIZE
  const tickets = searched.slice(start, start + PAGE_SIZE)
  const hasMore = start + PAGE_SIZE < searched.length

  const getCost = (ticket) => {
    const lineTotal = lineCosts?.[ticket.id]
    if (lineTotal && lineTotal > 0) return lineTotal
    return ticket.cost_approx ? Number(ticket.cost_approx) : null
  }

  // Selection
  const allSelected   = tickets.length > 0 && tickets.every(t => selected.has(t.id))
  const someSelected  = tickets.some(t => selected.has(t.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(s => { const n = new Set(s); tickets.forEach(t => n.delete(t.id)); return n })
    } else {
      setSelected(s => { const n = new Set(s); tickets.forEach(t => n.add(t.id)); return n })
    }
  }

  const toggleOne = (id, e) => {
    e.stopPropagation()
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const handleBulkStatus = async (status) => {
    const ids = [...selected]
    if (!ids.length) return
    const { error } = await supabase.from('tickets').update({ status }).in('id', ids)
    if (error) { toast.error(t('common.error')); return }
    toast.success(`${ids.length} occurrence${ids.length > 1 ? 's' : ''} mises à jour`)
    setSelected(new Set())
    refetch()
  }

  const handleExport = async () => {
    try {
      const toExport = selected.size > 0 ? searched.filter(t => selected.has(t.id)) : searched
      const headers  = ['sc_number', 'issue_reception_date', 'quality_issue', 'ship_to', 'brand', 'department', 'status', 'cost_approx']
      const rows     = toExport.map(t => headers.map(h => `"${(t[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
      const csv      = [headers.join(','), ...rows].join('\n')
      const url      = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `sqh-fy${filters.fiscal_year}.csv`; a.click()
    } catch { toast.error('Export failed') }
  }

  return (
    <>
      <PageHeader
        title={t('nav.tickets')}
        subtitle={`${total} occurrences · FY${filters.fiscal_year}`}
        actions={
          <>
            <button className="btn-ghost" onClick={handleExport}>
              <i className="ti ti-download" aria-hidden="true" />
              {selected.size > 0 ? ` Export (${selected.size})` : ` ${t('common.export')}`}
            </button>
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('ticket.new')}
            </button>
          </>
        }
      />

      {/* ── Filters ── */}
      <div className="bg-white dark:bg-[#0D1117] border-b border-gray-200 dark:border-gray-700/60 px-5 py-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-[#161B22] flex-1 min-w-48">
          <i className="ti ti-search text-gray-400 text-base" aria-hidden="true" />
          <input
            className="outline-none text-sm w-full placeholder:text-gray-400 bg-transparent text-gray-900 dark:text-gray-100"
            placeholder="SC#, issue, ship to, brand, dept, REF SO..."
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)} />
          {filters.search && (
            <button onClick={() => setFilter('search', '')} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0">
              <i className="ti ti-x text-sm" aria-hidden="true" />
            </button>
          )}
        </div>
        {[
          { value: filters.fiscal_year, onChange: e => setFilter('fiscal_year', e.target.value === 'all' ? 'all' : Number(e.target.value)),
            options: FISCAL_YEARS.map(fy => ({ value: fy, label: fy === 'all' ? 'Tous les FY' : `FY${fy}` })) },
          { value: filters.status, onChange: e => setFilter('status', e.target.value),
            options: [{ value: '', label: `${t('common.all')} statuts` }, ...STATUSES.filter(Boolean).map(s => ({ value: s, label: t(`status.${s}`) }))] },
          { value: filters.brand, onChange: e => setFilter('brand', e.target.value),
            options: [{ value: '', label: 'Toutes marques' }, ...BRANDS.filter(Boolean).map(b => ({ value: b, label: b }))] },
          { value: filters.department, onChange: e => setFilter('department', e.target.value),
            options: [{ value: '', label: `${t('common.all')} depts.` }, ...DEPARTMENTS.filter(Boolean).map(d => ({ value: d, label: d }))] },
        ].map((sel, i) => (
          <select key={i}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={sel.value} onChange={sel.onChange}>
            {sel.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {(filters.search || filters.status || filters.brand || filters.department) && (
          <button onClick={() => setFilters(f => ({ ...f, search:'', status:'', brand:'', department:'', page:1 }))}
            className="text-xs text-red-500 border border-red-200 dark:border-red-900 rounded-lg px-3 py-1.5 bg-transparent cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20">
            <i className="ti ti-x text-xs" aria-hidden="true" /> Effacer filtres
          </button>
        )}
      </div>

      {/* ── Bulk actions bar ── */}
      {selected.size > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-5 py-2 flex items-center gap-3">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {selected.size} sélectionnée{selected.size > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2 ml-2">
            <span className="text-xs text-blue-600 dark:text-blue-400">Changer statut:</span>
            {STATUSES.filter(Boolean).map(s => (
              <button key={s} onClick={() => handleBulkStatus(s)}
                className="text-xs px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-[#161B22] text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40">
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer">
            Désélectionner tout
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <EmptyState icon="ti-clipboard-off" message={t('common.no_results')} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700/60 w-8">
                  <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleAll} className="cursor-pointer" />
                </th>
                {['SC#', t('ticket.reception_date'), t('ticket.issue'), t('ticket.ship_to'), t('ticket.brand'), t('ticket.department'), t('ticket.status'), t('ticket.cost')].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const cost    = getCost(ticket)
                const isSel   = selected.has(ticket.id)
                return (
                  <tr key={ticket.id}
                    className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
                      isSel ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
                    }`}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}>
                    <td className="px-3 py-2.5" onClick={e => toggleOne(ticket.id, e)}>
                      <input type="checkbox" checked={isSel} onChange={() => {}} className="cursor-pointer" />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{ticket.issue_reception_date}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{ticket.ship_to}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={ticket.brand} /></td>
                    <td className="px-4 py-2.5">
                      {ticket.department
                        ? <span className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">{ticket.department}</span>
                        : <span className="text-xs text-gray-400">—</span>}
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
          <span>{t('common.showing')} {start + 1}–{Math.min(start + PAGE_SIZE, searched.length)} {t('common.of')} {searched.length}</span>
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

      {showModal && <TicketModal onClose={() => { setShowModal(false); refetch() }} />}
    </>
  )
}
