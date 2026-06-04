import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { usePermissions } from '../../hooks/usePermissions'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

const FISCAL_YEARS = ['all', 2026, 2025, 2024]
const PAGE_SIZE    = 100

// ── Column Filter Dropdown ─────────────────────────────────────────────────
function ColumnFilter({ label, values, selected, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isActive = selected.size > 0

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors group"
      >
        {label}
        <i className={`ti ${isActive ? 'ti-filter-filled text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#161B22] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 min-w-40 max-w-56 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
            {isActive && (
              <button onClick={() => { onClear(); setOpen(false) }}
                className="text-xs text-red-500 hover:text-red-700 bg-transparent border-0 cursor-pointer">
                Effacer
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {values.map(v => (
              <label key={v} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(v)}
                  onChange={() => {
                    const next = new Set(selected)
                    next.has(v) ? next.delete(v) : next.add(v)
                    onChange(next)
                  }}
                  className="cursor-pointer"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{v || '—'}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TicketsPage() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const { isManager } = usePermissions()

  const [showModal, setShowModal] = useState(false)
  const [fiscalYear, setFiscalYear] = useState(CURRENT_FISCAL_YEAR)
  const [search,     setSearch]     = useState('')

  const [fStatus, setFStatus]   = useState(new Set())
  const [fBrand,  setFBrand]    = useState(new Set())
  const [fDept,   setFDept]     = useState(new Set())
  const [fPlant,  setFPlant]    = useState(new Set())
  const [fShipTo, setFShipTo]   = useState(new Set())
  const [fSC,     setFSC]       = useState(new Set())
  const [fDate,   setFDate]     = useState(new Set())

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', fiscalYear],
    queryFn: () => ticketApi.list({ fiscal_year: fiscalYear }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    keepPreviousData: true,
  })

  const allTickets = data?.tickets || []

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

  const getCost = (ticket) => {
    const lineTotal = lineCosts?.[ticket.id]
    if (lineTotal && lineTotal > 0) return lineTotal
    return ticket.cost_approx ? Number(ticket.cost_approx) : null
  }

  // ── Delete mutation ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (ticketId) => {
      await supabase.from('ticket_photos').delete().eq('ticket_id', ticketId)
      await supabase.from('occurrence_lines').delete().eq('occurrence_id', ticketId)
      const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Occurrence supprimée')
      qc.invalidateQueries(['tickets'])
    },
    onError: (err) => toast.error(err?.message || 'Erreur'),
  })

  const handleDelete = (e, ticket) => {
    e.stopPropagation() // éviter navigation vers le détail
    const msg = `Supprimer l'occurrence SC# ${ticket.sc_number || ticket.id} ?\n\nCette action est irréversible.`
    if (window.confirm(msg)) deleteMutation.mutate(ticket.id)
  }

  const filtered = useMemo(() => {
    let result = allTickets
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(tk =>
        [tk.sc_number, tk.quality_issue, tk.ship_to, tk.sold_to, tk.brand,
         tk.department, tk.categories, tk.ref_so, tk.plant, tk.status]
          .some(v => v && String(v).toLowerCase().includes(q))
      )
    }
    if (fStatus.size > 0) result = result.filter(tk => fStatus.has(tk.status))
    if (fBrand.size  > 0) result = result.filter(tk => fBrand.has(tk.brand))
    if (fDept.size   > 0) result = result.filter(tk => fDept.has(tk.department))
    if (fPlant.size  > 0) result = result.filter(tk => fPlant.has(tk.plant))
    if (fShipTo.size > 0) result = result.filter(tk => fShipTo.has(tk.ship_to))
    if (fSC.size     > 0) result = result.filter(tk => fSC.has(tk.sc_number))
    if (fDate.size   > 0) result = result.filter(tk => fDate.has(tk.issue_reception_date))
    return result
  }, [allTickets, search, fStatus, fBrand, fDept, fPlant, fShipTo, fSC, fDate])

  const uniq = (key) => [...new Set(allTickets.map(t => t[key]).filter(Boolean))].sort()

  const [page, setPage] = useState(1)
  const start   = (page - 1) * PAGE_SIZE
  const tickets = filtered.slice(start, start + PAGE_SIZE)
  const hasMore = start + PAGE_SIZE < filtered.length

  useEffect(() => setPage(1), [search, fStatus, fBrand, fDept, fPlant, fShipTo, fSC, fDate, fiscalYear])

  const hasActiveFilters = search || fStatus.size || fBrand.size || fDept.size || fPlant.size || fShipTo.size || fSC.size || fDate.size

  const clearAll = () => {
    setSearch(''); setFStatus(new Set()); setFBrand(new Set())
    setFDept(new Set()); setFPlant(new Set()); setFShipTo(new Set())
    setFSC(new Set()); setFDate(new Set())
  }

  const handleExport = () => {
    try {
      const headers = ['sc_number', 'issue_reception_date', 'quality_issue', 'ship_to', 'brand', 'department', 'status', 'cost_approx']
      const rows    = filtered.map(t => headers.map(h => `"${(t[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
      const csv     = [headers.join(','), ...rows].join('\n')
      const url     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `sqh-fy${fiscalYear}.csv`; a.click()
    } catch { toast.error('Export failed') }
  }

  return (
    <>
      <PageHeader
        title={t('nav.tickets')}
        subtitle={`${filtered.length} / ${allTickets.length} occurrences · FY${fiscalYear}`}
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

      {/* ── Top bar ── */}
      <div className="bg-white dark:bg-[#0D1117] border-b border-gray-200 dark:border-gray-700/60 px-5 py-3 flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-[#161B22] flex-1 min-w-56">
          <i className="ti ti-search text-gray-400 text-base" aria-hidden="true" />
          <input
            className="outline-none text-sm w-full placeholder:text-gray-400 bg-transparent text-gray-900 dark:text-gray-100"
            placeholder="Rechercher dans toutes les colonnes..."
            value={search}
            onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0">
              <i className="ti ti-x text-sm" aria-hidden="true" />
            </button>
          )}
        </div>

        <select
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
          value={fiscalYear}
          onChange={e => setFiscalYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          {FISCAL_YEARS.map(fy => <option key={fy} value={fy}>{fy === 'all' ? 'Tous les FY' : `FY${fy}`}</option>)}
        </select>

        {hasActiveFilters && (
          <button onClick={clearAll}
            className="text-xs text-red-500 border border-red-200 dark:border-red-900 rounded-lg px-3 py-1.5 bg-transparent cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1">
            <i className="ti ti-x text-xs" aria-hidden="true" /> Effacer tous les filtres
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0D1117]">
        {isLoading && !data ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <EmptyState icon="ti-clipboard-off" message={t('common.no_results')} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label="SC#" values={uniq('sc_number')} selected={fSC} onChange={setFSC} onClear={() => setFSC(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.reception_date')} values={uniq('issue_reception_date')} selected={fDate} onChange={setFDate} onClear={() => setFDate(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t('ticket.issue')}</span>
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label="Ship To" values={uniq('ship_to')} selected={fShipTo} onChange={setFShipTo} onClear={() => setFShipTo(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.brand')} values={uniq('brand')} selected={fBrand} onChange={setFBrand} onClear={() => setFBrand(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.department')} values={uniq('department')} selected={fDept} onChange={setFDept} onClear={() => setFDept(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.status')} values={uniq('status')} selected={fStatus} onChange={setFStatus} onClear={() => setFStatus(new Set())} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t('ticket.cost')}</span>
                </th>
                {/* Coluna de acções — só visível para admin/manager */}
                {isManager && (
                  <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60 w-12" />
                )}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const cost = getCost(ticket)
                const isDeleting = deleteMutation.isLoading && deleteMutation.variables === ticket.id
                return (
                  <tr key={ticket.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/tickets/${ticket.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{ticket.issue_reception_date}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{ticket.ship_to || '—'}</td>
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
                    {/* Botão apagar — só admin/manager */}
                    {isManager && (
                      <td className="px-2 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            const msg = `Supprimer l'occurrence SC# ${ticket.sc_number || ticket.id} ?\n\nCette action est irréversible.`
                            if (window.confirm(msg)) deleteMutation.mutate(ticket.id)
                          }}
                          disabled={deleteMutation.isLoading}
                          title="Supprimer l'occurrence"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs py-1 px-2 rounded border cursor-pointer inline-flex items-center"
                          style={{ border:'1px solid #fecaca', background:'#fff5f5', color:'#ef4444' }}
                        >
                          <i className="ti ti-trash text-sm" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {(hasMore || page > 1) && (
        <div className="bg-white dark:bg-[#0D1117] border-t border-gray-200 dark:border-gray-700/60 px-5 py-3 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
          <span>{t('common.showing')} {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} {t('common.of')} {filtered.length}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <button className="btn-ghost" onClick={() => setPage(p => p - 1)}>
                <i className="ti ti-arrow-left" aria-hidden="true" /> {t('common.previous')}
              </button>
            )}
            {hasMore && (
              <button className="btn-ghost" onClick={() => setPage(p => p + 1)}>
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
