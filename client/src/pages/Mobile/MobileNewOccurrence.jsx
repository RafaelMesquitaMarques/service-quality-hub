import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

const BRANDS      = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']
const URGENCIES   = [
  { value:'overnight', label:'Overnight' },
  { value:'urgent',    label:'Urgent' },
  { value:'normal',    label:'Normal' },
]
const EDITOR_ROLES = ['admin','manager','cpm','service_desk']

const emptyLine = () => ({
  quality_issue: '', description: '', line_item: '',
  foliot_id: '', plant: '', affected_qty: '', total_qty: '', photos: [],
})

function StepBar({ step }) {
  const { t } = useTranslation()
  const labels = [t('ticket.step1'), t('ticket.lines'), t('common.confirm')]
  return (
    <div style={s.stepBar}>
      {labels.map((label, i) => {
        const n = i + 1
        const done   = step > n
        const active = step === n
        return (
          <div key={n} style={s.stepItem}>
            <div style={{
              ...s.stepCircle,
              background: done ? '#1D9E75' : active ? '#185FA5' : '#E5E7EB',
              color: done || active ? '#fff' : '#9CA3AF',
            }}>
              {done ? '✓' : n}
            </div>
            <span style={{ ...s.stepLabel, color: active ? '#185FA5' : done ? '#1D9E75' : '#9CA3AF' }}>
              {label}
            </span>
            {i < labels.length - 1 && (
              <div style={{ ...s.stepLine, background: done ? '#1D9E75' : '#E5E7EB' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={s.fieldGroup}>
      <label style={s.label}>{label}{required && <span style={{ color:'#EF4444' }}> *</span>}</label>
      {children}
    </div>
  )
}

function MInput({ value, onChange, placeholder, type = 'text', ...props }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={s.input}
      {...props}
    />
  )
}

function MSelect({ value, onChange, options, placeholder = '—' }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={s.input}>
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
          {typeof o === 'string' ? o : o.label}
        </option>
      ))}
    </select>
  )
}

function LineCard({ line, idx, onChange, onDelete, plants }) {
  const { t }     = useTranslation()
  const fileRef   = useRef(null)
  const cameraRef = useRef(null)

const handleFiles = (files) => {
  const newPhotos = Array.from(files).map(f => ({
    file: f,
    buffer: null,
    type: f.type || 'image/jpeg',
    name: f.name,
    preview: URL.createObjectURL(f),
    dataUrl: null,
    annotated: false,
  }))
  onChange(idx, '_addPhotos', newPhotos)
}

  return (
    <div style={s.lineCard}>
      <div style={s.lineCardHeader}>
        <span style={s.lineCardTitle}>{t('ticket.line_n')} {idx + 1}</span>
        {idx > 0 && (
          <button onClick={() => onDelete(idx)} style={s.deleteBtn}>✕</button>
        )}
      </div>

      <Field label={t('ticket.issue')} required>
        <textarea
          value={line.quality_issue}
          onChange={e => onChange(idx, 'quality_issue', e.target.value)}
          placeholder={t('ticket.description')}
          style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
        />
      </Field>

      <Field label={t('ticket.description')}>
        <textarea
          value={line.description}
          onChange={e => onChange(idx, 'description', e.target.value)}
          placeholder={t('ticket.description')}
          style={{ ...s.input, minHeight: 60, resize: 'vertical' }}
        />
      </Field>

      <div style={s.row2}>
        <Field label={t('ticket.line_item')}>
          <MInput value={line.line_item} onChange={v => onChange(idx,'line_item',v)} placeholder="Line item..." />
        </Field>
        <Field label={t('ticket.foliot_id')}>
          <MInput value={line.foliot_id} onChange={v => onChange(idx,'foliot_id',v)} placeholder="Foliot ID..." />
        </Field>
      </div>

      <Field label={t('ticket.plant')}>
        <MSelect
          value={line.plant}
          onChange={v => onChange(idx,'plant',v)}
          options={(plants||[]).map(p => ({ value: p.name, label: p.name }))}
        />
      </Field>

      <div style={s.row2}>
        <Field label={t('ticket.affected_qty')}>
          <MInput value={line.affected_qty} onChange={v => onChange(idx,'affected_qty',v)} type="number" placeholder="0" />
        </Field>
        <Field label={t('ticket.total_qty')}>
          <MInput value={line.total_qty} onChange={v => onChange(idx,'total_qty',v)} type="number" placeholder="0" />
        </Field>
      </div>

      <div style={s.photosSection}>
        <span style={s.photosLabel}>{t('ticket.photos')}</span>
        <div style={s.photoGrid}>
          {(line.photos||[]).map((p, pi) => (
            <div key={pi} style={s.photoThumb}>
              <img src={p.dataUrl || p.preview} alt="" style={s.thumbImg} />
              <button onClick={() => onChange(idx,'_removePhoto',pi)} style={s.removePhoto}>✕</button>
            </div>
          ))}
          <button onClick={() => cameraRef.current?.click()} style={s.addPhotoBtn}>
            <span style={{ fontSize: 22 }}>📷</span>
            <span style={{ fontSize: 10, color: '#6B7280' }}>Caméra</span>
          </button>
          <button onClick={() => fileRef.current?.click()} style={s.addPhotoBtn}>
            <span style={{ fontSize: 22 }}>🖼️</span>
            <span style={{ fontSize: 10, color: '#6B7280' }}>Fichier</span>
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
    </div>
  )
}

export default function MobileNewOccurrence() {
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const { t }       = useTranslation()
  const { user, logout } = useAuthStore()

  const [step, setStep]             = useState(1)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    issue_reception_date: new Date().toISOString().slice(0,10),
    brand: '', ship_to: '', sold_to: '', ref_so: '', original_so: '',
    delivery_date: '', installer_needed: '', urgency: '', comment: '',
  })
  const [lines, setLines] = useState([emptyLine()])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateLine = (idx, key, val) => {
    setLines(ls => ls.map((l, i) => {
      if (i !== idx) return l
      if (key === '_addPhotos')   return { ...l, photos: [...(l.photos||[]), ...val] }
      if (key === '_removePhoto') return { ...l, photos: (l.photos||[]).filter((_,pi) => pi !== val) }
      return { ...l, [key]: val }
    }))
  }

  const addLine    = () => setLines(ls => [...ls, emptyLine()])
  const deleteLine = idx => { if (lines.length > 1) setLines(ls => ls.filter((_,i) => i !== idx)) }

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').eq('active',true).order('name')
      return data || []
    },
  })

  const canGoStep2  = !!form.issue_reception_date
  const canGoStep3  = lines.some(l => l.quality_issue.trim())
  const totalPhotos = lines.reduce((sum, l) => sum + (l.photos?.length||0), 0)
