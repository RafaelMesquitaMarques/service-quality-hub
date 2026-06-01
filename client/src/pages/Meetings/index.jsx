import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
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

const DEPTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]

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

function TicketPicker({ tickets, selected, onAdd, onClose }) {
  const { t } = useTranslation()
  const [search, setSearch]   = useState('')
  const [dept,   setDept]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const selectedIds = new Set((selected || []).map(t => t?.id))
  const filtered = (tickets || []).filter(tk => {
    if (selectedIds.has(tk.id)) return false
    if (dept && tk.department !== dept) return false
    if (dateFrom && tk.issue_reception_date < dateFrom) return false
    if (dateTo   && tk.issue_reception_date > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      return tk.quality_issue?.toLowerCase().includes(q) || tk.sc_number?.toLowerCase().includes(q) || tk.ship_to?.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-8 z-[1000] overflow-y-auto">
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl shadow-2xl">
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
            {DEPTS.map(d => <option key={d}>{d}</option>)}
          </select>
          <input type="date" className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-[#161B22] focus:outline-none"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="px-5 py-1.5 text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
          {filtered.length} — {selectedIds.size} {t('meeting.already_selected')}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400">{t('meeting.no_tickets_found')}</div>
          ) : filtered.map(tk => (
            <div key={tk.id} className="grid gap-2 px-5 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'52px minmax(0,1fr) 80px 80px 64px 80px' }}>
              <div className="font-mono text-gray-400">{tk.sc_number || '—'}</div>
              <div className="truncate text-gray-900 dark:text-gray-100">{tk.quality_issue}</div>
              <div className="text-center px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">{tk.department}</div>
              <div className="text-gray-400">{tk.issue_reception_date?.slice(0,10) || '—'}</div>
              <div className="font-mono text-gray-400 text-right">{tk.cost_approx ? `$${Number(tk.cost_approx).toLocaleString()}` : '—'}</div>
              <button onClick={() => onAdd(tk.id)} className="btn-primary py-1 px-2 text-xs">{t('meeting.add')}</button>
            </div>
          ))}
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

  const isDark = document.documentElement.classList.contains('dark')
  const SS = isDark ? STATUS_STYLE : STATUS_STYLE_LIGHT

  const { data: meetings, isLoading: loadingMeetings } = useQuery({
    queryKey: ['meetings-v2'],
    queryFn: async () => {
      const { data, error } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: false })
      if (error) throw error
      return data || []
    },
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

  const tickets   = meetingTickets || []
  const actList   = actions        || []
  const totalCost = tickets.reduce((s, tk) => s + Number(tk?.cost_approx || 0), 0)
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

  return (
    <>
      <PageHeader
        title={t('meeting.title')}
        subtitle={t('meeting.subtitle')}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost text-xs"><i className="ti ti-file-export" aria-hidden="true" /> {t('meeting.export_pdf')}</button>
            <button className="btn-ghost text-xs"><i className="ti ti-table-export" aria-hidden="true" /> {t('meeting.export_excel')}</button>
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
            <div key={m.id} onClick={() => { setSelId(m.id); setNotes(m.notes || '') }}
              className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors"
              style={{
                background: selId === m.id ? (isDark ? '#1e3a5f' : '#eff6ff') : 'transparent',
                borderLeft: selId === m.id ? '3px solid #2563eb' : '3px solid transparent',
              }}>
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{weekLabel(m.meeting_date)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{formatDate(m.meeting_date)}</div>
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
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <i className="ti ti-chart-bar text-blue-500" aria-hidden="true" />
                    {t('meeting.kpis')} — {weekLabel(selMeeting?.meeting_date)}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(selMeeting?.meeting_date)}</div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { v: tickets.length, l: t('meeting.tickets_discussed'), c:'#3b82f6' },
                    { v: `$${Math.round(totalCost).toLocaleString()}`, l: t('meeting.sc_cost_week'), c:'#ef4444' },
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
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{t('meeting.tickets_section')}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">{tickets.length} {t('meeting.selected')}</span>
                  </div>
                  <button onClick={() => setShowTicketPicker(true)} className="btn-primary py-1 px-2.5 text-xs">
                    <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('meeting.add_ticket')}
                  </button>
                </div>
                <div className="px-4 py-1">
                  {tickets.length === 0 ? (
                    <div className="py-4 text-center text-xs text-gray-400">{t('meeting.no_tickets')}</div>
                  ) : (
                    <>
                      <div className="grid gap-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 dark:border-gray-800" style={{ gridTemplateColumns:'52px 1fr 80px 64px 28px' }}>
                        <div>SC#</div><div>{t('ticket.issue')}</div><div>Dept.</div><div className="text-right">{t('ticket.cost')}</div><div></div>
                      </div>
                      {tickets.map(tk => (
                        <div key={tk?.id} className="grid gap-2 py-2 border-b border-gray-100 dark:border-gray-800 text-xs items-center" style={{ gridTemplateColumns:'52px 1fr 80px 64px 28px' }}>
                          <div className="font-mono text-gray-400">{tk?.sc_number || '—'}</div>
                          <div className="truncate text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-500"
                            onClick={() => navigate(`/tickets/${tk?.id}?from=meeting&meetingId=${selId}`)}>
                            {tk?.quality_issue}
                          </div>
                          <div className="text-center px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">{tk?.department}</div>
                          <div className="font-mono text-gray-400 text-right">{tk?.cost_approx ? `$${Number(tk.cost_approx).toLocaleString()}` : '—'}</div>
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
        <TicketPicker tickets={allTickets || []} selected={tickets} onAdd={(id) => addTicketMut.mutate(id)} onClose={() => setShowTicketPicker(false)} />
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
