import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, fetchLineCostTotals, fetchOccurrenceLines, getFiscalYear, CURRENT_FISCAL_YEAR } from '../../services/api'
import { useThemeStore } from '../../store/themeStore'
import { PageHeader, Spinner } from '../../components/ui'
import { formatDate as formatDateValue, isPastDate } from '../../utils/date'
import { customerOf } from '../../utils/customer'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  todo:        { bg:'#1e3a5f', color:'#93c5fd' },
  in_progress: { bg:'#3b2a00', color:'#fcd34d' },
  done:        { bg:'#14532d', color:'#86efac' },
  late:        { bg:'#4a1b0c', color:'#fca5a5' },
}
const STATUS_STYLE_LIGHT = {
  todo:        { bg:'#eff6ff', color:'#0c447c' },
  in_progress: { bg:'#fef3c7', color:'#633806' },
  done:        { bg:'#eaf3de', color:'#27500a' },
  late:        { bg:'#fcebeb', color:'#791f1f' },
}

// Colonnes triables du tableau « Occurrences à discuter »
const SORT_KEYS = ['sc', 'issue', 'project', 'department', 'cost']
// Gabarit commun aux deux vues du tableau (toutes les occurrences / filtrée)
const TABLE_COLS = '52px 1fr 140px 120px 64px 28px'