const isEditor = user?.perm_create_mobile !== false

  const handleLogout = async () => {
    await logout()
    navigate('/mobile/login', { replace: true })
  }

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const dateYYYYMM = form.issue_reception_date?.slice(0,7)

      const { data: occ, error: occErr } = await supabase.from('tickets').insert({
        issue_reception_date: form.issue_reception_date,
        date_yyyy_mm:  dateYYYYMM,
        fiscal_year:   getFiscalYear(dateYYYYMM),
        fiscal_month:  getFiscalMonth(dateYYYYMM),
        brand:            form.brand         || null,
        ship_to:          form.ship_to       || null,
        sold_to:          form.sold_to       || null,
        ref_so:           form.ref_so        || null,
        original_so:      form.original_so   || null,
        created_by:       user?.id           || null,
        delivery_date:    form.delivery_date || null,
        installer_needed: form.installer_needed === '' ? null : form.installer_needed === 'yes',
        urgency:          form.urgency       || null,
        comment:          form.comment       || null,
        status:       'service_desk',
        quality_issue: lines[0]?.quality_issue || null,
        plant:         lines[0]?.plant         || null,
        affected_qty:  lines[0]?.affected_qty  ? Number(lines[0].affected_qty) : null,
        total_qty:     lines[0]?.total_qty     ? Number(lines[0].total_qty)    : null,
      }).select().single()
      if (occErr) throw occErr

      const { data: createdLines, error: linesErr } = await supabase
        .from('occurrence_lines')
        .insert(lines.map((l, i) => ({
          occurrence_id: occ.id,
          quality_issue: l.quality_issue || null,
          description:   l.description   || null,
          line_item:     l.line_item     || null,
          foliot_id:     l.foliot_id     || null,
          plant:         l.plant         || null,
          affected_qty:  l.affected_qty  ? Number(l.affected_qty) : null,
          total_qty:     l.total_qty     ? Number(l.total_qty)    : null,
          sort_order:    i,
        })))
        .select()
      if (linesErr) throw linesErr

      for (let li = 0; li < lines.length; li++) {
        const linePhotos = lines[li].photos || []
        if (!linePhotos.length) continue
        const lineId = createdLines?.[li]?.id || null
        for (const photo of linePhotos) {
          try {
            let blob
            if (photo.buffer) {
              blob = new Blob([photo.buffer], { type: photo.type || 'image/jpeg' })
            } else if (photo.file) {
              blob = photo.file
            } else continue
            const ext  = (photo.name||'photo.jpg').split('.').pop().replace(/[^a-z0-9]/gi,'') || 'jpg'
            const path = `tickets/${occ.id}/${Date.now()}_${li}_${Math.random().toString(36).slice(2,5)}.${ext}`
            const { error: upErr } = await supabase.storage.from('ticket-photos').upload(path, blob, { contentType: blob.type })
            if (upErr) { console.warn('Photo upload failed:', upErr.message); continue }
            const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
            await supabase.from('ticket_photos').insert({
              ticket_id: occ.id, url: urlData.publicUrl,
              name: photo.name||'photo.jpg', path, line_id: lineId,
            })
          } catch (photoErr) {
            console.warn('Photo error:', photoErr)
          }
        }
      }

      queryClient.invalidateQueries(['tickets'])
      toast.success(t('ticket.created'))
      setStep(4)
    } catch (err) {
      console.error(err)
      toast.error(err.message || t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 4) {
    return (
      <div style={{ ...s.root, justifyContent:'center', alignItems:'center', flexDirection:'column', gap:24, padding:32, textAlign:'center' }}>
        <div style={{ width:72, height:72, borderRadius:'50%', background:'#D1FAE5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:32 }}>
          ✅
        </div>
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, color:'#111827', margin:'0 0 8px' }}>{t('ticket.created')} !</h2>
          <p style={{ fontSize:14, color:'#6B7280', margin:0 }}>
            {t('ticket.submit_to_sd')}
          </p>
        </div>
        <button
          onClick={() => {
            setStep(1)
            setForm({ issue_reception_date: new Date().toISOString().slice(0,10), brand:'', ship_to:'', sold_to:'', ref_so:'', original_so:'', delivery_date:'', installer_needed:'', urgency:'', comment:'' })
            setLines([emptyLine()])
          }}
          style={s.btnPrimary}
        >
          {t('ticket.new')}
        </button>
      </div>
    )
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>{t('ticket.new')}</div>
          <div style={s.headerSub}>{user?.full_name || user?.email || ''}</div>
        </div>
        <button onClick={handleLogout} style={s.logoutBtn}>{t('common.logout')}</button>
      </div>

  <StepBar step={step} />

{!isEditor && (
  <div style={s.viewerBanner}>
    ⚠️ Accès lecture seule — vous n'avez pas la permission de créer des occurrences.
  </div>
)}

      

      <div style={s.content}>
        {step === 1 && (
          <div style={s.stepContent}>
            <div style={s.sectionTitle}>{t('ticket.informations')}</div>
            <div style={s.row2}>
              <Field label={t('ticket.reception_date')} required>
                <MInput type="date" value={form.issue_reception_date} onChange={v => setField('issue_reception_date', v)} />
              </Field>
              <Field label={t('ticket.delivery_date')}>
                <MInput type="date" value={form.delivery_date} onChange={v => setField('delivery_date', v)} />
              </Field>
            </div>
            <Field label={t('ticket.brand')}>
              <MSelect value={form.brand} onChange={v => setField('brand',v)} options={BRANDS} />
            </Field>
            <div style={s.row2}>
              <Field label={t('ticket.ship_to')}>
                <MInput value={form.ship_to} onChange={v => setField('ship_to',v)} placeholder="Ship To..." />
              </Field>
              <Field label={t('ticket.sold_to')}>
                <MInput value={form.sold_to} onChange={v => setField('sold_to',v)} placeholder="Sold To..." />
              </Field>
            </div>
            <div style={s.row2}>
              <Field label={t('ticket.ref_so')}>
                <MInput value={form.ref_so} onChange={v => setField('ref_so',v)} placeholder="REF SO..." />
              </Field>
              <Field label={t('ticket.original_so')}>
                <MInput value={form.original_so} onChange={v => setField('original_so',v)} placeholder="Original SO..." />
              </Field>
            </div>
            <div style={s.row2}>
              <Field label={t('ticket.installer_needed')}>
                <MSelect value={form.installer_needed} onChange={v => setField('installer_needed',v)} options={[{ value:'yes', label:t('common.yes') }, { value:'no', label:t('common.no') }]} />
              </Field>
              <Field label={t('ticket.urgency')}>
                <MSelect value={form.urgency} onChange={v => setField('urgency',v)} options={URGENCIES} />
              </Field>
            </div>
            <Field label={t('ticket.comment')}>
              <textarea
                value={form.comment}
                onChange={e => setField('comment', e.target.value)}
                placeholder="Commentaire..."
                style={{ ...s.input, minHeight: 70, resize: 'vertical' }}
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div style={s.stepContent}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={s.sectionTitle}>{t('ticket.lines')}</div>
              <button onClick={addLine} style={s.btnAddLine}>+ {t('ticket.add_line')}</button>
            </div>
            {lines.map((line, idx) => (
              <LineCard key={idx} line={line} idx={idx} onChange={updateLine} onDelete={deleteLine} plants={plants} />
            ))}
          </div>
        )}

        {step === 3 && (
          <div style={s.stepContent}>
            <div style={s.sectionTitle}>{t('common.confirm')}</div>
            <div style={s.summaryCard}>
              <div style={s.summaryTitle}>{t('ticket.informations')}</div>
              {[
                [t('ticket.reception_date'), form.issue_reception_date],
                [t('ticket.delivery_date'), form.delivery_date],
                [t('ticket.brand'), form.brand],
                [t('ticket.ship_to'), form.ship_to],
                [t('ticket.sold_to'), form.sold_to],
                [t('ticket.ref_so'), form.ref_so],
                [t('ticket.original_so'), form.original_so],
                [t('ticket.installer_needed'), form.installer_needed ? (form.installer_needed === 'yes' ? t('common.yes') : t('common.no')) : ''],
                [t('ticket.urgency'), URGENCIES.find(u => u.value === form.urgency)?.label],
                [t('ticket.comment'), form.comment],
              ].filter(([,v]) => v).map(([label, val]) => (
                <div key={label} style={s.summaryRow}>
                  <span style={s.summaryKey}>{label}</span>
                  <span style={s.summaryVal}>{val}</span>
                </div>
              ))}
            </div>
            <div style={s.summaryCard}>
              <div style={s.summaryTitle}>{lines.length} {t('ticket.lines').toLowerCase()} · {totalPhotos} {t('ticket.photos').toLowerCase()}</div>
              {lines.map((l, i) => (
                <div key={i} style={s.linePreview}>
                  <div style={s.linePreviewNum}>{i+1}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'#111827' }}>{l.quality_issue || '—'}</div>
                    <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>
                      {[l.plant, l.line_item, l.affected_qty ? `${t('ticket.affected_qty')}: ${l.affected_qty}${l.total_qty ? ` / ${l.total_qty}` : ''}` : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {(l.photos?.length||0) > 0 && (
                    <span style={s.photoBadge}>{l.photos.length} 📷</span>
                  )}
                </div>
              ))}
            </div>
            <div style={s.infoBanner}>
              📤 {t('ticket.submit_to_sd')}
            </div>
          </div>
        )}
      </div>

      <div style={s.footer}>
        <button
          onClick={() => setStep(p => p - 1)}
          style={{ ...s.btnSecondary, visibility: step === 1 ? 'hidden' : 'visible' }}
        >
          ← {t('common.previous')}
        </button>
        {step < 3 && (
          <button
            onClick={() => setStep(p => p + 1)}
            disabled={step === 1 ? !canGoStep2 : !canGoStep3}
            style={{ ...s.btnPrimary, opacity: (step === 1 && !canGoStep2) || (step === 2 && !canGoStep3) ? 0.4 : 1 }}
          >
            {t('common.next')} →
          </button>
        )}
        {step === 3 && (
          <button
            onClick={handleSubmit}
            disabled={submitting || !isEditor}
            style={{ ...s.btnGreen, opacity: (submitting || !isEditor) ? 0.5 : 1 }}
          >
            {submitting ? t('common.loading') : `✓ ${t('ticket.submit_to_sd')}`}
          </button>
        )}
      </div>
    </div>
  )
}

