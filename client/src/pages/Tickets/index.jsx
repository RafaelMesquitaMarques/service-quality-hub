import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, fetchOccurrenceLines, CURRENT_FISCAL_YEAR } from '../../services/api'
import { fiscalYearsDown } from '../../utils/fiscal'
import { customerOf } from '../../utils/customer'
import { usePermissions } from '../../hooks/usePermissions'
import { StatusBadge, BrandTag, PageHeader, Spinner, EmptyState } from '../../components/ui'
import TicketModal from './TicketModal'
import toast from 'react-hot-toast'

// De l'année fiscale en cours à FY2024 — calculé : codée en dur, la liste
// n'aurait pas proposé FY2027 à partir du 1er décembre 2026.
const FISCAL_YEARS = ['all', ...fiscalYearsDown(2024)]
const PAGE_SIZE    = 100

// Urgence (champ « Statut » de la fiche) — overnight / urgent / normal
const URGENCY_LBL   = { overnight:'Overnight', urgent:'Urgent', normal:'Normal' }
const URGENCY_STYLE = {
  urgent:    'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
  overnight: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
  normal:    'text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400',
}

// Champs jamais indexés pour la recherche : identifiants techniques et
// horodatages internes. Un UUID correspondrait à presque n'importe quelle
// frappe et noierait les résultats. Même chose pour notification_sent, vrai ou
// faux sur toutes les occurrences : « true » / « false » indexés, taper « fal »
// ou « rue » les ramènerait toutes.
const NON_SEARCHABLE = new Set([
  'id', 'occurrence_id', 'created_by', 'assigned_to',
  'created_at', 'updated_at', 'submitted_at', 'sd_completed_at',
  'sort_order', 'fiscal_year', 'fiscal_month', 'date_yyyy_mm',
  'notification_sent',
])
// Séparateur entre champs indexés : un caractère non saisissable, pour qu'une
// recherche ne puisse pas correspondre à cheval sur deux champs.
const SEP = String.fromCharCode(1)

