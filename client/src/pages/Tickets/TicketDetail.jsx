import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { supabase } from '../../services/supabase'
import { StatusBadge, BrandTag, PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const STATUS_OPTS = ['not_started','wip','completed','cancelled']
const STATUS_LBL  = { not_started:'Not started', wip:'WIP', completed:'Completed', cancelled:'Cancelled' }
const STATUS_CLR  = {
  not_started: { bg:'#f3f4f6', color:'#6b7280' },
  wip:         { bg:'#fef3c7', color:'#633806' },
  completed:   { bg:'#eaf3de', color:'#27500a' },
  cancelled:   { bg:'#fcebeb', color:'#791f1f' },
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-CA', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export default function TicketDetail() {
  const { id }          = useParams()
  const { t }           = useTranslation()
  const navigate        = useNavigate()
  const queryClient     = useQueryClient()
  const fileRef         = useRef(null)

  const [searchParams]  = useState(() => new URLSearchParams(window.location.search))
  const fromMeeting     = searchParams.get('from') === 'meeting'
  const meetingId       = searchParams.get('meetingId')

  const [rootCause,    setRootCause]    = useState('')
  const [corrective,   setCorrective]   = useState('')
  const [initialized,  setInitialized]  = useState(false)

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketApi.get(id).then(r => r.data),
    onSuccess: (data) => {
      if (!initialized) {
        setRootCause(data.root_cause || '')
        setCorrective(data.corrective_action || '')
        setInitialized(true)
      }
    }
  })

  const { data: photos } = useQuery({
    queryKey: ['ticket-photos', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_photos')
        .select('*')
        .eq('ticket_id', id)
        .order('created_at')
      if (error) return []
      return data || []
    },
  })

  const updateMut = useMutation({
    mutationFn: (payload) => ticketApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['ticket', id])
      toast.success('Ticket mis a jour')
    },
    onError: () => toast.error('Erreur'),
  })

  const uploadPhotoMut = useMutation({
    mutationFn: async (file) => {
      const ext  = file.name.split('.').pop()
      const path = `tickets/${id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('ticket-photos').upload(path, file)
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage
        .from('ticket-photos').getPublicUrl(path)
      const { error: dbErr } = await supabase.from('ticket_photos').insert({
        ticket_id: id,
        url: urlData.publicUrl,
        name: file.name,
        path,
      })
      if (dbErr) throw dbErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['ticket-photos', id])
      toast.success('Photo ajoutee')
    },
    onError: () => toast.error('Erreur upload'),
  })

  const deletePhotoMut = useMutation({
    mutationFn: async ({ photoId, path }) => {
      await supabase.storage.from('ticket-photos').remove([path])
      await supabase.from('ticket_photos').delete().eq('id', photoId)
    },
    onSuccess: () => queryClient.invalidateQueries(['ticket-photos', id]),
  })

  const handleSave = () => {
    updateMut.mutate({ root_cause: rootCause, corrective_action: corrective })
  }

  const handleFileUpload = (e) => {
    Array.from(e.target.files).forEach(file => uploadPhotoMut.mutate(file))
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  if (!ticket) return null

  const sc = STATUS_CLR[ticket.status] || STATUS_CLR.not_started

  return (
    <>
      <PageHeader
        title={ticket.quality_issue}
        subtitle={`SC# ${ticket.sc_number || '—'} · ${formatDate(ticket.issue_reception_date)}`}
        actions={
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn-ghost" onClick={() => fromMeeting ? navigate(`/meetings?meetingId=${meetingId}`) : navigate(-1)}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> Retour
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={updateMut.isPending}>
              <i className="ti ti-device-floppy" aria-hidden="true" />
              {updateMut.isPending ? 'Saving...' : 'Sauvegarder'}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:1100 }}>

          {/* ── COL 1 ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Informations */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Informations
                </div>
                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:8, fontWeight:500, background:sc.bg, color:sc.color }}>
                  {STATUS_LBL[ticket.status] || ticket.status}
                </span>
              </div>
              <div style={{ padding:'10px 14px' }}>
                {[
                  ['Ship To',       ticket.ship_to],
                  ['Sold To',       ticket.sold_to],
                  ['Brand',         ticket.brand],
                  ['Departement',   ticket.department],
                  ['Categorie',     ticket.categories],
                  ['Plant',         ticket.plant],
                  ['REF SO',        ticket.ref_so],
                  ['SC#',           ticket.sc_number],
                  ['Qte affectee',  ticket.affected_qty || ticket.qty_affected],
                  ['Cout approx.',  ticket.cost_approx ? `$${Number(ticket.cost_approx).toLocaleString()}` : null],
                  ['Date reception',formatDate(ticket.issue_reception_date)],
                  ['Date reunion',  formatDate(ticket.meeting_date)],
                ].map(([label, value]) => value ? (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'0.5px solid #f3f4f6', fontSize:12 }}>
                    <span style={{ fontSize:11, color:'#9ca3af' }}>{label}</span>
                    <span style={{ color:'#111827', fontWeight: label === 'Cout approx.' ? 500 : 400, color: label === 'Cout approx.' ? '#ef4444' : '#111827' }}>
                      {label === 'Departement' ? (
                        <span style={{ fontSize:10, padding:'1px 7px', borderRadius:8, background:'#eff6ff', color:'#0c447c', fontWeight:500 }}>{value}</span>
                      ) : value}
                    </span>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* Statut */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Statut
                </div>
              </div>
              <div style={{ padding:'10px 14px', display:'flex', gap:6 }}>
                {STATUS_OPTS.map(s => (
                  <button
                    key={s}
                    onClick={() => updateMut.mutate({ status: s })}
                    style={{
                      flex:1, padding:'7px 4px', borderRadius:7, fontSize:11, cursor:'pointer',
                      border: ticket.status === s ? '1px solid #2563eb' : '1px solid #e5e7eb',
                      background: ticket.status === s ? '#2563eb' : '#fff',
                      color: ticket.status === s ? '#fff' : '#6b7280',
                      fontWeight: ticket.status === s ? 500 : 400,
                      transition:'all 0.12s',
                    }}
                  >
                    {STATUS_LBL[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Historique */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-history" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Historique
                </div>
              </div>
              <div style={{ padding:'10px 14px' }}>
                {[
                  { dot:'#2563eb', time: formatDate(ticket.updated_at || ticket.created_at), text:'Derniere modification' },
                  { dot:'#9ca3af', time: formatDate(ticket.issue_reception_date), text:`Ticket cree · SC# ${ticket.sc_number || '—'}` },
                ].map((h, i) => (
                  <div key={i} style={{ display:'flex', gap:10, padding:'5px 0', borderBottom:'0.5px solid #f3f4f6', fontSize:11 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:h.dot, marginTop:3, flexShrink:0 }} />
                    <div style={{ color:'#9ca3af', minWidth:80 }}>{h.time}</div>
                    <div style={{ color:'#6b7280' }}>{h.text}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* ── COL 2 ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Description */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-file-description" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Description du probleme
                </div>
              </div>
              <div style={{ padding:'12px 14px' }}>
                <div style={{ fontSize:12, color:'#374151', lineHeight:1.7, background:'#f9fafb', borderRadius:7, padding:'10px 12px' }}>
                  {ticket.quality_issue}
                </div>
              </div>
            </div>

            {/* Resolution */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-tool" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Resolution
                </div>
              </div>
              <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, color:'#9ca3af', display:'block', marginBottom:4 }}>Cause racine</label>
                  <textarea
                    rows={3}
                    value={rootCause}
                    onChange={e => setRootCause(e.target.value)}
                    placeholder="Decrire la cause racine..."
                    style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:7, padding:'8px 10px', fontSize:12, color:'#111827', background:'#fff', resize:'vertical', outline:'none', boxSizing:'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize:11, color:'#9ca3af', display:'block', marginBottom:4 }}>Action corrective</label>
                  <textarea
                    rows={3}
                    value={corrective}
                    onChange={e => setCorrective(e.target.value)}
                    placeholder="Action corrective mise en place..."
                    style={{ width:'100%', border:'1px solid #e5e7eb', borderRadius:7, padding:'8px 10px', fontSize:12, color:'#111827', background:'#fff', resize:'vertical', outline:'none', boxSizing:'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* Photos & Annexes */}
            <div className="card">
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:12, fontWeight:500, color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
                  <i className="ti ti-photo" aria-hidden="true" style={{ fontSize:13, color:'#2563eb' }} />
                  Photos & Annexes
                </div>
                <label style={{ padding:'3px 8px', borderRadius:6, fontSize:11, cursor:'pointer', border:'1px solid #2563eb', background:'#2563eb', color:'#fff', display:'inline-flex', alignItems:'center', gap:4 }}>
                  <i className="ti ti-plus" aria-hidden="true" style={{ fontSize:11 }} /> Ajouter
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" multiple onChange={handleFileUpload} style={{ display:'none' }} />
                </label>
              </div>
              <div style={{ padding:'12px 14px' }}>
                {(photos || []).length === 0 ? (
                  <label style={{ display:'block', border:'1.5px dashed #d1d5db', borderRadius:8, padding:'20px', textAlign:'center', cursor:'pointer', background:'#f9fafb' }}>
                    <div style={{ fontSize:22, marginBottom:6 }}>📎</div>
                    <div style={{ fontSize:12, color:'#9ca3af' }}>Glisser ou cliquer pour ajouter photos et fichiers</div>
                    <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={handleFileUpload} style={{ display:'none' }} />
                  </label>
                ) : (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
                      {(photos || []).filter(p => p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i)).map(p => (
                        <div key={p.id} style={{ position:'relative', aspectRatio:'1', borderRadius:6, overflow:'hidden', border:'1px solid #e5e7eb' }}>
                          <img src={p.url} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                          <button
                            onClick={() => deletePhotoMut.mutate({ photoId: p.id, path: p.path })}
                            style={{ position:'absolute', top:3, right:3, background:'rgba(0,0,0,0.5)', border:'none', borderRadius:'50%', width:20, height:20, cursor:'pointer', color:'#fff', fontSize:10, display:'flex', alignItems:'center', justifyContent:'center' }}
                          >
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                      <label style={{ aspectRatio:'1', border:'1.5px dashed #d1d5db', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:22, color:'#9ca3af', background:'#f9fafb' }}>
                        +<input type="file" accept="image/*,.pdf" multiple onChange={handleFileUpload} style={{ display:'none' }} />
                      </label>
                    </div>
                    {(photos || []).filter(p => !p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i)).map(p => (
                      <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 8px', background:'#f9fafb', borderRadius:6, fontSize:11, marginBottom:4 }}>
                        <span style={{ color:'#b91c1c' }}>📄</span>
                        <span style={{ flex:1, color:'#111827' }}>{p.name}</span>
                        <button onClick={() => deletePhotoMut.mutate({ photoId: p.id, path: p.path })} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:12 }}>
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
