import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { ticketApi, CURRENT_FISCAL_YEAR } from '../../services/api'
import { PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  todo:       { bg:'#eff6ff', color:'#0c447c', label:'A faire' },
  in_progress:{ bg:'#fef3c7', color:'#633806', label:'En cours' },
  done:       { bg:'#eaf3de', color:'#27500a', label:'Complete' },
  late:       { bg:'#fcebeb', color:'#791f1f', label:'En retard' },
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

export default function MeetingsPage() {
  const navigate      = useNavigate()
  const queryClient   = useQueryClient()
  const [selId,  setSelId]   = useState(null)
  const [notes,  setNotes]   = useState('')
  const [newAction, setNewAction] = useState({ text:'', owner:'', due:'' })
  const [showActionForm, setShowActionForm] = useState(false)
  const [showTicketPicker, setShowTicketPicker] = useState(false)
  const [showNewMeeting, setShowNewMeeting] = useState(false)
  const [newMeetingDate, setNewMeetingDate] = useState('')

  // ── Meetings list ──────────────────────────────────────────────────────────
  const { data: meetings, isLoading: loadingMeetings } = useQuery({
    queryKey: ['meetings-v2'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('meeting_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // ── Selected meeting ───────────────────────────────────────────────────────
  const selMeeting = (meetings || []).find(m => m.id === selId)

  // ── Tickets for selected meeting ───────────────────────────────────────────
  const { data: meetingTickets } = useQuery({
    queryKey: ['meeting-tickets', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase
        .from('meeting_tickets')
        .select('ticket_id, tickets(*)')
        .eq('meeting_id', selId)
      if (error) return []
      return (data || []).map(r => r.tickets)
    },
    enabled: !!selId,
  })

  // ── Actions for selected meeting ───────────────────────────────────────────
  const { data: actions } = useQuery({
    queryKey: ['meeting-actions', selId],
    queryFn: async () => {
      if (!selId) return []
      const { data, error } = await supabase
        .from('meeting_actions')
        .select('*')
        .eq('meeting_id', selId)
        .order('created_at')
      if (error) return []
      return data || []
    },
    enabled: !!selId,
  })

  // ── Previous week actions (follow-up) ─────────────────────────────────────
  const prevMeeting = (meetings || []).find((m, i) => {
    const idx = (meetings || []).findIndex(x => x.id === selId)
    return i === idx + 1
  })
  const { data: prevActions } = useQuery({
    queryKey: ['meeting-actions', prevMeeting?.id],
    queryFn: async () => {
      if (!prevMeeting?.id) return []
      const { data, error } = await supabase
        .from('meeting_actions')
        .select('*')
        .eq('meeting_id', prevMeeting.id)
        .order('created_at')
      if (error) return []
      return data || []
    },
    enabled: !!prevMeeting?.id,
  })

  // ── All tickets (for picker) ───────────────────────────────────────────────
  const { data: allTickets } = useQuery({
    queryKey: ['tickets-picker'],
    queryFn: () => ticketApi.list({ fiscal_year: CURRENT_FISCAL_YEAR }).then(r => r.data.tickets),
    enabled: showTicketPicker,
  })

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const tickets   = meetingTickets || []
  const actList   = actions        || []
  const totalCost = tickets.reduce((s, t) => s + Number(t?.cost_approx || 0), 0)
  const openAct   = actList.filter(a => a.status !== 'done').length
  const doneAct   = actList.filter(a => a.status === 'done').length

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveNotesMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('meetings')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('id', selId)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries(['meetings-v2']); toast.success('Notes sauvegardees') },
    onError: () => toast.error('Erreur'),
  })

  const addActionMut = useMutation({
    mutationFn: async () => {
      if (!newAction.text) throw new Error('Action obligatoire')
      const { error } = await supabase.from('meeting_actions').insert({
        meeting_id: selId,
        text:   newAction.text,
        owner:  newAction.owner || null,
        due:    newAction.due   || null,
        status: 'todo',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['meeting-actions', selId])
      setNewAction({ text:'', owner:'', due:'' })
      setShowActionForm(false)
      toast.success('Action ajoutee')
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
      const { error } = await supabase.from('meeting_tickets').upsert({
        meeting_id: selId, ticket_id: ticketId
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['meeting-tickets', selId])
      toast.success('Ticket ajoute')
    },
  })

  const removeTicketMut = useMutation({
    mutationFn: async (ticketId) => {
      const { error } = await supabase.from('meeting_tickets')
        .delete().eq('meeting_id', selId).eq('ticket_id', ticketId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(['meeting-tickets', selId]),
  })

  const createMeetingMut = useMutation({
    mutationFn: async () => {
      if (!newMeetingDate) throw new Error('Date obligatoire')
      const { data, error } = await supabase.from('meetings').insert({
        meeting_date: newMeetingDate,
        type: 'weekly_review',
        notes: '',
      }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['meetings-v2'])
      setSelId(data.id)
      setShowNewMeeting(false)
      setNewMeetingDate('')
      toast.success('Reunion creee')
    },
    onError: (e) => toast.error(e.message),
  })

  const handleSelectMeeting = (m) => {
    setSelId(m.id)
    setNotes(m.notes || '')
  }

  const inp = {
    fontSize:13, padding:'6px 10px',
    border:'1px solid #d1d5db', borderRadius:7,
    background:'#fff', color:'#111827', outline:'none', boxSizing:'border-box',
  }

  return (
    <>
      <PageHeader
        title="Revue hebdomadaire"
        subtitle="Weekly Quality & Operations Review"
        actions={
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn-ghost" style={{ fontSize:13 }}>
              <i className="ti ti-file-export" aria-hidden="true" /> Export PDF
            </button>
            <button className="btn-ghost" style={{ fontSize:13 }}>
              <i className="ti ti-table-export" aria-hidden="true" /> Export Excel
            </button>
            <button className="btn-primary" onClick={() => setShowNewMeeting(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> Nouvelle reunion
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden flex">

        {/* ── Sidebar ── */}
        <div style={{ width:200, flexShrink:0, borderRight:'1px solid #e5e7eb', overflowY:'auto', background:'#fff' }}>
          <div style={{ padding:'8px 12px', fontSize:10, fontWeight:500, color:'#9ca3af', letterSpacing:'0.06em', textTransform:'uppercase', borderBottom:'1px solid #f3f4f6' }}>
            Semaines FY{CURRENT_FISCAL_YEAR}
          </div>
          {loadingMeetings ? (
            <div style={{ display:'flex', justifyContent:'center', padding:16 }}><Spinner /></div>
          ) : (meetings || []).map(m => (
            <div
              key={m.id}
              onClick={() => handleSelectMeeting(m)}
              style={{
                padding:'10px 12px', borderBottom:'1px solid #f3f4f6', cursor:'pointer',
                background: selId === m.id ? '#eff6ff' : 'transparent',
                borderLeft: selId === m.id ? '3px solid #2563eb' : '3px solid transparent',
              }}
            >
              <div style={{ fontSize:12, fontWeight:500, color:'#111827' }}>{weekLabel(m.meeting_date)}</div>
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>{formatDate(m.meeting_date)}</div>
            </div>
          ))}
          {(meetings || []).length === 0 && !loadingMeetings && (
            <div style={{ padding:16, fontSize:12, color:'#9ca3af', textAlign:'center' }}>
              Aucune reunion
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:10 }}>
          {!selId ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#9ca3af', fontSize:13 }}>
              Selectionnez une reunion ou creez-en une nouvelle
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="card p-4">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                    <i className="ti ti-chart-bar" aria-hidden="true" style={{ fontSize:14, color:'#2563eb' }} />
                    KPIs — {weekLabel(selMeeting?.meeting_date)}
                  </div>
                  <div style={{ fontSize:11, color:'#9ca3af' }}>{formatDate(selMeeting?.meeting_date)}</div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                  {[
                    { v: tickets.length,           l:'Tickets discutes', c:'#2563eb' },
                    { v: `$${Math.round(totalCost).toLocaleString()}`, l:'Cout SC semaine', c:'#ef4444' },
                    { v: openAct,                  l:'Actions ouvertes', c:'#f59e0b' },
                    { v: doneAct,                  l:'Completes',        c:'#22c55e' },
                  ].map(({ v, l, c }) => (
                    <div key={l} style={{ background:'#f9fafb', borderRadius:8, padding:'10px', textAlign:'center' }}>
                      <div style={{ fontSize:20, fontWeight:500, color:c }}>{v}</div>
                      <div style={{ fontSize:10, color:'#9ca3af', marginTop:2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Follow-up semaine precedente */}
              {(prevActions || []).length > 0 && (
                <div className="card">
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', gap:8 }}>
                    <i className="ti ti-clock-check" aria-hidden="true" style={{ fontSize:14, color:'#f59e0b' }} />
                    <span style={{ fontSize:12, fontWeight:500 }}>Follow-up semaine precedente</span>
                    <span style={{ fontSize:10, padding:'1px 6px', borderRadius:8, background:'#fef3c7', color:'#633806', fontWeight:500 }}>
                      {(prevActions || []).filter(a => a.status !== 'done').length} en attente
                    </span>
                  </div>
                  <div style={{ padding:'6px 14px' }}>
                    {(prevActions || []).map(a => {
                      const s = STATUS_STYLE[a.status] || STATUS_STYLE.todo
                      const isLate = a.due && new Date(a.due) < new Date() && a.status !== 'done'
                      const ss = isLate ? STATUS_STYLE.late : s
                      return (
                        <div key={a.id} style={{ display:'grid', gridTemplateColumns:'1fr 90px 80px 80px', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                          <div style={{ color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.text}</div>
                          <div style={{ fontSize:11, color:'#9ca3af' }}>{a.owner || '—'}</div>
                          <div style={{ fontSize:11, color:'#9ca3af' }}>{a.due ? formatDate(a.due) : '—'}</div>
                          <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background:ss.bg, color:ss.color, fontWeight:500, textAlign:'center' }}>{ss.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Tickets a discuter */}
              <div className="card">
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <i className="ti ti-clipboard-list" aria-hidden="true" style={{ fontSize:14, color:'#2563eb' }} />
                    <span style={{ fontSize:12, fontWeight:500 }}>Tickets a discuter</span>
                    <span style={{ fontSize:10, padding:'1px 6px', borderRadius:8, background:'#eff6ff', color:'#0c447c', fontWeight:500 }}>
                      {tickets.length} selectionnes
                    </span>
                  </div>
                  <button onClick={() => setShowTicketPicker(true)} style={{ padding:'4px 10px', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #2563eb', background:'#2563eb', color:'#fff', display:'inline-flex', alignItems:'center', gap:4 }}>
                    <i className="ti ti-plus" aria-hidden="true" style={{ fontSize:12 }} /> Ajouter ticket
                  </button>
                </div>
                <div style={{ padding:'4px 14px' }}>
                  {tickets.length === 0 ? (
                    <div style={{ padding:'16px 0', textAlign:'center', fontSize:12, color:'#9ca3af' }}>Aucun ticket selectionne</div>
                  ) : (
                    <>
                      <div style={{ display:'grid', gridTemplateColumns:'52px 1fr 80px 64px 28px', gap:8, padding:'6px 0', fontSize:10, fontWeight:500, color:'#9ca3af', borderBottom:'1px solid #f3f4f6' }}>
                        <div>SC#</div><div>Probleme</div><div>Dept.</div><div style={{ textAlign:'right' }}>Cout</div><div></div>
                      </div>
                      {tickets.map(t => (
                        <div key={t?.id} style={{ display:'grid', gridTemplateColumns:'52px 1fr 80px 64px 28px', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                          <div style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af' }}>{t?.sc_number || '—'}</div>
                          <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'#111827', cursor:'pointer' }} onClick={() => navigate(`/tickets/${t?.id}`)}>
                            {t?.quality_issue}
                          </div>
                          <div style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'#eff6ff', color:'#0c447c', fontWeight:500, textAlign:'center' }}>{t?.department}</div>
                          <div style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af', textAlign:'right' }}>
                            {t?.cost_approx ? `$${Number(t.cost_approx).toLocaleString()}` : '—'}
                          </div>
                          <button onClick={() => removeTicketMut.mutate(t?.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:14, padding:0 }}>
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="card">
                <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <i className="ti ti-list-check" aria-hidden="true" style={{ fontSize:14, color:'#2563eb' }} />
                    <span style={{ fontSize:12, fontWeight:500 }}>Actions de cette reunion</span>
                    {openAct > 0 && (
                      <span style={{ fontSize:10, padding:'1px 6px', borderRadius:8, background:'#fef3c7', color:'#633806', fontWeight:500 }}>
                        {openAct} ouvertes
                      </span>
                    )}
                  </div>
                  <button onClick={() => setShowActionForm(true)} style={{ padding:'4px 10px', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #2563eb', background:'#2563eb', color:'#fff', display:'inline-flex', alignItems:'center', gap:4 }}>
                    <i className="ti ti-plus" aria-hidden="true" style={{ fontSize:12 }} /> Nouvelle action
                  </button>
                </div>
                <div style={{ padding:'4px 14px' }}>
                  {actList.length === 0 && !showActionForm ? (
                    <div style={{ padding:'16px 0', textAlign:'center', fontSize:12, color:'#9ca3af' }}>Aucune action enregistree</div>
                  ) : (
                    <>
                      {actList.length > 0 && (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 80px 80px', gap:8, padding:'6px 0', fontSize:10, fontWeight:500, color:'#9ca3af', borderBottom:'1px solid #f3f4f6' }}>
                          <div>Action</div><div>Responsable</div><div>Echeance</div><div>Statut</div>
                        </div>
                      )}
                      {actList.map(a => {
                        const isLate = a.due && new Date(a.due) < new Date() && a.status !== 'done'
                        const s = isLate ? STATUS_STYLE.late : (STATUS_STYLE[a.status] || STATUS_STYLE.todo)
                        return (
                          <div key={a.id} style={{ display:'grid', gridTemplateColumns:'1fr 90px 80px 80px', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                            <div style={{ color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.text}</div>
                            <div style={{ fontSize:11, color:'#9ca3af' }}>{a.owner || '—'}</div>
                            <div style={{ fontSize:11, color:'#9ca3af' }}>{a.due ? formatDate(a.due) : '—'}</div>
                            <select
                              value={a.status}
                              onChange={e => updateActionMut.mutate({ id: a.id, status: e.target.value })}
                              style={{ fontSize:10, padding:'2px 4px', borderRadius:6, border:'1px solid #e5e7eb', background:s.bg, color:s.color, fontWeight:500, cursor:'pointer' }}
                            >
                              <option value="todo">A faire</option>
                              <option value="in_progress">En cours</option>
                              <option value="done">Complete</option>
                            </select>
                          </div>
                        )
                      })}
                    </>
                  )}
                  {showActionForm && (
                    <div style={{ background:'#f9fafb', borderRadius:8, padding:12, margin:'8px 0', border:'1px solid #e5e7eb' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 120px', gap:8, marginBottom:8 }}>
                        <input style={{ ...inp, width:'100%' }} placeholder="Description de l'action..." value={newAction.text} onChange={e => setNewAction(a => ({ ...a, text: e.target.value }))} />
                        <input style={{ ...inp, width:'100%' }} placeholder="Responsable" value={newAction.owner} onChange={e => setNewAction(a => ({ ...a, owner: e.target.value }))} />
                        <input style={{ ...inp, width:'100%' }} type="date" value={newAction.due} onChange={e => setNewAction(a => ({ ...a, due: e.target.value }))} />
                      </div>
                      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                        <button onClick={() => setShowActionForm(false)} style={{ padding:'5px 12px', borderRadius:6, fontSize:12, cursor:'pointer', border:'1px solid #e5e7eb', background:'#fff', color:'#6b7280' }}>Annuler</button>
                        <button onClick={() => addActionMut.mutate()} style={{ padding:'5px 12px', borderRadius:6, fontSize:12, cursor:'pointer', border:'none', background:'#2563eb', color:'#fff' }}>Ajouter</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="card p-4">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                    <i className="ti ti-notes" aria-hidden="true" style={{ fontSize:14, color:'#2563eb' }} />
                    Notes de reunion
                  </div>
                  <button onClick={() => saveNotesMut.mutate()} style={{ padding:'4px 10px', borderRadius:6, fontSize:12, cursor:'pointer', border:'none', background:'#2563eb', color:'#fff', display:'inline-flex', alignItems:'center', gap:4 }}>
                    <i className="ti ti-device-floppy" aria-hidden="true" style={{ fontSize:12 }} /> Sauvegarder
                  </button>
                </div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:7, padding:'8px 10px', fontSize:12, color:'#111827', background:'#fff', resize:'vertical', height:90, outline:'none', boxSizing:'border-box' }}
                  placeholder="Decisions prises, points importants, observations..."
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Ticket picker modal ── */}
      {showTicketPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'32px 16px', zIndex:1000, overflowY:'auto' }}>
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', width:'100%', maxWidth:600, boxShadow:'0 24px 48px rgba(0,0,0,0.18)' }}>
            <div style={{ padding:'14px 44px 12px 20px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:14, fontWeight:500 }}>Ajouter des tickets a la reunion</div>
              <button onClick={() => setShowTicketPicker(false)} style={{ position:'absolute', top:16, right:16, background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18 }}>X</button>
            </div>
            <div style={{ maxHeight:400, overflowY:'auto', padding:'8px 0' }}>
              {(allTickets || []).filter(t => !tickets.find(mt => mt?.id === t.id)).map(t => (
                <div key={t.id} style={{ display:'grid', gridTemplateColumns:'1fr 80px 64px 80px', gap:8, alignItems:'center', padding:'8px 20px', borderBottom:'1px solid #f3f4f6', fontSize:12 }}>
                  <div style={{ color:'#111827', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    <span style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af', marginRight:8 }}>{t.sc_number}</span>
                    {t.quality_issue}
                  </div>
                  <div style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'#eff6ff', color:'#0c447c', fontWeight:500, textAlign:'center' }}>{t.department}</div>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af', textAlign:'right' }}>
                    {t.cost_approx ? `$${Number(t.cost_approx).toLocaleString()}` : '—'}
                  </div>
                  <button onClick={() => { addTicketMut.mutate(t.id); }} style={{ padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer', border:'1px solid #2563eb', background:'#2563eb', color:'#fff' }}>
                    Ajouter
                  </button>
                </div>
              ))}
            </div>
            <div style={{ padding:'12px 20px', borderTop:'1px solid #e5e7eb', textAlign:'right' }}>
              <button onClick={() => setShowTicketPicker(false)} style={{ padding:'7px 16px', borderRadius:7, fontSize:13, cursor:'pointer', border:'1px solid #e5e7eb', background:'#fff', color:'#374151' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New meeting modal ── */}
      {showNewMeeting && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', width:360, boxShadow:'0 24px 48px rgba(0,0,0,0.18)', padding:24, position:'relative' }}>
            <div style={{ fontSize:14, fontWeight:500, marginBottom:16 }}>Nouvelle reunion</div>
            <button onClick={() => setShowNewMeeting(false)} style={{ position:'absolute', top:16, right:16, background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18 }}>X</button>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Date de la reunion *</label>
              <input type="date" style={{ ...inp, width:'100%' }} value={newMeetingDate} onChange={e => setNewMeetingDate(e.target.value)} />
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button onClick={() => setShowNewMeeting(false)} style={{ padding:'7px 14px', borderRadius:7, fontSize:13, cursor:'pointer', border:'1px solid #e5e7eb', background:'#fff', color:'#6b7280' }}>Annuler</button>
              <button onClick={() => createMeetingMut.mutate()} style={{ padding:'7px 16px', borderRadius:7, fontSize:13, cursor:'pointer', border:'none', background:'#2563eb', color:'#fff', fontWeight:500 }}>
                Creer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