// ── Column Filter Dropdown ─────────────────────────────────────────────────
function ColumnFilter({ label, title, values, selected, onChange, onClear, renderValue }) {
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
        title={title}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors group"
      >
        {label}
        <i className={`ti ${isActive ? 'ti-filter-filled text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#161B22] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 min-w-40 max-w-56 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{title || label}</span>
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

// En-tête d'une colonne de montant (coût, crédit). Le clic cycle en trois
// temps : décroissant → croissant → ordre d'origine.
function AmountSortHeader({ label, sort, onCycle }) {
  return (
    <button
      onClick={onCycle}
      className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
      {label}
      <i className={`ti ${sort === 'desc' ? 'ti-sort-descending text-blue-500' : sort === 'asc' ? 'ti-sort-ascending text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
    </button>
  )
}
const nextSort = (s) => s === 'desc' ? 'asc' : s === 'asc' ? null : 'desc'

// Montant : le signe précède le « $ » (−$49, et non $-49). Un coût net devient
// négatif quand le crédit fournisseur d'une ligne dépasse ses coûts.
const money = (v) => {
  const n = Math.round(Number(v) || 0)
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString()}`
}

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
  const [fNotif,  setFNotif]    = useState(() => urlParamSet('notif'))   // 'yes' | 'no' — notification envoyée
  const [costSort, setCostSort] = useState(() => ['desc', 'asc'].includes(urlParam('cost')) ? urlParam('cost') : null)  // null | 'desc' | 'asc' — trier par coût (worst offenders)
  const [creditSort, setCreditSort] = useState(() => ['desc', 'asc'].includes(urlParam('credit')) ? urlParam('credit') : null)  // idem pour le crédit fournisseur
  const [fQuality, setFQuality] = useState(() => urlParam('issue') || '')    // filtre « contient » sur le problème qualité

  const { data, isLoading, isError: ticketsError, isPlaceholderData: ticketsPlaceholder, refetch } = useQuery({
    queryKey: ['tickets', fiscalYear],
    queryFn: () => ticketApi.list({ fiscal_year: fiscalYear }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    // v5 : l'option `keepPreviousData: true` n'existe plus (ignorée sans erreur) ;
    // c'est placeholderData qui garde la liste affichée pendant un changement d'année.
    placeholderData: keepPreviousData,
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

  // Lignes des occurrences affichées : crédit, département et usine vivent au
  // niveau de la ligne (le coût, lui, arrive déjà agrégé : real_cost), et la
  // recherche porte sur leurs champs. Clé ['line-costs'] conservée — c'est elle
  // que le détail invalide après une sauvegarde (refreshCostViews).
  const { data: lineRows, isError: linesError, isPlaceholderData: linesPlaceholder, refetch: refetchLines } = useQuery({
    queryKey: ['line-costs', allTickets.map(t => t.id)],
    queryFn: () => fetchOccurrenceLines(allTickets.map(t => t.id), { withTextFields: true }),
    enabled: allTickets.length > 0,
    // La clé change dès qu'une occurrence est créée ou supprimée : les lignes
    // précédentes restent affichées le temps du rechargement, sans valoir
    // « chargées » pour autant (voir linesSettled).
    placeholderData: keepPreviousData,
  })

  const lineAgg = useMemo(() => {
    const credits = {}, creditee = {}, depts = {}, plants = {}
    for (const l of lineRows || []) {
      // Crédit fournisseur : cumulé à part du coût, qui en est déjà net.
      credits[l.occurrence_id] = (credits[l.occurrence_id] || 0) + Number(l.supplier_credit || 0)
      if (l.supplier_credit != null) creditee[l.occurrence_id] = true
      ;(depts[l.occurrence_id]  = depts[l.occurrence_id]  || []).push(l.department || null)
      ;(plants[l.occurrence_id] = plants[l.occurrence_id] || []).push(l.plant || null)
    }
    return { credits, creditee, depts, plants }
  }, [lineRows])

  // ── Index de recherche ───────────────────────────────────────────────────
  // La recherche porte sur TOUTE l'occurrence, pas seulement les colonnes du
  // tableau : chaque champ de l'en-tête et chaque champ de chacune de ses
  // lignes (intitulé, description, cause racine, action corrective, item,
  // Foliot ID, ref SO, coûts, quantités...). Un défaut saisi sur la ligne 3
  // d'une occurrence la rend donc trouvable depuis la liste.
  // Construit une seule fois par jeu de données — le filtre par frappe n'est
  // ensuite qu'un `includes` sur une chaîne déjà en minuscules.
  const searchIndex = useMemo(() => {
    const linesByOcc = {}
    for (const l of lineRows || []) (linesByOcc[l.occurrence_id] ||= []).push(l)

    const collect = (obj, out) => {
      for (const [k, v] of Object.entries(obj)) {
        if (NON_SEARCHABLE.has(k)) continue
        if (v === null || v === undefined || v === '') continue
        out.push(String(v))
      }
    }
    const index = {}
    for (const tk of allTickets) {
      const parts = []
      collect(tk, parts)
      for (const line of linesByOcc[tk.id] || []) collect(line, parts)
      // Valeurs affichées mais absentes des colonnes brutes : nom du créateur
      // et libellés traduits (chercher « complété » doit fonctionner).
      const creator = getCreator(tk)
      if (creator) parts.push(creator)
      if (tk.status)  parts.push(t(`status.${tk.status}`))
      if (tk.urgency) parts.push(URGENCY_LBL[tk.urgency] || tk.urgency)
      index[tk.id] = parts.join(SEP).toLowerCase()
    }
    return index
  }, [allTickets, lineRows, profileMap, t])

  // Coût = real_cost de la vue tickets_with_cost : somme des lignes dès qu'une
  // ligne est chiffrée (net du crédit fournisseur, nul ou négatif légitime),
  // sinon coût de l'en-tête (imports sans lignes). Même règle que l'ancien
  // calcul sur les lignes chargées à part (vérifié identique sur les 2 525
  // occurrences, tous statuts), mais livrée avec l'occurrence : ce calcul
  // affichait les coûts d'en-tête tant que les lignes chargeaient — et pour de
  // bon si leur requête échouait (−41 % du coût FY2026).
  const getCost = (ticket) => ticket.real_cost == null ? null : Number(ticket.real_cost)

  // Crédit total obtenu des fournisseurs sur l'occurrence : somme des lignes,
  // repli sur l'en-tête (colonne héritée `tickets.supplier_credit`, venue des
  // imports Excel — 9 occurrences FY2025/26 pour 9 191 $) quand aucune ligne
  // ne porte de crédit. Même règle que getCost : la ligne fait foi dès qu'elle
  // est renseignée. Le coût d'en-tête de ces occurrences est déjà net du crédit.
  const getCredit = (ticket) => {
    if (lineAgg.creditee[ticket.id]) return lineAgg.credits[ticket.id]
    return ticket.supplier_credit ? Number(ticket.supplier_credit) : 0
  }

  // Départements / usines d'une occurrence : ceux de ses lignes (repli sur
  // l'en-tête pour une ligne non classifiée — même convention que le tableau de
  // bord), ou celui de l'en-tête pour les occurrences sans lignes (import).
  // Une ligne qui reste non classifiée met la SENTINELLE dans l'ensemble : une
  // occurrence partiellement classée relève donc à la fois de ses départements
  // ET de « (Non défini) ». Indispensable — le coût vit sur la ligne, donc la
  // part « (Non défini) » du camembert est la somme de LIGNES non classées ;
  // ne rendre « (Non défini) » qu'aux occurrences 100 % non classées rendait
  // 35 000 $ sur 45 000 $ (FY2026) introuvables par le filtre.
  const deriveValues = (lineVals, headerVal, none) => {
    const source = lineVals?.length ? lineVals.map(v => v || headerVal) : [headerVal]
    return [...new Set(source.map(v => v || none))]
  }
  const getDepts  = (ticket) => deriveValues(lineAgg.depts[ticket.id],  ticket.department, NO_DEPT)
  // L'usine vit sur la ligne depuis 2026-06-25 : afficher/filtrer sur tk.plant
  // laissait 30 occurrences FY2026 sans usine à l'écran alors que leurs lignes
  // en ont une.
  const getPlants = (ticket) => deriveValues(lineAgg.plants[ticket.id], ticket.plant, NO_PLANT)
  // Valeurs réelles (sentinelle retirée) — pour l'affichage et l'export.
  const named = (vals, none) => vals.filter(v => v !== none)

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
      result = result.filter(tk => (searchIndex[tk.id] || '').includes(q))
    }
    if (fQuality.trim()) { const q = fQuality.toLowerCase(); result = result.filter(tk => tk.quality_issue?.toLowerCase().includes(q)) }
    if (fStatus.size > 0) result = result.filter(tk => fStatus.has(tk.status))
    if (fUrgency.size > 0) result = result.filter(tk => fUrgency.has(tk.urgency))
    if (fBrand.size  > 0) result = result.filter(tk => fBrand.has(tk.brand))
    if (fDept.size   > 0) result = result.filter(tk => getDepts(tk).some(d => fDept.has(d)))
    if (fPlant.size  > 0) result = result.filter(tk => getPlants(tk).some(p => fPlant.has(p)))
    if (fProject.size > 0) result = result.filter(tk => fProject.has(customerOf(tk)))
    if (fSC.size     > 0) result = result.filter(tk => fSC.has(tk.sc_number))
    if (fDate.size   > 0) result = result.filter(tk => fDate.has(tk.issue_reception_date))
    if (fCreator.size > 0) result = result.filter(tk => fCreator.has(getCreator(tk)))
    if (fNotif.size  > 0) result = result.filter(tk => fNotif.has(tk.notification_sent ? 'yes' : 'no'))
    return result
  }, [allTickets, search, searchIndex, fQuality, fStatus, fUrgency, fBrand, fDept, fPlant, fProject, fSC, fDate, fCreator, fNotif, profileMap, NO_DEPT, lineAgg])

  const uniq = (key) => [...new Set(allTickets.map(t => t[key]).filter(Boolean))].sort()
  // Client : project_name, sinon ship_to — les occurrences importées n'ont que
  // ship_to et restaient sans client (colonne, filtre) sur project_name seul.
  // Filtre sur ce même libellé : les URL « proj » existantes restent valides.
  const customerValues = useMemo(
    () => [...new Set(allTickets.map(customerOf).filter(Boolean))].sort(),
    [allTickets]
  )
  // Valeurs du filtre Département — dérivées des lignes (repli en-tête), avec
  // « (Non défini) » en tête s'il existe des occurrences sans département.
  const filterValues = (getter, none) => {
    const all = new Set()
    for (const tk of allTickets) getter(tk).forEach(v => all.add(v))
    const hasNone = all.delete(none)
    const sorted = [...all].sort()
    return hasNone ? [none, ...sorted] : sorted
  }
  const deptFilterValues = useMemo(() => filterValues(getDepts, NO_DEPT), [allTickets, lineAgg, NO_DEPT])
  // Valeurs du filtre Usine — dérivées des lignes, comme le département.
  const plantFilterValues = useMemo(() => filterValues(getPlants, NO_PLANT), [allTickets, lineAgg, NO_PLANT])
  const creatorNames = useMemo(
    () => [...new Set(allTickets.map(tk => getCreator(tk)).filter(Boolean))].sort(),
    [allTickets, profileMap]
  )

  // Tri par coût pour repérer les « worst offenders » (coût le plus élevé en tête),
  // ou par crédit pour voir d'un coup quels projets ont obtenu un crédit.
  // Les deux tris sont exclusifs : activer l'un désactive l'autre.
  const sorted = useMemo(() => {
    const active = costSort ? { dir: costSort, val: getCost } : creditSort ? { dir: creditSort, val: getCredit } : null
    if (!active) return filtered
    return [...filtered].sort((a, b) => {
      const va = active.val(a) || 0, vb = active.val(b) || 0
      return active.dir === 'desc' ? vb - va : va - vb
    })
  }, [filtered, costSort, creditSort, lineAgg])

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
  // Les données « placeholder » (liste ou lignes précédentes, gardées pendant un
  // rechargement) ne comptent pas comme chargées.
  const linesSettled    = (lineRows !== undefined && !linesPlaceholder) || linesError || allTickets.length === 0
  const profilesSettled = profiles !== undefined || profilesError
  useEffect(() => {
    if ((!data && !ticketsError) || ticketsPlaceholder || !linesSettled || !profilesSettled) return
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    setPage(p => Math.min(p, pageCount))
  }, [data, ticketsError, ticketsPlaceholder, linesSettled, profilesSettled, sorted.length])

  // Export CSV seulement sur des données définitives : pas pendant qu'une autre
  // année charge (la précédente reste affichée), ni avant les lignes, dont
  // viennent le crédit, les départements et les usines exportés — sinon ce sont
  // les valeurs d'en-tête qui partaient dans le fichier — ni avant les profils
  // (colonne created_by_name vide). Lignes en échec : l'export reste possible,
  // le bandeau signale le repli sur l'en-tête.
  const exportReady = !!data && !ticketsPlaceholder && linesSettled && profilesSettled

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
      const sets = { st: fStatus, urg: fUrgency, brand: fBrand, dept: fDept, plant: fPlant, proj: fProject, sc: fSC, date: fDate, by: fCreator, notif: fNotif }
      for (const [key, set] of Object.entries(sets)) [...set].forEach(v => p.append(key, v))
      if (costSort) p.set('cost', costSort)
      if (creditSort) p.set('credit', creditSort)
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
  }, [location, search, fQuality, fiscalYear, fStatus, fUrgency, fBrand, fDept, fPlant, fProject, fSC, fDate, fCreator, fNotif, costSort, creditSort, page])

  const hasActiveFilters = search || fQuality || fStatus.size || fUrgency.size || fBrand.size || fDept.size || fPlant.size || fProject.size || fSC.size || fDate.size || fCreator.size || fNotif.size

  const clearAll = () => {
    setSearch(''); setFQuality(''); setFStatus(new Set()); setFUrgency(new Set()); setFBrand(new Set())
    setFDept(new Set()); setFPlant(new Set()); setFProject(new Set())
    setFSC(new Set()); setFDate(new Set()); setFCreator(new Set()); setFNotif(new Set())
    setPage(1)
  }

  const handleExport = () => {
    if (!exportReady) return
    try {
      const headers = ['occurrence_no', 'sc_number', 'issue_reception_date', 'quality_issue', 'project_name', 'customer', 'brand', 'department', 'plant', 'status', 'urgency', 'cost_approx', 'supplier_credit', 'notification_sent', 'created_by_name']
      const rows    = filtered
        // `cost_approx` (real_cost de la vue) et `supplier_credit` (lignes
        // agrégées) remplacent les colonnes de l'en-tête pour l'export ;
        // `customer` = project_name, sinon ship_to (valeur de la colonne Projet).
        .map(t => ({ ...t, customer: customerOf(t) || '', cost_approx: getCost(t) ?? '', supplier_credit: getCredit(t) || '', created_by_name: getCreator(t) || '', department: named(getDepts(t), NO_DEPT).join(', '), plant: named(getPlants(t), NO_PLANT).join(', ') }))
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
            <button className="btn-ghost disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleExport}
              disabled={!exportReady} title={exportReady ? undefined : t('common.loading')}>
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

      {/* Lignes non chargées : crédit, départements, usines et recherche dans
          les lignes retombent sur l'en-tête. Le dire, plutôt que de laisser
          lire ces valeurs comme définitives. */}
      {linesError && (
        <div role="alert" className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-5 py-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
          <i className="ti ti-alert-triangle text-sm" aria-hidden="true" />
          <span className="flex-1">{t('ticket.lines_load_error')}</span>
          <button onClick={() => refetchLines()}
            className="text-xs border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1 bg-transparent cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40">
            {t('reports.data.retry')}
          </button>
        </div>
      )}

      {/* ── Table ── */}
      {/* Cellules en px-3 : avec les pastilles de statut sur une seule ligne,
          le px-4 d'origine faisait déborder le tableau (défilement horizontal
          de ~70 px à 1920 px de large). Atténué tant que la liste affichée est
          celle de l'année précédemment choisie (placeholder). */}
      <div className={`flex-1 overflow-auto bg-white dark:bg-[#0D1117] transition-opacity ${ticketsPlaceholder ? 'opacity-50' : ''}`}>
        {isLoading && !data ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : tickets.length === 0 ? (
          <EmptyState icon="ti-clipboard-off" message={t('common.no_results')} />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-[#161B22] sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60 w-14">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">#</span>
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label="SC#" values={uniq('sc_number')} selected={fSC} onChange={resetPage(setFSC)} onClear={() => { setFSC(new Set()); setPage(1) }} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.reception_date')} values={uniq('issue_reception_date')} selected={fDate} onChange={resetPage(setFDate)} onClear={() => { setFDate(new Set()); setPage(1) }} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <TextColumnFilter label={t('ticket.issue')} value={fQuality} onChange={resetPage(setFQuality)} placeholder={t('ticket.filter_issue_ph')} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.project_name')} values={customerValues} selected={fProject} onChange={resetPage(setFProject)} onClear={() => { setFProject(new Set()); setPage(1) }} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.brand')} values={uniq('brand')} selected={fBrand} onChange={resetPage(setFBrand)} onClear={() => { setFBrand(new Set()); setPage(1) }} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.department')} values={deptFilterValues} selected={fDept} onChange={resetPage(setFDept)} onClear={() => { setFDept(new Set()); setPage(1) }}
                    renderValue={v => v === NO_DEPT ? noDeptLabel : v} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.plant')} values={plantFilterValues} selected={fPlant} onChange={resetPage(setFPlant)} onClear={() => { setFPlant(new Set()); setPage(1) }}
                    renderValue={v => v === NO_PLANT ? noDeptLabel : v} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.status')} values={uniq('status')} selected={fStatus} onChange={resetPage(setFStatus)} onClear={() => { setFStatus(new Set()); setPage(1) }}
                    renderValue={v => t(`status.${v}`)} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.urgency_col')} values={uniq('urgency')} selected={fUrgency} onChange={resetPage(setFUrgency)} onClear={() => { setFUrgency(new Set()); setPage(1) }}
                    renderValue={v => URGENCY_LBL[v] || v} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <AmountSortHeader label={t('ticket.cost')} sort={costSort}
                    onCycle={() => { setCostSort(nextSort); setCreditSort(null); setPage(1) }} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <AmountSortHeader label={t('ticket.credit_total')} sort={creditSort}
                    onCycle={() => { setCreditSort(nextSort); setCostSort(null); setPage(1) }} />
                </th>
                {/* Notification envoyée : une cloche plutôt qu'un libellé — le
                    tableau est déjà à sa largeur minimale vers 1920 px, chaque
                    colonne s'ajoute au défilement horizontal. Libellé complet
                    en infobulle et en titre du filtre. */}
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={<i className="ti ti-bell text-sm" aria-hidden="true" />} title={t('ticket.notification_sent')} values={['yes', 'no']} selected={fNotif} onChange={resetPage(setFNotif)} onClear={() => { setFNotif(new Set()); setPage(1) }}
                    renderValue={v => v === 'yes' ? t('common.yes') : t('common.no')} />
                </th>
                <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60">
                  <ColumnFilter label={t('ticket.created_by')} values={creatorNames} selected={fCreator} onChange={resetPage(setFCreator)} onClear={() => { setFCreator(new Set()); setPage(1) }} />
                </th>
                {/* Coluna de acções — só visível para admin/manager */}
                {isManager && (
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 dark:border-gray-700/60 w-12" />
                )}
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => {
                const cost   = getCost(ticket)
                const credit = getCredit(ticket)
                // Les noms réels d'un côté, la part non classifiée de l'autre :
                // une occurrence partiellement classée porte les deux, et le
                // discret « (Non défini) » signale qu'il reste une ligne à classer.
                const depts  = named(getDepts(ticket),  NO_DEPT)
                const plants = named(getPlants(ticket), NO_PLANT)
                const deptPartial  = depts.length  > 0 && getDepts(ticket).includes(NO_DEPT)
                const plantPartial = plants.length > 0 && getPlants(ticket).includes(NO_PLANT)
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === ticket.id
                return (
                  <tr key={ticket.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/tickets/${ticket.id}`)}>
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-gray-700 dark:text-gray-300">{ticket.occurrence_no ? `#${ticket.occurrence_no}` : '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-400">{ticket.sc_number || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{ticket.issue_reception_date}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 max-w-xs"><div className="truncate">{ticket.quality_issue}</div></td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">{customerOf(ticket) || '—'}</td>
                    <td className="px-3 py-2.5"><BrandTag brand={ticket.brand} /></td>
                    <td className="px-3 py-2.5">
                      {depts.length
                        ? <div className="flex flex-wrap gap-1">
                            {depts.map(d => (
                              <span key={d} className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap">{d}</span>
                            ))}
                            {deptPartial && (
                              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-500 px-2 py-0.5 rounded-full whitespace-nowrap">{noDeptLabel}</span>
                            )}
                          </div>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate">
                      {plants.length ? plants.join(', ') + (plantPartial ? `, ${noDeptLabel}` : '') : '—'}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={ticket.status} /></td>
                    <td className="px-3 py-2.5">
                      {ticket.urgency
                        ? <span className={`text-xs px-2 py-0.5 rounded-full ${URGENCY_STYLE[ticket.urgency] || 'text-gray-500 bg-gray-100 dark:bg-gray-800'}`}>{URGENCY_LBL[ticket.urgency] || ticket.urgency}</span>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-gray-900 dark:text-gray-100">
                      {cost ? money(cost) : '—'}
                    </td>
                    {/* Crédit fournisseur : en vert, c'est de l'argent récupéré. */}
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {credit ? money(credit) : <span className="text-gray-400 font-normal">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {ticket.notification_sent
                        ? <i className="ti ti-bell-check text-base text-emerald-600 dark:text-emerald-400" role="img" title={t('ticket.notification_sent')} aria-label={t('ticket.notification_sent')} />
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{getCreator(ticket) || '—'}</td>
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