const s = {
  root: {
    minHeight: '100dvh',
    background: '#F0F4F8',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    maxWidth: 600,
    margin: '0 auto',
  },
  header: {
    background: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerTitle: { fontSize:16, fontWeight:700, color:'#111827' },
  headerSub:   { fontSize:12, color:'#6B7280', marginTop:1 },
  logoutBtn: {
    background: 'none',
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12,
    color: '#6B7280',
    cursor: 'pointer',
  },
  stepBar: {
    background: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    padding: '12px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  stepLine: {
    flex: 1,
    height: 2,
    marginLeft: 'auto',
    minWidth: 16,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
  },
  input: {
    padding: '13px 14px',
    borderRadius: 10,
    border: '1.5px solid #E5E7EB',
    fontSize: 16,
    color: '#111827',
    background: '#FFFFFF',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    WebkitAppearance: 'none',
    appearance: 'none',
  },
  row2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  lineCard: {
    background: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    border: '1px solid #E5E7EB',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  lineCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#185FA5',
  },
  deleteBtn: {
    background: '#FEF2F2',
    border: 'none',
    borderRadius: 6,
    color: '#EF4444',
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  photosSection: {
    borderTop: '1px solid #F3F4F6',
    paddingTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  photosLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  photoGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    border: '1px solid #E5E7EB',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  removePhoto: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    border: 'none',
    fontSize: 9,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  addPhotoBtn: {
    width: 64,
    height: 64,
    borderRadius: 8,
    border: '1.5px dashed #D1D5DB',
    background: '#F9FAFB',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    gap: 2,
    padding: 0,
  },
  btnAddLine: {
    background: '#EFF6FF',
    color: '#185FA5',
    border: '1px solid #BFDBFE',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  summaryCard: {
    background: '#FFFFFF',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  summaryTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    borderBottom: '1px solid #F3F4F6',
    paddingBottom: 6,
  },
  summaryKey: { color: '#6B7280' },
  summaryVal: { color: '#111827', fontWeight: 600 },
  linePreview: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 0',
    borderBottom: '1px solid #F3F4F6',
  },
  linePreviewNum: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: '#E6F1FB',
    color: '#185FA5',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  photoBadge: {
    background: '#EFF6FF',
    color: '#185FA5',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 11,
    fontWeight: 600,
  },
  infoBanner: {
    background: '#FFFBEB',
    border: '1px solid #FDE68A',
    borderRadius: 10,
    padding: '12px 14px',
    fontSize: 13,
    color: '#92400E',
  },
  viewerBanner: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    padding: '10px 16px',
    fontSize: 13,
    color: '#B91C1C',
  },
  footer: {
    background: '#FFFFFF',
    borderTop: '1px solid #E5E7EB',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'sticky',
    bottom: 0,
    gap: 12,
  },
  btnPrimary: {
    background: '#185FA5',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 12,
    padding: '14px 24px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1,
    WebkitTapHighlightColor: 'transparent',
  },
  btnSecondary: {
    background: '#F3F4F6',
    color: '#374151',
    border: 'none',
    borderRadius: 12,
    padding: '14px 20px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  btnGreen: {
    background: '#1D9E75',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 12,
    padding: '14px 24px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1,
    WebkitTapHighlightColor: 'transparent',
  },
}