// Montant : le signe précède le « $ » (−$49), comme la liste et le détail. Une
// ligne dont le crédit fournisseur dépasse les coûts est négative : l'afficher
// garde les lignes détaillées d'une occurrence égales à son total. Zéro → tiret.
function formatCost(v) {
  const n = Math.round(Number(v) || 0)
  return n === 0 ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString()}`
}

// Sentinelle « (Non défini) » des filtres département / usine : valeur neutre
// et stable dans l'URL quelle que soit la langue (comme la liste des
// occurrences), traduite seulement à l'affichage.
const NONE = '__none__'

// Valeurs proposées par un filtre : celles présentes, « (Non défini) » en tête
// s'il en manque une. Une valeur non classée est un membre comme un autre —
// sinon le coût des lignes non classées n'est isolable par aucun filtre.
function filterOptions(values) {
  const isNone = v => !v || v === NONE
  const named = [...new Set(values.filter(v => !isNone(v)))].sort()
  return values.some(isNone) ? [NONE, ...named] : named
}

// Ordre des lignes dans l'occurrence (comme le détail et les Rapports) : il
// décide quelle ligne porte le coût d'en-tête et l'ordre des lignes détaillées.
const byLineOrder = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Unités de coût / classement — même règle que le tableau de bord et les
// Rapports. Occurrence AVEC lignes : une unité par ligne, département / usine
// de la ligne (repli sur l'en-tête) ; coût de la ligne dès qu'UNE ligne est
// chiffrée (net du crédit fournisseur : zéro et négatif sont légitimes), sinon
// coût d'en-tête porté une seule fois, par la 1re ligne. Occurrence SANS lignes
// (import) : une unité d'en-tête. L'ancien test « somme des lignes > 0 »
// renvoyait sur le département d'en-tête les occurrences à lignes non chiffrées
// ou nettes ≤ 0 : 10 occurrences FY2026 n'avaient pas le département du
// tableau de bord.
function buildUnits(tickets, lines) {
  const byOcc = {}
  for (const l of lines) (byOcc[l.occurrence_id] ||= []).push(l)
  return tickets.flatMap(tk => {
    const ls = (byOcc[tk?.id] || []).slice().sort(byLineOrder)
    if (!ls.length) return [{
      id: tk?.id, line_id: null, occurrence_id: tk?.id,
      quality_issue: tk?.quality_issue,
      cost_approx: Number(tk?.cost_approx || 0),
      department: tk?.department || null,
      plant: tk?.plant || null,
    }]
    const anyCosted = ls.some(l => l.cost_approx != null)
    return ls.map((l, i) => ({
      id: l.id, line_id: l.id, occurrence_id: tk?.id,
      quality_issue: l.quality_issue || tk?.quality_issue,
      cost_approx: anyCosted ? Number(l.cost_approx || 0) : i === 0 ? Number(tk?.cost_approx || 0) : 0,
      department: l.department || tk?.department || null,
      plant: l.plant || tk?.plant || null,
    }))
  })
}


// `meeting_date` et les échéances d'action sont des colonnes DATE : formatage
// sans conversion de fuseau (voir utils/date.js).
function formatDate(d) {
  return formatDateValue(d, '')
}
function weekLabel(d) {
  const s = formatDateValue(d, '')   // « YYYY-MM-DD »
  return s ? `Week ${s.slice(5)}` : ''
}

// Dropdown multi-sélection (checkboxes) — même gabarit visuel que les anciens
// <select> du filtre : icône à gauche, chevron à droite, surbrillance bleue si actif.
// Les options sont dérivées des occurrences de la réunion : le panneau explicite
// les états « chargement » et « aucune valeur » plutôt que d'afficher du vide.
function MultiSelect({ icon, allLabel, options, value, onChange, loading, failed, renderOption = v => v }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (opt) => onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  const active = value.length > 0
  const label  = !active ? allLabel : value.length === 1 ? renderOption(value[0]) : `${renderOption(value[0])} +${value.length - 1}`

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <i className={`ti ${icon} text-sm absolute left-2.5 pointer-events-none ${active ? 'text-blue-500' : 'text-gray-400'}`} aria-hidden="true" />
      <button type="button" onClick={() => setOpen(o => !o)} title={active ? value.map(renderOption).join(', ') : allLabel}
        className={`text-xs font-medium rounded-lg border cursor-pointer pl-7 pr-7 py-1.5 transition-colors max-w-44 truncate
          ${active
            ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] text-gray-600 dark:text-gray-300'}`}>
        {label}
      </button>
      <i className="ti ti-chevron-down text-xs text-gray-400 absolute right-2 pointer-events-none" aria-hidden="true" />
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-full w-max max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161B22] shadow-xl py-1">
          <div className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${!active ? 'font-medium text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
            onClick={() => { onChange([]); setOpen(false) }}>
            {allLabel}
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
          {options.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-gray-400 italic whitespace-nowrap">
              {/* Lecture en échec : « aucune valeur » serait faux — il y en a,
                  elles n'ont pas pu être lues. */}
              {loading ? t('common.loading') : failed ? t('common.error') : t('meeting.filter_no_options')}
            </div>
          ) : options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap">
              <input type="checkbox" className="accent-blue-600 cursor-pointer" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {renderOption(opt)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// En-tête de colonne triable — cycle asc → desc → ordre d'origine au clic,
// même iconographie que la liste des occurrences (ti-selector / ti-sort-*).
function SortHeader({ label, sortKey, sort, onToggle, right }) {
  const active = sort?.key === sortKey
  return (
    <button type="button" onClick={() => onToggle(sortKey)}
      className={`flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors bg-transparent border-0 p-0 cursor-pointer ${right ? 'justify-end w-full' : ''}`}>
      {label}
      <i className={`ti ${active ? (sort.dir === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending') + ' text-blue-500' : 'ti-selector'} text-xs`} aria-hidden="true" />
    </button>
  )
}

// Échec de lecture : message + « Réessayer » à la place des données. Avant,
// chaque requête se repliait sur une liste vide — une erreur réseau ou RLS se
// lisait comme une réunion sans occurrence, à 0 $.
function QueryError({ queries }) {
  const { t } = useTranslation()
  const failed = queries.filter(q => q?.isError)
  if (!failed.length) return null
  const detail = failed.map(q => q.error?.message).find(Boolean)
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 py-3 text-xs text-red-600 dark:text-red-400">
      <i className="ti ti-alert-triangle" aria-hidden="true" />
      <span className="flex-1 min-w-0 break-words">{t('common.error')}{detail ? ` — ${detail.slice(0, 160)}` : ''}</span>
      <button type="button" onClick={() => failed.forEach(q => q.refetch())} disabled={failed.some(q => q.isFetching)}
        className="btn-ghost text-xs py-1 px-2">
        <i className="ti ti-refresh" aria-hidden="true" /> {t('reports.data.retry')}
      </button>
    </div>
  )
}

function TicketPicker({ ticketsQ, linksQ, selected, meetingMap, onAdd, onClose }) {
  const { t } = useTranslation()
  const tickets = ticketsQ.data
  const [search, setSearch]   = useState('')
  const [dept,   setDept]     = useState('')
  const [status, setStatus]   = useState('quality_meeting')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  // Départements des candidats, dérivés de leurs LIGNES : le classement vit sur
  // la ligne depuis 2026-06-25, et filtrer sur tk.department (en-tête hérité) ne
  // trouvait presque plus rien. Clé sur tout le vivier, pas sur les candidats
  // filtrés : elle reste stable pendant la saisie et les ajouts.
  const poolIds = useMemo(() => (tickets || []).map(tk => tk.id), [tickets])
  const linesQ = useQuery({
    queryKey: ['tickets-picker-lines', poolIds],
    queryFn: () => fetchOccurrenceLines(poolIds),
    enabled: poolIds.length > 0,
  })
  // Départements d'une occurrence : ceux de ses lignes (repli en-tête pour une
  // ligne non classée), l'en-tête seul sans lignes. Une ligne qui reste non
  // classée met « (Non défini) » dans l'ensemble — convention de la liste des
  // occurrences et du tableau de bord.
  const deptsByOcc = useMemo(() => {
    const lineDepts = {}
    for (const l of linesQ.data || []) (lineDepts[l.occurrence_id] ||= []).push(l.department || null)
    const m = {}
    for (const tk of tickets || []) {
      const lv = lineDepts[tk.id]
      const source = lv?.length ? lv.map(v => v || tk.department) : [tk.department]
      m[tk.id] = [...new Set(source.map(v => v || NONE))]
    }
    return m
  }, [tickets, linesQ.data])
  const deptOptions = useMemo(
    () => (linesQ.data ? filterOptions(Object.values(deptsByOcc).flat()) : []),
    [deptsByOcc, linesQ.data])
  // « Chargement... » seulement pendant une lecture réelle : vivier en échec ou
  // vide, la requête des lignes ne part jamais et le libellé restait figé.
  const deptsPending = (!tickets && !ticketsQ.isError) || (poolIds.length > 0 && !linesQ.data && !linesQ.isError)

  const selectedIds = new Set((selected || []).map(t => t?.id))
  const filtered = (tickets || []).filter(tk => {
    if (selectedIds.has(tk.id)) return false
    if (dept && !deptsByOcc[tk.id]?.includes(dept)) return false
    if (status && tk.status !== status) return false
    if (dateFrom && tk.issue_reception_date < dateFrom) return false
    if (dateTo   && tk.issue_reception_date > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      return tk.quality_issue?.toLowerCase().includes(q) || tk.sc_number?.toLowerCase().includes(q) || customerOf(tk)?.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-8 z-[1000] overflow-y-auto">
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('meeting.add_tickets_title')}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex gap-2 flex-wrap bg-gray-50 dark:bg-[#0D1117]">
          <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 flex-1 min-w-40 bg-white dark:bg-[#161B22]">
            <i className="ti ti-search text-gray-400 text-sm" aria-hidden="true" />
            <input className="outline-none text-xs w-full bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              placeholder={t('meeting.search_tickets')} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Désactivé tant que les lignes ne sont pas lues : sans elles, le
              département d'une occurrence n'est pas connu. */}
          <select className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none min-w-36"
            value={dept} onChange={e => setDept(e.target.value)} disabled={!linesQ.data}>
            <option value="">{deptsPending ? t('common.loading') : t('meeting.all_depts')}</option>
            {deptOptions.map(d => <option key={d} value={d}>{d === NONE ? t('dashboard.unclassified') : d}</option>)}
          </select>
          <select className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none min-w-36"
            value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('meeting.all_statuses')}</option>
            {['not_started','service_desk','sd_waiting_info','quality_meeting','completed','cancelled'].map(s => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
          <input type="date" className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="px-5 py-1.5 text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
          {filtered.length} — {selectedIds.size} {t('meeting.already_selected')}
        </div>
        {/* Occurrences, réunions déjà liées (badge « En réunion ») ou lignes
            (filtre département) illisibles : on le dit plutôt que d'afficher
            une liste incomplète comme si elle était juste. */}
        <div className="px-5">
          <QueryError queries={[ticketsQ, linksQ, linesQ]} />
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {!tickets ? (
            ticketsQ.isError ? null : <div className="flex justify-center py-6"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400">{t('meeting.no_tickets_found')}</div>
          ) : filtered.map(tk => {
            const inMeetings = (meetingMap?.[tk.id] || []).filter(Boolean)
            const already    = inMeetings.length > 0
            const meetingDates = inMeetings.map(formatDate).join(', ')
            return (
            <div key={tk.id} className="grid gap-2 px-5 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'52px minmax(0,1fr) 120px 80px 64px 72px' }}>
              <div className="font-mono text-gray-400">{tk.sc_number || '—'}</div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-gray-900 dark:text-gray-100">{tk.quality_issue}</span>
                {already && (
                  <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium whitespace-nowrap"
                    title={meetingDates}>
                    <i className="ti ti-calendar-check text-[10px]" aria-hidden="true" /> {t('meeting.already_in_meeting')}
                  </span>
                )}
              </div>
              <div className="truncate text-gray-500 dark:text-gray-400">{customerOf(tk) || '—'}</div>
              <div className="text-gray-400">{tk.issue_reception_date?.slice(0,10) || '—'}</div>
              {/* real_cost (vue tickets_with_cost) : somme des lignes dès qu'une
                  ligne est chiffrée, sinon en-tête — le coût d'en-tête seul est
                  périmé depuis que le coût vit sur les lignes. */}
              <div className="font-mono text-gray-400 text-right">{formatCost(tk.real_cost)}</div>
              <button
                onClick={() => {
                  if (already && !window.confirm(t('meeting.confirm_add_duplicate', { dates: meetingDates }))) return
                  onAdd(tk.id)
                }}
                className="btn-primary py-1 px-2 text-xs">{t('meeting.add')}</button>
            </div>
          )})}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <span className="text-xs text-gray-400">{selectedIds.size} {t('meeting.selected')}</span>
          <button onClick={onClose} className="btn-ghost text-xs">{t('meeting.close')}</button>
        </div>
      </div>
    </div>
  )
}

export default function MeetingsPage() {
  const { t } = useTranslation()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const [selId,  setSelId]   = useState(() => new URLSearchParams(window.location.search).get('meetingId'))
  const [notes,  setNotes]   = useState('')
  const [newAction, setNewAction] = useState({ text:'', owner:'', due:'' })
  const [showActionForm,   setShowActionForm]   = useState(false)
  const [showTicketPicker, setShowTicketPicker] = useState(false)
  const [showNewMeeting,   setShowNewMeeting]   = useState(false)
  const [newMeetingDate,   setNewMeetingDate]   = useState('')
  // Filtres par départements / usines (multi, niveau ligne) — restaurés depuis
  // l'URL pour survivre à l'aller-retour vers le détail d'une occurrence.
  const [meetingDepts,     setMeetingDepts]     = useState(() => (new URLSearchParams(window.location.search).get('depts')  || '').split(',').filter(Boolean))
  const [meetingPlants,    setMeetingPlants]    = useState(() => (new URLSearchParams(window.location.search).get('plants') || '').split(',').filter(Boolean))
  // Tri par colonne du tableau des occurrences ({ key, dir } ou null = ordre
  // d'origine) — restauré depuis l'URL comme les filtres.
  const [meetingSort,      setMeetingSort]      = useState(() => {
    const [key, dir] = (new URLSearchParams(window.location.search).get('sort') || '').split('_')
    return SORT_KEYS.includes(key) && ['asc', 'desc'].includes(dir) ? { key, dir } : null
  })
  const toggleSort = (key) => setMeetingSort(s =>
    s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null)

  const { dark: isDark } = useThemeStore()
  const SS = isDark ? STATUS_STYLE : STATUS_STYLE_LIGHT

const meetingsQ = useQuery({
  queryKey: ['meetings-v2'],
  queryFn: async () => {
    const { data, error } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: false })
    if (error) throw error
    return data || []
  },
  staleTime: 10 * 60 * 1000, // 10 minutos
  refetchOnWindowFocus: false,
})
  const { data: meetings, isLoading: loadingMeetings } = meetingsQ

  useEffect(() => {
    if (!meetings) return
    const params = new URLSearchParams(window.location.search)
    const mid = params.get('meetingId')
    if (mid) {
      const m = meetings.find(x => x.id === mid)
      if (m) { setSelId(m.id); setNotes(m.notes || '') }
      else   { setSelId(null) }  // réunion supprimée / id invalide
    }
  }, [meetings])

  // Repartir de « tous les départements / toutes les usines » quand on change de
  // réunion — mais pas au montage, pour ne pas écraser les filtres restaurés de l'URL.
  const skipFilterReset = useRef(true)
  useEffect(() => {
    if (skipFilterReset.current) { skipFilterReset.current = false; return }
    setMeetingDepts([]); setMeetingPlants([])
  }, [selId])

  // Reflète la sélection courante (réunion + filtres) dans l'URL, sans empiler
  // l'historique — c'est elle que le bouton « Retour » du détail restaure.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const before = p.toString()
    if (selId) p.set('meetingId', selId); else p.delete('meetingId')
    if (meetingDepts.length)  p.set('depts',  meetingDepts.join(',')); else p.delete('depts')
    if (meetingPlants.length) p.set('plants', meetingPlants.join(',')); else p.delete('plants')
    if (meetingSort) p.set('sort', `${meetingSort.key}_${meetingSort.dir}`); else p.delete('sort')
    const after = p.toString()
    if (after !== before) window.history.replaceState(null, '', `${window.location.pathname}${after ? `?${after}` : ''}`)
  }, [selId, meetingDepts, meetingPlants, meetingSort])

  const selMeeting = (meetings || []).find(m => m.id === selId)

  // Les lectures LÈVENT leurs erreurs (plus de repli sur []) : React Query les
  // expose et la page affiche un message avec « Réessayer » (QueryError).
  const ticketsQ = useQuery({
    queryKey: ['meeting-tickets', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase.from('meeting_tickets').select('ticket_id, tickets(*)').eq('meeting_id', selId)
      if (error) throw error
      return (data || []).map(r => r.tickets)
    },
    enabled: !!selId,
  })
  const meetingTickets = ticketsQ.data

  const actionsQ = useQuery({
    queryKey: ['meeting-actions', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase.from('meeting_actions').select('*').eq('meeting_id', selId).order('created_at')
      if (error) throw error
      return data || []
    },
    enabled: !!selId,
  })
  const actions = actionsQ.data

  const prevMeeting = (meetings || []).find((m, i) => i === (meetings || []).findIndex(x => x.id === selId) + 1)

  const prevActionsQ = useQuery({
    queryKey: ['meeting-actions', prevMeeting?.id],
    queryFn: async () => {
      if (!prevMeeting?.id) return []
      const { data, error } = await supabase.from('meeting_actions').select('*').eq('meeting_id', prevMeeting.id).order('created_at')
      if (error) throw error
      return data || []
    },
    enabled: !!prevMeeting?.id,
  })
  const prevActions = prevActionsQ.data

  // Vivier du sélecteur « Ajouter occurrence » : vue tickets_with_cost (toutes
  // années), qui porte real_cost.
  const allTicketsQ = useQuery({
    queryKey: ['tickets-picker'],
    queryFn: () => ticketApi.list({ fiscal_year: 'all' }).then(r => r.data.tickets),
    enabled: showTicketPicker,
    staleTime: 0,
  })

  // Occurrences déjà rattachées à une (autre) réunion — pour le badge + la
  // confirmation « déjà en réunion » dans le sélecteur.
  const meetingLinksQ = useQuery({
    queryKey: ['all-meeting-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_tickets')
        .select('ticket_id, meeting_id, meetings(meeting_date)')
      if (error) throw error
      return data || []
    },
    enabled: showTicketPicker,
    staleTime: 60 * 1000,
  })
  const meetingLinks = meetingLinksQ.data

  const meetingMap = useMemo(() => {
    const m = {}
    for (const link of (meetingLinks || [])) {
      if (link.meeting_id === selId) continue        // ignore la réunion courante
      if (!m[link.ticket_id]) m[link.ticket_id] = []
      m[link.ticket_id].push(link.meetings?.meeting_date)
    }
    return m
  }, [meetingLinks, selId])

  const tickets   = meetingTickets || []
  const actList   = actions        || []

  // Fetch real costs from occurrence_lines
  const costsQ = useQuery({
    queryKey: ['line-costs-meeting', tickets.map(t => t?.id)],
    queryFn: () => fetchLineCostTotals(tickets.map(t => t?.id)),
    enabled: tickets.length > 0,
  })
  const lineCosts = costsQ.data

  const getTicketCost = (tk) => {
    // Clé présente = au moins une ligne chiffrée : elle fait référence, même si
    // le net est nul ou négatif (crédit fournisseur ≥ coûts).
    const lineTotal = lineCosts?.[tk?.id]
    if (lineTotal !== undefined) return lineTotal
    return tk?.cost_approx ? Number(tk.cost_approx) : 0
  }

  // Lignes (occurrence_lines) des occurrences de la réunion — pour la vue/filtre
  // par département (chaque ligne a son propre département + coût).
  // Ordre des lignes (sort_order) rétabli par buildUnits : c'est celui des
  // lignes détaillées sous une occurrence dans la vue filtrée, hors tri.
  const linesQ = useQuery({
    queryKey: ['meeting-lines', selId, tickets.map(t => t?.id).filter(Boolean).join(',')],
    queryFn: () => fetchOccurrenceLines(tickets.map(t => t?.id), { withTitle: true }),
    enabled: tickets.length > 0,
  })
  const meetingLines = linesQ.data

  // Lignes, coûts ou occurrences illisibles : coûts, départements et export
  // seraient faux — la section affiche l'erreur à la place.
  const ticketDataError = ticketsQ.isError || costsQ.isError || linesQ.isError

  // Unités calculées une fois les lignes lues seulement : avant, chaque
  // occurrence retombait le temps du chargement sur son département d'en-tête.
  const units = meetingLines ? buildUnits(tickets, meetingLines) : []

  // Occurrences pas encore chargées, ou lignes pas encore chargées → les
  // dropdowns affichent « Chargement... » plutôt qu'un panneau vide.
  const filtersLoading = (!meetingTickets && !ticketsQ.isError) || (tickets.length > 0 && !meetingLines && !linesQ.isError)
  const filtersFailed  = ticketsQ.isError || linesQ.isError

  const noneLabel   = t('dashboard.unclassified')  // « (Non défini) »
  const showValue   = (v) => (v === NONE ? noneLabel : v)
  const deptOptions = filterOptions(units.map(u => u.department))
  const deptFilter  = meetingDepts.filter(d => deptOptions.includes(d))    // ignore les absents
  const plantOptions = filterOptions(units.map(u => u.plant))
  const plantFilter  = meetingPlants.filter(p => plantOptions.includes(p)) // ignore les absentes
  const anyFilter    = deptFilter.length > 0 || plantFilter.length > 0
  const filterLabel  = [...deptFilter, ...plantFilter].map(showValue).join(' · ')
  const unitMatches = (u) =>
    (!deptFilter.length  || deptFilter.includes(u.department || NONE)) &&
    (!plantFilter.length || plantFilter.includes(u.plant || NONE))
  const filteredUnits = units.filter(unitMatches)

  // Vue filtrée : une rangée par OCCURRENCE, coût = somme de ses lignes retenues
  // par le filtre. Lister les lignes à plat répétait la même SC# une fois par
  // ligne, chaque clic ouvrant la même occurrence — ça se lisait comme des
  // doublons. Une occurrence à plusieurs lignes détaille dessous celles qui sont
  // comptées (`showLines`), pour qu'on voie d'où vient le montant.
  const filteredGroups = tickets.map(tk => {
    const own  = units.filter(u => u.occurrence_id === tk?.id)
    const kept = own.filter(unitMatches)
    return {
      id: tk?.id, ticket: tk, units: kept,
      title: tk?.quality_issue || kept[0]?.quality_issue,
      showLines: own.length > 1,
      cost: kept.reduce((s, u) => s + Number(u.cost_approx || 0), 0),
      department: [...new Set(kept.map(u => u.department).filter(Boolean))].sort().join(', '),
    }
  }).filter(g => g.units.length > 0)

  // Départements distincts par occurrence (pour la colonne « Département »)
  const deptByTicket = units.reduce((m, u) => {
    if (u.department) (m[u.occurrence_id] ||= new Set()).add(u.department)
    return m
  }, {})
  const ticketDept = (id) => [...(deptByTicket[id] || [])].sort().join(', ')

  // Tri au clic sur les en-têtes — s'applique aux deux vues (occurrences et
  // lignes filtrées) ainsi qu'à l'export Excel, qui suit l'ordre affiché.
  const sortRows = (rows, valOf) => {
    if (!meetingSort) return rows
    const mul = meetingSort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = valOf(a, meetingSort.key), vb = valOf(b, meetingSort.key)
      if (typeof va === 'number') return (va - vb) * mul
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * mul
    })
  }
  const sortedTickets = sortRows(tickets, (tk, key) =>
    key === 'cost'    ? getTicketCost(tk) :
    key === 'sc'      ? (tk?.sc_number || '') :
    key === 'issue'   ? (tk?.quality_issue || '') :
    key === 'project' ? (customerOf(tk) || '') :
    (ticketDept(tk?.id) || ''))
  // Vue filtrée : les occurrences se trient sur leurs propres valeurs (coût =
  // total retenu), puis leurs lignes entre elles — SC# et projet étant communs
  // aux lignes d'une occurrence, celles-ci gardent alors leur ordre (tri stable).
  const sortedGroups = sortRows(filteredGroups, (g, key) =>
    key === 'cost'    ? g.cost :
    key === 'sc'      ? (g.ticket?.sc_number || '') :
    key === 'issue'   ? (g.title || '') :
    key === 'project' ? (customerOf(g.ticket) || '') :
    g.department
  ).map(g => ({
    ...g,
    units: sortRows(g.units, (u, key) =>
      key === 'cost'       ? Number(u.cost_approx || 0) :
      key === 'issue'      ? (u.quality_issue || '') :
      key === 'department' ? (u.department || '') : ''),
  }))

  const totalCost   = tickets.reduce((s, tk) => s + getTicketCost(tk), 0)
  const deptUnitCost = filteredUnits.reduce((s, u) => s + Number(u.cost_approx || 0), 0)
  // KPIs : reflètent le filtre actif (département / usine), sinon toute la réunion
  const displayedCost  = anyFilter ? deptUnitCost : totalCost
  const displayedCount = anyFilter ? filteredGroups.length : tickets.length
  const openAct   = actList.filter(a => a.status !== 'done').length
  const doneAct   = actList.filter(a => a.status === 'done').length

  const saveNotesMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('meetings').update({ notes, updated_at: new Date().toISOString() }).eq('id', selId)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries(['meetings-v2']); toast.success(t('meeting.save_notes')) },
    onError: () => toast.error(t('common.error')),
  })

  const addActionMut = useMutation({
    mutationFn: async () => {
      if (!newAction.text) throw new Error(t('meeting.action_label'))
      const { error } = await supabase.from('meeting_actions').insert({
        meeting_id: selId, text: newAction.text, owner: newAction.owner || null, due: newAction.due || null, status: 'todo',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['meeting-actions', selId])
      setNewAction({ text:'', owner:'', due:'' })
      setShowActionForm(false)
      toast.success(t('meeting.new_action'))
    },
    onError: (e) => toast.error(e.message),
  })

  const updateActionMut = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('meeting_actions').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(['meeting-actions', selId]),
    // Sans onError, un échec passait inaperçu : le sélecteur revenait à son
    // ancienne valeur au prochain rendu, sans explication.
    onError: (e) => toast.error(e?.message || t('common.error')),
  })

  const addTicketMut = useMutation({
    mutationFn: async (ticketId) => {
      const { error } = await supabase.from('meeting_tickets').upsert({ meeting_id: selId, ticket_id: ticketId })
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries(['meeting-tickets', selId]); toast.success(t('meeting.add_ticket')) },
    onError: (e) => toast.error(e?.message || t('common.error')),
  })

  const removeTicketMut = useMutation({
    mutationFn: async (ticketId) => {
      const { error } = await supabase.from('meeting_tickets').delete().eq('meeting_id', selId).eq('ticket_id', ticketId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(['meeting-tickets', selId]),
    onError: (e) => toast.error(e?.message || t('common.error')),
  })

  const deleteMeetingMut = useMutation({
    mutationFn: async (id) => {
      const { error: e1 } = await supabase.from('meeting_actions').delete().eq('meeting_id', id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('meeting_tickets').delete().eq('meeting_id', id)
      if (e2) throw e2
      const { error: e3 } = await supabase.from('meetings').delete().eq('id', id)
      if (e3) throw e3
      return id
    },
    onSuccess: (deletedId) => {
      // Update cache directly without refetch
      queryClient.setQueryData(['meetings-v2'], (old) =>
        (old || []).filter(m => m.id !== deletedId)
      )
      if (selId === deletedId) {
        setSelId(null)
        setNotes('')
      }
      toast.success(t('meeting.deleted'))
    },
    onError: (e) => toast.error(e.message || t('common.error')),
  })

  const createMeetingMut = useMutation({
    mutationFn: async () => {
      if (!newMeetingDate) throw new Error(t('meeting.meeting_date'))
      const { data, error } = await supabase.from('meetings').insert({ meeting_date: newMeetingDate, type: 'quality_review', notes: '' }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['meetings-v2'])
      setSelId(data.id); setShowNewMeeting(false); setNewMeetingDate('')
      toast.success(t('meeting.new'))
    },
    onError: (e) => toast.error(e.message),
  })

  // Query string des liens vers le détail d'une occurrence : porte la réunion ET
  // les filtres actifs, pour que « Retour » revienne sur la même sélection — et,
  // depuis une ligne détaillée de la vue filtrée, la ligne à montrer à l'arrivée.
  const ticketLinkParams = (lineId) => {
    const p = new URLSearchParams({ from: 'meeting', meetingId: selId })
    if (meetingDepts.length)  p.set('depts',  meetingDepts.join(','))
    if (meetingPlants.length) p.set('plants', meetingPlants.join(','))
    if (meetingSort) p.set('sort', `${meetingSort.key}_${meetingSort.dir}`)
    if (lineId) p.set('line', lineId)
    return p.toString()
  }

  const handleExportExcel = () => {
    if (!selMeeting) return
    const esc  = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const row  = (cells) => cells.map(esc).join(',')
    // Respecte le filtre actif (département / usine) : exporte les lignes retenues
    // (une rangée par ligne, dans l'ordre affiché), sinon les occurrences.
    const ticketRows = anyFilter
      ? sortedGroups.flatMap(g => g.units.map(u => row([g.ticket?.sc_number, u.quality_issue, u.department, Math.round(Number(u.cost_approx || 0))])))
      : sortedTickets.map(tk => row([tk?.sc_number, tk?.quality_issue, ticketDept(tk?.id) || tk?.department, Math.round(getTicketCost(tk))]))
    const lines = [
      row([t('meeting.title'), formatDate(selMeeting.meeting_date), filterLabel || t('meeting.all_depts')]),
      '',
      row(['SC#', t('ticket.issue'), t('ticket.department'), t('ticket.cost')]),
      ...ticketRows,
      '',
      row([t('meeting.action_label'), t('meeting.owner'), t('meeting.due_date'), t('ticket.status')]),
      ...actList.map(a => row([a.text, a.owner, a.due, a.status])),
    ]
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const el  = document.createElement('a')
    const filterSuffix = filterLabel ? `-${filterLabel.replace(/[^a-z0-9]+/gi, '_')}` : ''
    el.href = url; el.download = `meeting-${selMeeting.meeting_date}${filterSuffix}.csv`; el.click()
  }
  // Pas d'export d'une réunion lue en partie : il aurait l'air complet. Idem
  // pendant le chargement — coûts d'en-tête et filtre ignoré le temps que
  // lignes et coûts arrivent.
  const exportPending = filtersLoading || (tickets.length > 0 && !lineCosts && !costsQ.isError) || (!actions && !actionsQ.isError)
  const exportBlocked = !selId || ticketDataError || actionsQ.isError || exportPending

  // Années fiscales couvertes par la liste des réunions : elle n'est PAS filtrée
  // par année (toutes les réunions, la plus récente en tête). « FY » suivi de
  // l'année en cours seule laissait croire à un filtre.
  const meetingFYs = (meetings || []).map(m => getFiscalYear(m.meeting_date)).filter(Boolean)
  const fyFirst = meetingFYs.length ? Math.min(...meetingFYs) : CURRENT_FISCAL_YEAR
  const fyLast  = meetingFYs.length ? Math.max(...meetingFYs) : CURRENT_FISCAL_YEAR
  const fyRange = fyFirst === fyLast ? `${fyLast}` : `${fyFirst}–${fyLast}`

  return (
    <>
      <PageHeader
        title={t('meeting.title')}
        subtitle={t('meeting.subtitle')}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={handleExportExcel} disabled={exportBlocked}
              title={!selId ? t('meeting.select_prompt') : exportBlocked ? t(exportPending && !ticketDataError && !actionsQ.isError ? 'common.loading' : 'common.error') : ''}>
              <i className="ti ti-table-export" aria-hidden="true" /> {t('meeting.export_excel')}
            </button>
            <button className="btn-primary" onClick={() => setShowNewMeeting(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('meeting.new')}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden flex">
        <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-700/60 overflow-y-auto bg-white dark:bg-[#0D1117]">
          <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
            {t('meeting.weeks')}{fyRange}
          </div>
          {meetingsQ.isError && (
            <div className="px-3"><QueryError queries={[meetingsQ]} /></div>
          )}
          {loadingMeetings ? (
            <div className="flex justify-center p-4"><Spinner /></div>
          ) : (meetings || []).map(m => (
            <div key={m.id}
              className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors group relative"
              style={{
                background: selId === m.id ? (isDark ? '#1e3a5f' : '#eff6ff') : 'transparent',
                borderLeft: selId === m.id ? '3px solid #2563eb' : '3px solid transparent',
              }}
              onClick={() => { setSelId(m.id); setNotes(m.notes || '') }}>
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{weekLabel(m.meeting_date)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{formatDate(m.meeting_date)}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  if (window.confirm(`${t('common.confirm_delete')}\n${weekLabel(m.meeting_date)} — ${formatDate(m.meeting_date)}`)) {
                    deleteMeetingMut.mutate(m.id)
                  }
                }}
                className="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 bg-transparent border-0 cursor-pointer"
                title={t('common.delete')}>
                <i className="ti ti-trash text-xs" aria-hidden="true" />
              </button>
            </div>
          ))}
          {(meetings || []).length === 0 && !loadingMeetings && !meetingsQ.isError && (
            <div className="p-4 text-xs text-gray-400 text-center">{t('meeting.no_meetings')}</div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-gray-50 dark:bg-[#0D1117]">
          {!selId ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              {t('meeting.select_prompt')}
            </div>
          ) : (
            <>
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <i className="ti ti-chart-bar text-blue-500" aria-hidden="true" />
                    {t('meeting.kpis')} — {weekLabel(selMeeting?.meeting_date)}
                  </div>
                  <div className="flex items-center gap-2">
                    <MultiSelect icon="ti-building" allLabel={t('meeting.all_depts')} renderOption={showValue}
                      options={deptOptions} value={deptFilter} onChange={setMeetingDepts} loading={filtersLoading} failed={filtersFailed} />
                    <MultiSelect icon="ti-building-factory-2" allLabel={t('meeting.all_plants')} renderOption={showValue}
                      options={plantOptions} value={plantFilter} onChange={setMeetingPlants} loading={filtersLoading} failed={filtersFailed} />
                    <div className="text-xs text-gray-400">{formatDate(selMeeting?.meeting_date)}</div>
                  </div>
                </div>
                {/* Lecture en échec → « — » plutôt qu'un 0 / 0 $ qui passerait
                    pour une réunion vide ; le détail est dans les sections. */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { v: ticketsQ.isError ? '—' : displayedCount, l: t('meeting.tickets_discussed'), c:'#3b82f6' },
                    { v: ticketDataError ? '—' : `$${Math.round(displayedCost).toLocaleString()}`, l: t('meeting.sc_cost_week'), c:'#ef4444' },
                    { v: actionsQ.isError ? '—' : openAct, l: t('meeting.open_actions'), c:'#f59e0b' },
                    { v: actionsQ.isError ? '—' : doneAct, l: t('meeting.completed_actions'), c:'#22c55e' },
                  ].map(({ v, l, c }) => (
                    <div key={l} className="bg-gray-50 dark:bg-[#161B22] rounded-lg p-2.5 text-center">
                      <div className="text-xl font-medium" style={{ color: c }}>{v}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {prevActionsQ.isError && (
                <div className="card px-4">
                  <QueryError queries={[prevActionsQ]} />
                </div>
              )}
              {(prevActions || []).length > 0 && (
                <div className="card">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
                    <i className="ti ti-clock-check text-amber-500 text-sm" aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{t('meeting.followup')}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium">
                      {(prevActions || []).filter(a => a.status !== 'done').length} {t('meeting.pending')}
                    </span>
                  </div>
                  <div className="px-4 py-1">
                    {(prevActions || []).map(a => {
                      const isLate = isPastDate(a.due) && a.status !== 'done'
                      const s = SS[isLate ? 'late' : (a.status || 'todo')]
                      return (
                        <div key={a.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'1fr 90px 80px 80px' }}>
                          <div className="text-gray-900 dark:text-gray-100 truncate">{a.text}</div>
                          <div className="text-gray-400">{a.owner || '—'}</div>
                          <div className="text-gray-400">{a.due ? formatDate(a.due) : '—'}</div>
                          <span className="px-2 py-0.5 rounded-full text-center font-medium" style={{ background: s.bg, color: s.color }}>
                            {isLate ? t('meeting.action_late') : t(`meeting.action_${a.status || 'todo'}`)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <i className="ti ti-clipboard-list text-blue-500 text-sm" aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                      {anyFilter ? `${t('meeting.tickets_section')} · ${filterLabel}` : t('meeting.tickets_section')}
                    </span>
                    {meetingTickets && !ticketsQ.isError && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                        {anyFilter
                          ? `${t('meeting.occurrences_count', { count: filteredGroups.length })} · ${t('meeting.lines_count', { count: filteredUnits.length })}`
                          : `${tickets.length} ${t('meeting.selected')}`}
                      </span>
                    )}
                  </div>
                  <button onClick={() => setShowTicketPicker(true)} className="btn-primary py-1 px-2.5 text-xs">
                    <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('meeting.add_ticket')}
                  </button>
                </div>
                <div className="px-4 py-1">
                  {ticketDataError ? (
                    <QueryError queries={[ticketsQ, costsQ, linesQ]} />
                  ) : !meetingTickets ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : tickets.length === 0 ? (
                    <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_tickets')}</div>
                  ) : anyFilter ? (
                    /* Vue filtrée — occurrences ayant au moins une ligne dans le département /
                       l'usine sélectionné ; les lignes comptées sont détaillées dessous. */
                    sortedGroups.length === 0 ? (
                      <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_tickets')}</div>
                    ) : (
                      <>
                        <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns: TABLE_COLS }}>
                          <SortHeader label="SC#" sortKey="sc" sort={meetingSort} onToggle={toggleSort} />
                          <SortHeader label={t('ticket.issue')} sortKey="issue" sort={meetingSort} onToggle={toggleSort} />
                          <SortHeader label={t('ticket.project_name')} sortKey="project" sort={meetingSort} onToggle={toggleSort} />
                          <SortHeader label={t('ticket.department')} sortKey="department" sort={meetingSort} onToggle={toggleSort} />
                          <SortHeader label={t('ticket.cost')} sortKey="cost" sort={meetingSort} onToggle={toggleSort} right />
                          <div></div>
                        </div>
                        {sortedGroups.map(g => (
                          <div key={g.id} className="border-b border-gray-100 dark:border-gray-800">
                            <div className="grid gap-2 py-2 text-xs items-center" style={{ gridTemplateColumns: TABLE_COLS }}>
                              <div className="font-mono text-gray-400">{g.ticket?.sc_number || '—'}</div>
                              <div className="truncate text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-500"
                                onClick={() => navigate(`/tickets/${g.id}?${ticketLinkParams()}`)}>
                                {g.title}
                              </div>
                              <div className="truncate text-gray-500 dark:text-gray-400">{customerOf(g.ticket) || '—'}</div>
                              <div className="truncate text-gray-500 dark:text-gray-400" title={g.department}>{g.department || '—'}</div>
                              <div className="font-mono text-gray-400 text-right">{formatCost(g.cost)}</div>
                              <div></div>
                            </div>
                            {g.showLines && (
                              <div className="pb-1.5">
                                {g.units.map(u => (
                                  <div key={u.id} className="grid gap-2 py-1 text-xs items-center" style={{ gridTemplateColumns: TABLE_COLS }}>
                                    <div></div>
                                    <div className="flex items-center gap-1.5 min-w-0 pl-2 text-gray-500 dark:text-gray-400 cursor-pointer hover:text-blue-500"
                                      onClick={() => navigate(`/tickets/${g.id}?${ticketLinkParams(u.line_id)}`)}>
                                      <i className="ti ti-corner-down-right text-gray-300 dark:text-gray-600 flex-shrink-0" aria-hidden="true" />
                                      <span className="truncate">{u.quality_issue}</span>
                                    </div>
                                    <div></div>
                                    <div className="truncate text-gray-400">{u.department || '—'}</div>
                                    <div className="font-mono text-gray-400 text-right">{formatCost(u.cost_approx)}</div>
                                    <div></div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )
                  ) : (
                    <>
                      <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns: TABLE_COLS }}>
                        <SortHeader label="SC#" sortKey="sc" sort={meetingSort} onToggle={toggleSort} />
                        <SortHeader label={t('ticket.issue')} sortKey="issue" sort={meetingSort} onToggle={toggleSort} />
                        <SortHeader label={t('ticket.project_name')} sortKey="project" sort={meetingSort} onToggle={toggleSort} />
                        <SortHeader label={t('ticket.department')} sortKey="department" sort={meetingSort} onToggle={toggleSort} />
                        <SortHeader label={t('ticket.cost')} sortKey="cost" sort={meetingSort} onToggle={toggleSort} right />
                        <div></div>
                      </div>
                      {sortedTickets.map(tk => (
                        <div key={tk?.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns: TABLE_COLS }}>
                          <div className="font-mono text-gray-400">{tk?.sc_number || '—'}</div>
                          <div className="truncate text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-500"
                            onClick={() => navigate(`/tickets/${tk?.id}?${ticketLinkParams()}`)}>
                            {tk?.quality_issue}
                          </div>
                          <div className="truncate text-gray-500 dark:text-gray-400">{customerOf(tk) || '—'}</div>
                          <div className="truncate text-gray-500 dark:text-gray-400" title={ticketDept(tk?.id)}>{ticketDept(tk?.id) || '—'}</div>
                          <div className="font-mono text-gray-400 text-right">{formatCost(getTicketCost(tk))}</div>
                          <button onClick={() => removeTicketMut.mutate(tk?.id)} className="text-red-400 hover:text-red-600 text-sm p-0 bg-transparent border-0 cursor-pointer">
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <i className="ti ti-list-check text-blue-500 text-sm" aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{t('meeting.actions_section')}</span>
                    {openAct > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium">{openAct} {t('meeting.open_actions_badge')}</span>
                    )}
                  </div>
                  <button onClick={() => setShowActionForm(true)} className="btn-primary py-1 px-2.5 text-xs">
                    <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('meeting.new_action')}
                  </button>
                </div>
                <div className="px-4 py-1">
                  {actionsQ.isError ? (
                    <QueryError queries={[actionsQ]} />
                  ) : !actions ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : actList.length === 0 && !showActionForm ? (
                    <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_actions')}</div>
                  ) : (
                    <>
                      {actList.length > 0 && (
                        <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns:'1fr 90px 80px 80px' }}>
                          <div>{t('meeting.action_label')}</div><div>{t('meeting.owner')}</div><div>{t('meeting.due_date')}</div><div>{t('ticket.status')}</div>
                        </div>
                      )}
                      {actList.map(a => {
                        const isLate = isPastDate(a.due) && a.status !== 'done'
                        const s = SS[isLate ? 'late' : (a.status || 'todo')]
                        return (
                          <div key={a.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'1fr 90px 80px 80px' }}>
                            <div className="text-gray-900 dark:text-gray-100 truncate">{a.text}</div>
                            <div className="text-gray-400">{a.owner || '—'}</div>
                            <div className="text-gray-400">{a.due ? formatDate(a.due) : '—'}</div>
                            <select value={a.status}
                              onChange={e => updateActionMut.mutate({ id: a.id, status: e.target.value })}
                              className="text-xs px-1.5 py-1 rounded-lg border-0 font-medium cursor-pointer focus:outline-none"
                              style={{ background: s.bg, color: s.color }}>
                              <option value="todo">{t('meeting.action_todo')}</option>
                              <option value="in_progress">{t('meeting.action_in_progress')}</option>
                              <option value="done">{t('meeting.action_done')}</option>
                            </select>
                          </div>
                        )
                      })}
                    </>
                  )}
                  {showActionForm && (
                    <div className="bg-gray-50 dark:bg-[#161B22] rounded-lg p-3 my-2 border border-gray-200 dark:border-gray-700">
                      <div className="grid gap-2 mb-2" style={{ gridTemplateColumns:'1fr 120px 120px' }}>
                        <input className="input" placeholder={t('meeting.action_label') + '...'} value={newAction.text} onChange={e => setNewAction(a => ({ ...a, text: e.target.value }))} />
                        <input className="input" placeholder={t('meeting.owner')} value={newAction.owner} onChange={e => setNewAction(a => ({ ...a, owner: e.target.value }))} />
                        <input className="input" type="date" value={newAction.due} onChange={e => setNewAction(a => ({ ...a, due: e.target.value }))} />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowActionForm(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
                        <button onClick={() => addActionMut.mutate()} className="btn-primary text-xs">{t('meeting.add')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <i className="ti ti-notes text-blue-500 text-sm" aria-hidden="true" />
                    {t('meeting.notes')}
                  </div>
                  <button onClick={() => saveNotesMut.mutate()} className="btn-primary py-1 px-2.5 text-xs">
                    <i className="ti ti-device-floppy text-xs" aria-hidden="true" /> {t('meeting.save_notes')}
                  </button>
                </div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  className="input resize-y h-20 text-xs"
                  placeholder={t('meeting.notes_placeholder')} />
              </div>
            </>
          )}
        </div>
      </div>

      {showTicketPicker && (
        <TicketPicker ticketsQ={allTicketsQ} linksQ={meetingLinksQ} selected={tickets} meetingMap={meetingMap} onAdd={(id) => addTicketMut.mutate(id)} onClose={() => setShowTicketPicker(false)} />
      )}

      {showNewMeeting && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]">
          <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 w-80 shadow-2xl p-6 relative">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">{t('meeting.new')}</div>
            <button onClick={() => setShowNewMeeting(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
            <div className="mb-4">
              <label className="label">{t('meeting.meeting_date')} *</label>
              <input type="date" className="input" value={newMeetingDate} onChange={e => setNewMeetingDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewMeeting(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
              <button onClick={() => createMeetingMut.mutate()} className="btn-primary text-xs">{t('meeting.create_meeting')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
