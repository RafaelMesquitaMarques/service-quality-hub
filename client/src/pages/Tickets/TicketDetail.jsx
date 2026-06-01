import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { supabase } from '../../services/supabase'
import { PageHeader, Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const STATUS_OPTS = ['not_started','wip','completed','cancelled']
const STATUS_LBL  = { not_started:'Not started', wip:'WIP', completed:'Completed', cancelled:'Cancelled' }

const STATUS_CLR_LIGHT = {
  not_started: { bg:'#f3f4f6', color:'#6b7280' },
  wip:         { bg:'#fef3c7', color:'#633806' },
  completed:   { bg:'#eaf3de', color:'#27500a' },
  cancelled:   { bg:'#fcebeb', color:'#791f1f' },
}
const STATUS_CLR_DARK = {
  not_started: { bg:'#1f2937', color:'#9ca3af' },
  wip:         { bg:'#3b2a00', color:'#fcd34d' },
  completed:   { bg:'#14532d', color:'#86efac' },
  cancelled:   { bg:'#4a1b0c', color:'#fca5a5' },
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-CA', { day:'2-digit', month:'2-digit', year:'numeric' })
}

function SectionHeader({ icon, title, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-900 dark:text-gray-100">
        <i className={`ti ${icon} text-blue-500 text-sm`} aria-hidden="true" />
        {title}
      </div>
      {right}
    </div>
  )
}

export default function TicketDetail() {
  const { id }      = useParams()
  const { t }       = useTranslation()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const fileRef     = useRef(null)

  const [searchParams]  = useState(() => new URLSearchParams(window.location.search))
  const fromMeeting     = searchParams.get('from') === 'meeting'
  const meetingId       = searchParams.get('meetingId')

  const [rootCause,   setRootCause]   = useState('')
  const [corrective,  setCorrective]  = useState('')
  const [initialized, setInitialized] = useState(false)
  const [lightbox,    setLightbox]    = useState(null)

  const isDark = document.documentElement.classList.contains('dark')
  const SC = isDark ? STATUS_CLR_DARK : STATUS_CLR_LIGHT

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
      const { data, error } = await supabase.from('ticket_photos').select('*').eq('ticket_id', id).order('created_at')
      if (error) return []
      return data || []
    },
  })

  const updateMut = useMutation({
    mutationFn: (payload) => ticketApi.update(id, payload),
    onSuccess: () => { queryClient.invalidateQueries(['ticket', id]); toast.success(t('common.save')) },
    onError: () => toast.error(t('common.error')),
  })

  const uploadPhotoMut = useMutation({
    mutationFn: async (file) => {
      const ext  = file.name.split('.').pop()
      const path = `tickets/${id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('ticket-photos').upload(path, file)
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
      const { error: dbErr } = await supabase.from('ticket_photos').insert({ ticket_id: id, url: urlData.publicUrl, name: file.name, path })
      if (dbErr) throw dbErr
    },
    onSuccess: () => { queryClient.invalidateQueries(['ticket-photos', id]); toast.success('Photo ajoutée') },
    onError: () => toast.error(t('common.error')),
  })

  const deletePhotoMut = useMutation({
    mutationFn: async ({ photoId, path }) => {
      if (path) await supabase.storage.from('ticket-photos').remove([path])
      await supabase.from('ticket_photos').delete().eq('id', photoId)
    },
    onSuccess: () => { queryClient.invalidateQueries(['ticket-photos', id]); toast.success('Photo supprimée') },
    onError: () => toast.error(t('common.error')),
  })

  const handleSave       = () => updateMut.mutate({ root_cause: rootCause, corrective_action: corrective })
  const handleFileUpload = (e) => Array.from(e.target.files).forEach(file => uploadPhotoMut.mutate(file))
  const handleDeletePhoto = (photo) => {
    if (window.confirm(t('ticket.delete_photo'))) {
      deletePhotoMut.mutate({ photoId: photo.id, path: photo.path })
      if (lightbox === photo.url) setLightbox(null)
    }
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  if (!ticket)   return null

  const sc = SC[ticket.status] || SC.not_started
  const imgPhotos  = (photos || []).filter(p =>  p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))
  const filePhotos = (photos || []).filter(p => !p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))

  return (
    <>
      <PageHeader
        title={ticket.quality_issue}
        subtitle={`SC# ${ticket.sc_number || '—'} · ${formatDate(ticket.issue_reception_date)}`}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => fromMeeting ? navigate(`/meetings?meetingId=${meetingId}`) : navigate(-1)}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('ticket.back')}
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={updateMut.isPending}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> {updateMut.isPending ? t('common.loading') : t('ticket.save')}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="grid gap-3 max-w-5xl" style={{ gridTemplateColumns:'1fr 1fr' }}>

          {/* ── COL 1 ── */}
          <div className="flex flex-col gap-3">
            <div className="card">
              <SectionHeader icon="ti-info-circle" title={t('ticket.informations')}
                right={
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: sc.bg, color: sc.color }}>
                    {STATUS_LBL[ticket.status] || ticket.status}
                  </span>
                }
              />
              <div className="px-4 py-2">
                {[
                  [t('ticket.ship_to'),      ticket.ship_to],
                  [t('ticket.sold_to'),      ticket.sold_to],
                  [t('ticket.brand'),        ticket.brand],
                  [t('ticket.department'),   ticket.department],
                  [t('ticket.categories'),   ticket.categories],
                  [t('ticket.plant'),        ticket.plant],
                  [t('ticket.ref_so'),       ticket.ref_so],
                  [t('ticket.sc_number'),    ticket.sc_number],
                  [t('ticket.affected_qty'), ticket.affected_qty || ticket.qty_affected],
                  [t('ticket.cost'),         ticket.cost_approx ? `$${Number(ticket.cost_approx).toLocaleString()}` : null],
                  [t('ticket.reception_date'), formatDate(ticket.issue_reception_date)],
                  [t('ticket.meeting_date'),   formatDate(ticket.meeting_date)],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-50 dark:border-gray-800/80 text-xs">
                    <span className="text-gray-400">{label}</span>
                    <span className={label === t('ticket.cost') ? 'text-red-500 font-medium' : 'text-gray-900 dark:text-gray-100'}>
                      {label === t('ticket.department') ? (
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">{value}</span>
                      ) : value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <SectionHeader icon="ti-circle-check" title={t('ticket.status')} />
              <div className="px-4 py-3 flex gap-2">
                {STATUS_OPTS.map(s => (
                  <button key={s} onClick={() => updateMut.mutate({ status: s })}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
                    style={{
                      border:     ticket.status === s ? '1px solid #2563eb' : '1px solid ' + (isDark ? '#374151' : '#e5e7eb'),
                      background: ticket.status === s ? '#2563eb' : (isDark ? '#161B22' : '#fff'),
                      color:      ticket.status === s ? '#fff' : (isDark ? '#9ca3af' : '#6b7280'),
                    }}>
                    {STATUS_LBL[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <SectionHeader icon="ti-history" title={t('ticket.history')} />
              <div className="px-4 py-2">
                {[
                  { dot:'#2563eb', time: formatDate(ticket.updated_at || ticket.created_at), text: t('ticket.last_modified') },
                  { dot:'#9ca3af', time: formatDate(ticket.issue_reception_date), text: `${t('ticket.created')} · SC# ${ticket.sc_number || '—'}` },
                ].map((h, i) => (
                  <div key={i} className="flex gap-3 py-2 border-b border-gray-50 dark:border-gray-800/80 text-xs">
                    <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: h.dot }} />
                    <div className="text-gray-400 min-w-20">{h.time}</div>
                    <div className="text-gray-600 dark:text-gray-300">{h.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── COL 2 ── */}
          <div className="flex flex-col gap-3">
            <div className="card">
              <SectionHeader icon="ti-file-description" title={t('ticket.description')} />
              <div className="px-4 py-3">
                <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-[#161B22] rounded-lg p-3">
                  {ticket.quality_issue}
                </div>
              </div>
            </div>

            <div className="card">
              <SectionHeader icon="ti-tool" title={t('ticket.resolution')} />
              <div className="px-4 py-3 flex flex-col gap-3">
                <div>
                  <label className="label">{t('ticket.root_cause')}</label>
                  <textarea rows={3} value={rootCause} onChange={e => setRootCause(e.target.value)}
                    placeholder={t('ticket.root_cause_placeholder')}
                    className="input resize-y text-xs" />
                </div>
                <div>
                  <label className="label">{t('ticket.corrective_action')}</label>
                  <textarea rows={3} value={corrective} onChange={e => setCorrective(e.target.value)}
                    placeholder={t('ticket.corrective_placeholder')}
                    className="input resize-y text-xs" />
                </div>
              </div>
            </div>

            <div className="card">
              <SectionHeader icon="ti-photo" title={t('ticket.photos')}
                right={
                  <label className="btn-primary py-1 px-2.5 text-xs cursor-pointer">
                    <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('common.edit')}
                    <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" multiple onChange={handleFileUpload} className="hidden" />
                  </label>
                }
              />
              <div className="px-4 py-3">
                {(photos || []).length === 0 ? (
                  <label className="block border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-5 text-center cursor-pointer bg-gray-50 dark:bg-[#161B22] hover:border-blue-400 transition-colors">
                    <i className="ti ti-paperclip text-2xl text-gray-300 dark:text-gray-600 block mb-2" aria-hidden="true" />
                    <div className="text-xs text-gray-400">{t('ticket.drag_photos')}</div>
                    <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={handleFileUpload} className="hidden" />
                  </label>
                ) : (
                  <>
                    {imgPhotos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {imgPhotos.map(p => (
                          <div key={p.id} className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700" style={{ aspectRatio:'1' }}>
                            <img src={p.url} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(p.url)} />
                            <button onClick={() => handleDeletePhoto(p)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs border-none cursor-pointer"
                              style={{ background:'rgba(0,0,0,0.55)' }}>
                              <i className="ti ti-trash" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                        <label className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-center cursor-pointer text-gray-400 hover:border-blue-400 transition-colors" style={{ aspectRatio:'1' }}>
                          <i className="ti ti-plus text-xl" aria-hidden="true" />
                          <input type="file" accept="image/*,.pdf" multiple onChange={handleFileUpload} className="hidden" />
                        </label>
                      </div>
                    )}
                    {filePhotos.map(p => (
                      <div key={p.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#161B22] rounded-lg text-xs mb-1">
                        <i className="ti ti-file text-red-400 text-sm" aria-hidden="true" />
                        <a href={p.url} target="_blank" rel="noreferrer" className="flex-1 text-blue-500 hover:underline">{p.name || 'Fichier'}</a>
                        <button onClick={() => handleDeletePhoto(p)} className="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer p-0">
                          <i className="ti ti-trash text-sm" aria-hidden="true" />
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

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          className="fixed inset-0 flex items-center justify-center z-[2000] cursor-zoom-out p-5"
          style={{ background:'rgba(0,0,0,0.92)' }}>
          <img src={lightbox} className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-white text-lg border-none cursor-pointer"
            style={{ background:'rgba(255,255,255,0.15)' }}>
            ✕
          </button>
        </div>
      )}
    </>
  )
}
