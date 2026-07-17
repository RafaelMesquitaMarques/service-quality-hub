import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, fetchLineCostTotals, CURRENT_FISCAL_YEAR } from '../../services/api'
import { useThemeStore } from '../../store/themeStore'
import { PageHeader, Spinner } from '../../components/ui'
import { DEPARTMENTS } from '../../constants/taxonomy'
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


function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-CA', { day:'2-digit', month:'2-digit', year:'numeric' })
}
function weekLabel(d) {
  if (!d) return ''
  const dt = new Date(d)
  const mm = String(dt.getMonth() + 1).padStart(2,'0')
  const dd = String(dt.getDate()).padStart(2,'0')
  return `Week ${mm}-${dd}`
}

// Dropdown multi-sélection (checkboxes) — même gabarit visuel que les anciens
// <select> du filtre : icône à gauche, chevron à droite, surbrillance bleue si actif.
// Les options sont dérivées des occurrences de la réunion : le panneau explicite
// les états « chargement » et « aucune valeur » plutôt que d'afficher du vide.
function MultiSelect({ icon, allLabel, options, value, onChange, loading }) {
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
  const label  = !active ? allLabel : value.length === 1 ? value[0] : `${value[0]} +${value.length - 1}`

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <i className={`ti ${icon} text-sm absolute left-2.5 pointer-events-none ${active ? 'text-blue-500' : 'text-gray-400'}`} aria-hidden="true" />
      <button type="button" onClick={() => setOpen(o => !o)} title={active ? value.join(', ') : allLabel}
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
              {loading ? t('common.loading') : t('meeting.filter_no_options')}
            </div>
          ) : options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 whitespace-nowrap">
              <input type="checkbox" className="accent-blue-600 cursor-pointer" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function TicketPicker({ tickets, selected, meetingMap, onAdd, onClose }) {
  const { t } = useTranslation()
  const [search, setSearch]   = useState('')
  const [dept,   setDept]     = useState('')
  const [status, setStatus]   = useState('quality_meeting')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const selectedIds = new Set((selected || []).map(t => t?.id))
  const filtered = (tickets || []).filter(tk => {
    if (selectedIds.has(tk.id)) return false
    if (dept && tk.department !== dept) return false
    if (status && tk.status !== status) return false
    if (dateFrom && tk.issue_reception_date < dateFrom) return false
    if (dateTo   && tk.issue_reception_date > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      return tk.quality_issue?.toLowerCase().includes(q) || tk.sc_number?.toLowerCase().includes(q) || tk.project_name?.toLowerCase().includes(q)
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
          <select className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none min-w-36"
            value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">{t('meeting.all_depts')}</option>
            {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
          </select>
          <select className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none min-w-36"
            value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('meeting.all_statuses')}</option>
            {['not_started','service_desk','quality_meeting','completed','cancelled'].map(s => (
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
        <div className="max-h-[65vh] overflow-y-auto">
          {filtered.length === 0 ? (
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
              <div className="truncate text-gray-500 dark:text-gray-400">{tk.project_name || '—'}</div>
              <div className="text-gray-400">{tk.issue_reception_date?.slice(0,10) || '—'}</div>
              <div className="font-mono text-gray-400 text-right">{tk.cost_approx ? `$${Math.round(Number(tk.cost_approx)).toLocaleString()}` : '—'}</div>
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
  const [selId,  setSelId]   = useState(null)
  const [notes,  setNotes]   = useState('')
  const [newAction, setNewAction] = useState({ text:'', owner:'', due:'' })
  const [showActionForm,   setShowActionForm]   = useState(false)
  const [showTicketPicker, setShowTicketPicker] = useState(false)
  const [showNewMeeting,   setShowNewMeeting]   = useState(false)
  const [newMeetingDate,   setNewMeetingDate]   = useState('')
  const [meetingDepts,     setMeetingDepts]     = useState([])  // filtre par départements (multi, niveau ligne)
  const [meetingPlants,    setMeetingPlants]    = useState([])  // filtre par usines (multi, niveau ligne)

  const { dark: isDark } = useThemeStore()
  const SS = isDark ? STATUS_STYLE : STATUS_STYLE_LIGHT

const { data: meetings, isLoading: loadingMeetings } = useQuery({
  queryKey: ['meetings-v2'],
  queryFn: async () => {
    const { data, error } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: false })
    if (error) throw error
    return data || []
  },
  staleTime: 10 * 60 * 1000, // 10 minutos
  refetchOnWindowFocus: false,
})

  useEffect(() => {
    if (!meetings || meetings.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const mid = params.get('meetingId')
    if (mid) {
      const m = meetings.find(x => x.id === mid)
      if (m) { setSelId(m.id); setNotes(m.notes || '') }
    }
  }, [meetings])

  // Repartir de « tous les départements / toutes les usines » quand on change de réunion
  useEffect(() => { setMeetingDepts([]); setMeetingPlants([]) }, [selId])

  const selMeeting = (meetings || []).find(m => m.id === selId)

  const { data: meetingTickets } = useQuery({
    queryKey: ['meeting-tickets', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase.from('meeting_tickets').select('ticket_id, tickets(*)').eq('meeting_id', selId)
      if (error) return []
      return (data || []).map(r => r.tickets)
    },
    enabled: !!selId,
  })

  const { data: actions } = useQuery({
    queryKey: ['meeting-actions', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase.from('meeting_actions').select('*').eq('meeting_id', selId).order('created_at')
      if (error) return []
      return data || []
    },
    enabled: !!selId,
  })

  const prevMeeting = (meetings || []).find((m, i) => i === (meetings || []).findIndex(x => x.id === selId) + 1)

  const { data: prevActions } = useQuery({
    queryKey: ['meeting-actions', prevMeeting?.id],
    queryFn: async () => {
      if (!prevMeeting?.id) return []
      const { data, error } = await supabase.from('meeting_actions').select('*').eq('meeting_id', prevMeeting.id).order('created_at')
      if (error) return []
      return data || []
    },
    enabled: !!prevMeeting?.id,
  })

  const { data: allTickets } = useQuery({
    queryKey: ['tickets-picker'],
    queryFn: () => ticketApi.list({ fiscal_year: 'all' }).then(r => r.data.tickets),
    enabled: showTicketPicker,
    staleTime: 0,
  })

  // Occurrences déjà rattachées à une (autre) réunion — pour le badge + la
  // confirmation « déjà en réunion » dans le sélecteur.
  const { data: meetingLinks } = useQuery({
    queryKey: ['all-meeting-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_tickets')
        .select('ticket_id, meeting_id, meetings(meeting_date)')
      if (error) return []
      return data || []
    },
    enabled: showTicketPicker,
    staleTime: 60 * 1000,
  })

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
  const { data: lineCosts } = useQuery({
    queryKey: ['line-costs-meeting', tickets.map(t => t?.id)],
    queryFn: () => fetchLineCostTotals(tickets.map(t => t?.id)),
    enabled: tickets.length > 0,
  })

  const getTicketCost = (tk) => {
    const lineTotal = lineCosts?.[tk?.id]
    if (lineTotal && lineTotal > 0) return lineTotal
    return tk?.cost_approx ? Number(tk.cost_approx) : 0
  }

  // Lignes (occurrence_lines) des occurrences de la réunion — pour la vue/filtre
  // par département (chaque ligne a son propre département + coût).
  const { data: meetingLines } = useQuery({
    queryKey: ['meeting-lines', selId, tickets.map(t => t?.id).filter(Boolean).join(',')],
    queryFn: async () => {
      const ids = tickets.map(t => t?.id).filter(Boolean)
      if (!ids.length) return []
      const { data, error } = await supabase.from('occurrence_lines')
        .select('id, occurrence_id, quality_issue, cost_approx, department, plant')
        .in('occurrence_id', ids)
      if (error) return []
      return data || []
    },
    enabled: tickets.length > 0,
  })

  const ticketById  = Object.fromEntries(tickets.map(tk => [tk?.id, tk]))
  const allLines    = meetingLines || []

  // Unités de coût/problème par département, calquées sur le Dashboard : le
  // département est porté par la LIGNE si elle a un coût, sinon on retombe sur
  // le département au niveau OCCURRENCE. Sans ce repli, les occurrences classées
  // au niveau header (ou sans lignes) n'affichaient aucun département.
  const units = tickets.flatMap(tk => {
    const ls = allLines.filter(l => l.occurrence_id === tk?.id)
    const lineSum = ls.reduce((s, l) => s + Number(l.cost_approx || 0), 0)
    if (lineSum > 0) {
      return ls.map(l => ({
        id: l.id, occurrence_id: tk?.id,
        quality_issue: l.quality_issue || tk?.quality_issue,
        cost_approx: Number(l.cost_approx || 0),
        department: l.department || tk?.department || null,
        plant: l.plant || tk?.plant || null,
      }))
    }
    return [{
      id: tk?.id, occurrence_id: tk?.id,
      quality_issue: tk?.quality_issue,
      cost_approx: getTicketCost(tk),
      department: tk?.department || null,
      plant: tk?.plant || null,
    }]
  })

  // Occurrences pas encore chargées, ou lignes pas encore chargées → les
  // dropdowns affichent « Chargement... » plutôt qu'un panneau vide.
  const filtersLoading = !meetingTickets || (tickets.length > 0 && !meetingLines)

  const deptOptions = [...new Set(units.map(u => u.department).filter(Boolean))].sort()
  const deptFilter  = meetingDepts.filter(d => deptOptions.includes(d))    // ignore les absents
  const plantOptions = [...new Set(units.map(u => u.plant).filter(Boolean))].sort()
  const plantFilter  = meetingPlants.filter(p => plantOptions.includes(p)) // ignore les absentes
  const anyFilter    = deptFilter.length > 0 || plantFilter.length > 0
  const filterLabel  = [...deptFilter, ...plantFilter].join(' · ')
  const filteredUnits = units.filter(u =>
    (!deptFilter.length  || deptFilter.includes(u.department)) &&
    (!plantFilter.length || plantFilter.includes(u.plant))
  )

  // Départements distincts par occurrence (pour la colonne « Département »)
  const deptByTicket = units.reduce((m, u) => {
    if (u.department) (m[u.occurrence_id] ||= new Set()).add(u.department)
    return m
  }, {})
  const ticketDept = (id) => [...(deptByTicket[id] || [])].sort().join(', ')

  const totalCost   = tickets.reduce((s, tk) => s + getTicketCost(tk), 0)
  const deptUnitCost = filteredUnits.reduce((s, u) => s + Number(u.cost_approx || 0), 0)
  // KPIs : reflètent le filtre actif (département / usine), sinon toute la réunion
  const displayedCost  = anyFilter ? deptUnitCost : totalCost
  const displayedCount = anyFilter ? filteredUnits.length : tickets.length
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
  })

  const addTicketMut = useMutation({
    mutationFn: async (ticketId) => {
      const { error } = await supabase.from('meeting_tickets').upsert({ meeting_id: selId, ticket_id: ticketId })
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries(['meeting-tickets', selId]); toast.success(t('meeting.add_ticket')) },
  })

  const removeTicketMut = useMutation({
    mutationFn: async (ticketId) => {
      const { error } = await supabase.from('meeting_tickets').delete().eq('meeting_id', selId).eq('ticket_id', ticketId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(['meeting-tickets', selId]),
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

  const handleExportExcel = () => {
    if (!selMeeting) return
    const esc  = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const row  = (cells) => cells.map(esc).join(',')
    // Respecte le filtre actif (département / usine) : exporte les lignes filtrées, sinon les occurrences.
    const ticketRows = anyFilter
      ? filteredUnits.map(u => row([ticketById[u.occurrence_id]?.sc_number, u.quality_issue, u.department, Math.round(Number(u.cost_approx || 0))]))
      : tickets.map(tk => row([tk?.sc_number, tk?.quality_issue, ticketDept(tk?.id) || tk?.department, Math.round(getTicketCost(tk))]))
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

  return (
    <>
      <PageHeader
        title={t('meeting.title')}
        subtitle={t('meeting.subtitle')}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={handleExportExcel} disabled={!selId}
              title={!selId ? t('meeting.select_prompt') : ''}>
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
            {t('meeting.weeks')}{CURRENT_FISCAL_YEAR}
          </div>
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
          {(meetings || []).length === 0 && !loadingMeetings && (
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
                    <MultiSelect icon="ti-building" allLabel={t('meeting.all_depts')}
                      options={deptOptions} value={deptFilter} onChange={setMeetingDepts} loading={filtersLoading} />
                    <MultiSelect icon="ti-building-factory-2" allLabel={t('meeting.all_plants')}
                      options={plantOptions} value={plantFilter} onChange={setMeetingPlants} loading={filtersLoading} />
                    <div className="text-xs text-gray-400">{formatDate(selMeeting?.meeting_date)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { v: displayedCount, l: anyFilter ? t('meeting.problem_lines') : t('meeting.tickets_discussed'), c:'#3b82f6' },
                    { v: `$${Math.round(displayedCost).toLocaleString()}`, l: t('meeting.sc_cost_week'), c:'#ef4444' },
                    { v: openAct, l: t('meeting.open_actions'), c:'#f59e0b' },
                    { v: doneAct, l: t('meeting.completed_actions'), c:'#22c55e' },
                  ].map(({ v, l, c }) => (
                    <div key={l} className="bg-gray-50 dark:bg-[#161B22] rounded-lg p-2.5 text-center">
                      <div className="text-xl font-medium" style={{ color: c }}>{v}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
              </div>

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
                      const isLate = a.due && new Date(a.due) < new Date() && a.status !== 'done'
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
                      {anyFilter ? `${t('meeting.problem_lines')} · ${filterLabel}` : t('meeting.tickets_section')}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                      {anyFilter ? filteredUnits.length : `${tickets.length} ${t('meeting.selected')}`}
                    </span>
                  </div>
                  <button onClick={() => setShowTicketPicker(true)} className="btn-primary py-1 px-2.5 text-xs">
                    <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('meeting.add_ticket')}
                  </button>
                </div>
                <div className="px-4 py-1">
                  {tickets.length === 0 ? (
                    <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_tickets')}</div>
                  ) : anyFilter ? (
                    /* Vue filtrée — problèmes correspondant au département / à l'usine sélectionné */
                    filteredUnits.length === 0 ? (
                      <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_tickets')}</div>
                    ) : (
                      <>
                        <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns:'52px 1fr 64px' }}>
                          <div>SC#</div><div>{t('ticket.issue')}</div><div className="text-right">{t('ticket.cost')}</div>
                        </div>
                        {filteredUnits.map(u => {
                          const parent = ticketById[u.occurrence_id]
                          return (
                            <div key={u.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'52px 1fr 64px' }}>
                              <div className="font-mono text-gray-400">{parent?.sc_number || '—'}</div>
                              <div className="truncate text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-500"
                                onClick={() => navigate(`/tickets/${u.occurrence_id}?from=meeting&meetingId=${selId}`)}>
                                {u.quality_issue || parent?.quality_issue}
                              </div>
                              <div className="font-mono text-gray-400 text-right">
                                {Number(u.cost_approx) > 0 ? `$${Math.round(Number(u.cost_approx)).toLocaleString()}` : '—'}
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )
                  ) : (
                    <>
                      <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns:'52px 1fr 140px 120px 64px 28px' }}>
                        <div>SC#</div><div>{t('ticket.issue')}</div><div>{t('ticket.project_name')}</div><div>{t('ticket.department')}</div><div className="text-right">{t('ticket.cost')}</div><div></div>
                      </div>
                      {tickets.map(tk => (
                        <div key={tk?.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'52px 1fr 140px 120px 64px 28px' }}>
                          <div className="font-mono text-gray-400">{tk?.sc_number || '—'}</div>
                          <div className="truncate text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-500"
                            onClick={() => navigate(`/tickets/${tk?.id}?from=meeting&meetingId=${selId}`)}>
                            {tk?.quality_issue}
                          </div>
                          <div className="truncate text-gray-500 dark:text-gray-400">{tk?.project_name || '—'}</div>
                          <div className="truncate text-gray-500 dark:text-gray-400" title={ticketDept(tk?.id)}>{ticketDept(tk?.id) || '—'}</div>
                          <div className="font-mono text-gray-400 text-right">
                            {getTicketCost(tk) > 0 ? `$${Math.round(getTicketCost(tk)).toLocaleString()}` : '—'}
                          </div>
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
                  {actList.length === 0 && !showActionForm ? (
                    <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_actions')}</div>
                  ) : (
                    <>
                      {actList.length > 0 && (
                        <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns:'1fr 90px 80px 80px' }}>
                          <div>{t('meeting.action_label')}</div><div>{t('meeting.owner')}</div><div>{t('meeting.due_date')}</div><div>{t('ticket.status')}</div>
                        </div>
                      )}
                      {actList.map(a => {
                        const isLate = a.due && new Date(a.due) < new Date() && a.status !== 'done'
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
        <TicketPicker tickets={allTickets || []} selected={tickets} meetingMap={meetingMap} onAdd={(id) => addTicketMut.mutate(id)} onClose={() => setShowTicketPicker(false)} />
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
