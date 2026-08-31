import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, fetchOccurrenceLines, CURRENT_FISCAL_YEAR } from '../../services/api'
import { usePermissions } from '../../hooks/usePermissions'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

const FISCAL_YEARS = ['all', 2026, 2025, 2024]
const PAGE_SIZE    = 100

// Urgence (champ « Statut » de la fiche) — overnight / urgent / normal
const URGENCY_LBL   = { overnight:'Overnight', urgent:'Urgent', normal:'Normal' }
const URGENCY_STYLE = {
  urgent:    'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
  overnight: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
  normal:    'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400',
}

// ── Column Filter Dropdown ─────────────────────────────────────────────────
function ColumnFilter({ label, values, selected, onChange, onClear, renderValue }) {
  const { t } = useTranslation()
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
                {t('dashboard.clear')}
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
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{renderValue ? renderValue(v) : (v || '—')}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Text « contains » filter (pour les colonnes libres, ex. Problème qualité) ─
function TextColumnFilter({ label, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const isActive = !!value.trim()
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
        {label}
        <i className={`ti ${isActive ? 'ti-filter-filled text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#161B22] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 w-64 p-2">
          <div className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-[#0D1117]">
            <i className="ti ti-search text-gray-400 text-sm" aria-hidden="true" />
            <input autoFocus className="outline-none text-xs w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
            {isActive && (
              <button onClick={() => onChange('')} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0">
                <i className="ti ti-x text-sm" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Lecture des filtres depuis l'URL — restaurés au montage pour survivre à
// l'aller-retour vers le détail d'une occurrence (même approche que la revue
// hebdo) ; un rechargement de la page les conserve aussi.
const urlParam    = (k) => new URLSearchParams(window.location.search).get(k)
const urlParamSet = (k) => new Set(new URLSearchParams(window.location.search).getAll(k))

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TicketsPage() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const { isManager } = usePermissions()

  const [showModal, setShowModal] = useState(false)
  const [fiscalYear, setFiscalYear] = useState(() => {
    const fy = urlParam('fy')
    if (fy === 'all') return 'all'
    return FISCAL_YEARS.includes(Number(fy)) ? Number(fy) : CURRENT_FISCAL_YEAR
  })
  const [search,     setSearch]     = useState(() => urlParam('q') || '')

  const [fStatus, setFStatus]   = useState(() => urlParamSet('st'))
  const [fUrgency, setFUrgency] = useState(() => urlParamSet('urg'))
  const [fBrand,  setFBrand]    = useState(() => urlParamSet('brand'))
  const [fDept,   setFDept]     = useState(() => urlParamSet('dept'))
  const [fPlant,  setFPlant]    = useState(() => urlParamSet('plant'))
  const [fProject, setFProject]   = useState(() => urlParamSet('proj'))
  const [fSC,     setFSC]       = useState(() => urlParamSet('sc'))
  const [fDate,   setFDate]     = useState(() => urlParamSet('date'))
  const [fCreator, setFCreator] = useState(() => urlParamSet('by'))
  const [costSort, setCostSort] = useState(() => ['desc', 'asc'].includes(urlParam('cost')) ? urlParam('cost') : null)  // null | 'desc' | 'asc' — trier par coût (worst offenders)
  const [fQuality, setFQuality] = useState(() => urlParam('issue') || '')    // filtre « contient » sur le problème qualité

  const { data, isLoading, isError: ticketsError, refetch } = useQuery({
    queryKey: ['tickets', fiscalYear],
    queryFn: () => ticketApi.list({ fiscal_year: fiscalYear }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    keepPreviousData: true,
  })

  const allTickets = data?.tickets || []

  // Profils pour afficher/filtrer par créateur
  const { data: profiles, isError: profilesError } = useQuery({
    queryKey: ['user-profiles-names'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name')
      return data || []
    },
    staleTime: 30 * 60 * 1000,
  })

  const profileMap = useMemo(() => {
    const map = {}
    ;(profiles || []).forEach(p => { map[p.id] = p.full_name })
    return map
  }, [profiles])

  const getCreator = (tk) => profileMap[tk.created_by] || null
  // Sentinelle des occurrences sans département — valeur neutre et stable dans
  // l'URL quelle que soit la langue ; traduite seulement à l'affichage.
  const NO_DEPT = '__none__'
  const NO_PLANT = '__none__'   // même sentinelle, paramètre d'URL distinct
  const noDeptLabel = t('dashboard.unclassified')  // « (Non défini) »

  // Lignes des occurrences affichées : coût ET département vivent au niveau de
  // la ligne. Clé ['line-costs'] conservée — c'est elle que le détail invalide
  // après une sauvegarde (refreshCostViews).
  const { data: lineRows, isError: linesError } = useQuery({
    queryKey: ['line-costs', allTickets.map(t => t.id)],
    queryFn: () => fetchOccurrenceLines(allTickets.map(t => t.id)),
    enabled: allTickets.length > 0,
  })

  const lineAgg = useMemo(() => {
    const costs = {}, depts = {}, plants = {}
    for (const l of lineRows || []) {
      costs[l.occurrence_id] = (costs[l.occurrence_id] || 0) + Number(l.cost_approx || 0)
      ;(depts[l.occurrence_id]  = depts[l.occurrence_id]  || []).push(l.department || null)
      ;(plants[l.occurrence_id] = plants[l.occurrence_id] || []).push(l.plant || null)
    }
    return { costs, depts, plants }
  }, [lineRows])

  const getCost = (ticket) => {
    const lineTotal = lineAgg.costs[ticket.id]
    if (lineTotal && lineTotal > 0) return lineTotal
    return ticket.cost_approx ? Number(ticket.cost_approx) : null
  }

  // Départements d'une occurrence : ceux de ses lignes (repli sur l'en-tête
  // pour une ligne non classifiée — même convention que le tableau de bord),
  // ou celui de l'en-tête pour les occurrences sans lignes (import / héritage).
  const getDepts = (ticket) => {
    const lineDepts = lineAgg.depts[ticket.id]
    const source = lineDepts?.length ? lineDepts.map(d => d || ticket.department) : [ticket.department]
    return [...new Set(source.filter(Boolean))]
  }

  // Usines d'une occurrence : même convention que les départements — celles de
  // ses lignes (repli sur l'en-tête), sinon celle de l'en-tête. L'usine vit sur
  // la ligne depuis 2026-06-25 : afficher/filtrer sur tk.plant laissait 30
  // occurrences FY2026 sans usine à l'écran alors que leurs lignes en ont une.
  const getPlants = (ticket) => {
    const linePlants = lineAgg.plants[ticket.id]
    const source = linePlants?.length ? linePlants.map(p => p || ticket.plant) : [ticket.plant]
    return [...new Set(source.filter(Boolean))]
  }

  // ── Delete mutation ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (ticketId) => {
      // Supprimer les fichiers du Storage avant les enregistrements, sinon ils restent orphelins
      const { data: photos } = await supabase.from('ticket_photos').select('path').eq('ticket_id', ticketId)
      const paths = (photos || []).map(p => p.path).filter(Boolean)
      if (paths.length) {
        const { error: stErr } = await supabase.storage.from('ticket-photos').remove(paths)
        if (stErr) console.warn('Storage cleanup failed:', stErr.message)
      }
      await supabase.from('ticket_photos').delete().eq('ticket_id', ticketId)
      await supabase.from('occurrence_lines').delete().eq('occurrence_id', ticketId)
      const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('ticket.deleted_toast'))
      qc.invalidateQueries(['tickets'])
    },
    onError: (err) => toast.error(err?.message || 'Erreur'),
  })

  const filtered = useMemo(() => {
    let result = allTickets
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(tk =>
        [tk.occurrence_no, tk.sc_number, tk.quality_issue, tk.project_name, tk.brand,
         ...getDepts(tk), tk.categories, ...getPlants(tk), tk.status, getCreator(tk)]
          .some(v => v && String(v).toLowerCase().includes(q))
      )
    }
    if (fQuality.trim()) { const q = fQuality.toLowerCase(); result = result.filter(tk => tk.quality_issue?.toLowerCase().includes(q)) }
    if (fStatus.size > 0) result = result.filter(tk => fStatus.has(tk.status))
    if (fUrgency.size > 0) result = result.filter(tk => fUrgency.has(tk.urgency))
    if (fBrand.size  > 0) result = result.filter(tk => fBrand.has(tk.brand))
    if (fDept.size   > 0) result = result.filter(tk => {
      const depts = getDepts(tk)
      return depts.length ? depts.some(d => fDept.has(d)) : fDept.has(NO_DEPT)
    })
    if (fPlant.size  > 0) result = result.filter(tk => {
      const plants = getPlants(tk)
      return plants.length ? plants.some(p => fPlant.has(p)) : fPlant.has(NO_PLANT)
    })
    if (fProject.size > 0) result = result.filter(tk => fProject.has(tk.project_name))
    if (fSC.size     > 0) result = result.filter(tk => fSC.has(tk.sc_number))
    if (fDate.size   > 0) result = result.filter(tk => fDate.has(tk.issue_reception_date))
    if (fCreator.size > 0) result = result.filter(tk => fCreator.has(getCreator(tk)))
    return result
  }, [allTickets, search, fQuality, fStatus, fUrgency, fBrand, fDept, fPlant, fProject, fSC, fDate, fCreator, profileMap, NO_DEPT, lineAgg])

  const uniq = (key) => [...new Set(allTickets.map(t => t[key]).filter(Boolean))].sort()
  // Valeurs du filtre Département — dérivées des lignes (repli en-tête), avec
  // « (Non défini) » en tête s'il existe des occurrences sans département.
  const deptFilterValues = useMemo(() => {
    const all = new Set()
    let hasNone = false
    for (const tk of allTickets) {
      const depts = getDepts(tk)
      if (depts.length === 0) hasNone = true
      depts.forEach(d => all.add(d))
    }
    const sorted = [...all].sort()
    return hasNone ? [NO_DEPT, ...sorted] : sorted
  }, [allTickets, lineAgg, NO_DEPT])
  // Valeurs du filtre Usine — dérivées des lignes, comme le département.
  const plantFilterValues = useMemo(() => {
    const all = new Set()
    let hasNone = false
    for (const tk of allTickets) {
      const plants = getPlants(tk)
      if (plants.length === 0) hasNone = true
      plants.forEach(p => all.add(p))
    }
    const sorted = [...all].sort()
    return hasNone ? [NO_PLANT, ...sorted] : sorted
  }, [allTickets, lineAgg, NO_PLANT])
  const creatorNames = useMemo(
    () => [...new Set(allTickets.map(tk => getCreator(tk)).filter(Boolean))].sort(),
    [allTickets, profileMap]
  )

  // Tri par coût pour repérer les « worst offenders » (coût le plus élevé en tête)
  const sorted = useMemo(() => {
    if (!costSort) return filtered
    return [...filtered].sort((a, b) => {
      const ca = getCost(a) || 0, cb = getCost(b) || 0
      return costSort === 'desc' ? cb - ca : ca - cb
    })
  }, [filtered, costSort, lineAgg])

  const [page, setPage] = useState(() => Math.max(1, Number(urlParam('p')) || 1))
  const start   = (page - 1) * PAGE_SIZE
  const tickets = sorted.slice(start, start + PAGE_SIZE)
  const hasMore = start + PAGE_SIZE < sorted.length

  // Changer un filtre ramène à la page 1 — fait de manière SYNCHRONE dans les
  // gestionnaires (resetPage ci-dessous), pas via un effet : un effet de reset
  // ferait la course avec la borne ci-dessous dans le même commit React, et
  // l'URL pourrait capturer un état hybride « nouveau filtre + ancienne page ».
  const resetPage = (setter) => (v) => { setter(v); setPage(1) }

  // Ramène la page dans les bornes quand le jeu de résultats a rétréci (p
  // restauré depuis l'URL, ou occurrence sortie du filtre après modification).
  // Attend que lignes ET profils soient chargés : tant qu'ils ne sont pas là,
  // les filtres département / créé par voient un jeu transitoire réduit et la
  // borne perdrait à tort la page restaurée. Setter fonctionnel (min) : jamais
  // d'augmentation de page, et insensible aux fermetures périmées.
  const linesSettled    = lineRows !== undefined || linesError || allTickets.length === 0
  const profilesSettled = profiles !== undefined || profilesError
  useEffect(() => {
    if ((!data && !ticketsError) || !linesSettled || !profilesSettled) return
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    setPage(p => Math.min(p, pageCount))
  }, [data, ticketsError, linesSettled, profilesSettled, sorted.length])

  // Reflète les filtres actifs dans l'URL sans empiler l'historique — c'est
  // cette URL que le retour depuis le détail d'une occurrence restaure.
  // `location` en dépendance : cliquer « Occurrences » dans la barre latérale
  // alors qu'on est déjà sur la liste pousse /tickets nu sans démonter la page ;
  // l'effet re-écrit alors les filtres actifs dans l'URL. Throttle à front
  // montant : un événement isolé (clic, restauration) écrit immédiatement, la
  // frappe au clavier est coalescée à 350 ms — sous la limite de débit de
  // Safari (SecurityError au-delà de ~100 replaceState / 30 s).
  const location = useLocation()
  const lastUrlWrite = useRef(0)
  useEffect(() => {
    const write = () => {
      lastUrlWrite.current = Date.now()
      // Si la navigation vers le détail est déjà engagée, ne pas réécrire son URL.
      if (!/\/tickets\/?$/.test(window.location.pathname)) return
      const p = new URLSearchParams()
      if (search)   p.set('q', search)
      if (fQuality) p.set('issue', fQuality)
      if (fiscalYear !== CURRENT_FISCAL_YEAR) p.set('fy', String(fiscalYear))
      const sets = { st: fStatus, urg: fUrgency, brand: fBrand, dept: fDept, plant: fPlant, proj: fProject, sc: fSC, date: fDate, by: fCreator }
      for (const [key, set] of Object.entries(sets)) [...set].forEach(v => p.append(key, v))
      if (costSort) p.set('cost', costSort)
      if (page > 1) p.set('p', String(page))
      const qs = p.toString()
      if (qs !== window.location.search.replace(/^\?/, '')) {
        try {
          window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
        } catch { /* limite Safari — l'URL se resynchronisera au prochain changement */ }
      }
    }
    const elapsed = Date.now() - lastUrlWrite.current
    if (elapsed >= 350) { write(); return }
    const id = setTimeout(write, 350 - elapsed)
    return () => clearTimeout(id)
  }, [location, search, fQuality, fiscalYear, fStatus, fUrgency, fBrand, fDept, fPlant, fProject, fSC, fDate, fCreator, costSort, page])

  const hasActiveFilters = search || fQuality || fStatus.size || fUrgency.size || fBrand.size || fDept.size || fPlant.size || fProject.size || fSC.size || fDate.size || fCreator.size

  const clearAll = () => {
    setSearch(''); setFQuality(''); setFStatus(new Set()); setFUrgency(new Set()); setFBrand(new Set())
    setFDept(new Set()); setFPlant(new Set()); setFProject(new Set())
    setFSC(new Set()); setFDate(new Set()); setFCreator(new Set())
    setPage(1)
  }

  const handleExport = () => {
    try {
      const headers = ['occurrence_no', 'sc_number', 'issue_reception_date', 'quality_issue', 'project_name', 'brand', 'department', 'plant', 'status', 'urgency', 'cost_approx', 'created_by_name']
      const rows    = filtered
        .map(t => ({ ...t, created_by_name: getCreator(t) || '', department: getDepts(t).join(', '), plant: getPlants(t).join(', ') }))
        .map(t => headers.map(h => `"${(t[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
      const csv     = [headers.join(','), ...rows].join('\n')
      // BOM UTF-8 pour que les accents s'affichent correctement dans Excel
      const url     = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
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
            placeholder={t('ticket.search_placeholder')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }} />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1) }} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0">
              <i className="ti ti-x text-sm" aria-hidden="true" />
            </button>
          )}
        </div>

        <select
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
          value={fiscalYear}
          onChange={e => { setFiscalYear(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(1) }}>
          {FISCAL_YEARS.map(fy => <option key={fy} value={fy}>{fy === 'all' ? t('ticket.all_fy') : `FY${fy}`}</option>)}
        </select>

        {hasActiveFilters && (
          <button onClick={clearAll}
            className="text-xs text-red-500 border border-red-200 dark:border-red-900 rounded-lg px-3 py-1.5 bg-transparent cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1">
            <i className="ti ti-x text-xs" aria-hidden="true" /> {t('ticket.clear_filters')}
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
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60 w-14">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">#</span>
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label="SC#" values={uniq('sc_number')} selected={fSC} onChange={resetPage(setFSC)} onClear={() => { setFSC(new Set()); setPage(1) }} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.reception_date')} values={uniq('issue_reception_date')} selected={fDate} onChange={resetPage(setFDate)} onClear={() => { setFDate(new Set()); setPage(1) }} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <TextColumnFilter label={t('ticket.issue')} value={fQuality} onChange={resetPage(setFQuality)} placeholder={t('ticket.filter_issue_ph')} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.project_name')} values={uniq('project_name')} selected={fProject} onChange={resetPage(setFProject)} onClear={() => { setFProject(new Set()); setPage(1) }} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.brand')} values={uniq('brand')} selected={fBrand} onChange={resetPage(setFBrand)} onClear={() => { setFBrand(new Set()); setPage(1) }} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.department')} values={deptFilterValues} selected={fDept} onChange={resetPage(setFDept)} onClear={() => { setFDept(new Set()); setPage(1) }}
                    renderValue={v => v === NO_DEPT ? noDeptLabel : v} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.plant')} values={plantFilterValues} selected={fPlant} onChange={resetPage(setFPlant)} onClear={() => { setFPlant(new Set()); setPage(1) }}
                    renderValue={v => v === NO_PLANT ? noDeptLabel : v} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.status')} values={uniq('status')} selected={fStatus} onChange={resetPage(setFStatus)} onClear={() => { setFStatus(new Set()); setPage(1) }}
                    renderValue={v => t(`status.${v}`)} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.urgency_col')} values={uniq('urgency')} selected={fUrgency} onChange={resetPage(setFUrgency)} onClear={() => { setFUrgency(new Set()); setPage(1) }}
                    renderValue={v => URGENCY_LBL[v] || v} />
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <button
                    onClick={() => { setCostSort(s => s === 'desc' ? 'asc' : s === 'asc' ? null : 'desc'); setPage(1) }}
                    className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                    {t('ticket.cost')}
                    <i className={`ti ${costSort === 'desc' ? 'ti-sort-descending text-blue-500' : costSort === 'asc' ? 'ti-sort-ascending text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.created_by')} values={creatorNames} selected={fCreator} onChange={resetPage(setFCreator)} onClear={() => { setFCreator(new Set()); setPage(1) }} />
                </th>
                {/* Coluna de acções — só visível para admin/manager */}
                {isManager && (
                  <th className="px-4 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60 w-12" />
                )}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const cost  = getCost(ticket)
                const depts = getDepts(ticket)
                const plants = getPlants(ticket)
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === ticket.id
                return (
                  <tr key={ticket.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/tickets/${ticket.id}`)}>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-700 dark:text-gray-300">{ticket.occurrence_no ? `#${ticket.occurrence_no}` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{ticket.issue_reception_date}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{ticket.project_name || '—'}</td>
                    <td className="px-4 py-2.5"><BrandTag brand={ticket.brand} /></td>
                    <td className="px-4 py-2.5">
                      {depts.length
                        ? <div className="flex flex-wrap gap-1">
                            {depts.map(d => (
                              <span key={d} className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">{d}</span>
                            ))}
                          </div>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{plants.length ? plants.join(', ') : '—'}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={ticket.status} /></td>
                    <td className="px-4 py-2.5">
                      {ticket.urgency
                        ? <span className={`text-xs px-2 py-0.5 rounded-full ${URGENCY_STYLE[ticket.urgency] || 'text-gray-500 bg-gray-100 dark:bg-gray-800'}`}>{URGENCY_LBL[ticket.urgency] || ticket.urgency}</span>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900 dark:text-gray-100">
                      {cost ? `$${Math.round(cost).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{getCreator(ticket) || '—'}</td>
                    {/* Botão apagar — só admin/manager */}
                    {isManager && (
                      <td className="px-2 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            const msg = t('ticket.delete_occurrence_confirm', { sc: ticket.sc_number || ticket.id })
                            if (window.confirm(msg)) deleteMutation.mutate(ticket.id)
                          }}
                          disabled={deleteMutation.isPending}
                          title={t('ticket.delete_occurrence_title')}
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
