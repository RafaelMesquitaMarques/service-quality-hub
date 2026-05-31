import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import toast from 'react-hot-toast'

const DEPARTMENTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]
const CATEGORIES = [
  'Damaged','Missing Part','Wrong Item','Quality Defect',
  'Packaging','Documentation','Delay',
]
const BRANDS  = ['BDI','Casabianca','Euro Style','Nexera','Tvilum']
const PLANTS  = ['Vietnam','China','Canada','USA']
const STATUSES = ['not_started','wip','completed','cancelled']
const STATUS_LABELS = { not_started:'Not started', wip:'WIP', completed:'Completed', cancelled:'Cancelled' }
const TOOL_NAMES = { select:'SÉLECTION', pen:'STYLO', arrow:'FLÈCHE', rect:'RECTANGLE', circle:'CERCLE', text:'TEXTE' }
const COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#111827','#ffffff']

function AnnotationCanvas({ tool, color, thickness, snapshotsRef, onSnapshotChange }) {
  const canvasRef  = useRef(null)
  const bgRef      = useRef(null)
  const drawingRef = useRef(false)
  const startRef   = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'
  }, [tool])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const r = canvas.getBoundingClientRect()
    const scaleX = canvas.width / r.width
    const scaleY = canvas.height / r.height
    const src = e.touches ? e.touches[0] : e
    return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY }
  }

  const drawArrow = (ctx, x1, y1, x2, y2) => {
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const sz = 10 + thickness * 1.5
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = thickness
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - sz * Math.cos(angle - Math.PI / 7), y2 - sz * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(x2 - sz * Math.cos(angle + Math.PI / 7), y2 - sz * Math.sin(angle + Math.PI / 7))
    ctx.closePath(); ctx.fill()
  }

  const onDown = (e) => {
    if (tool === 'select') return
    if (tool === 'text') {
      const p = getPos(e)
      const txt = prompt("Texte de l'annotation :")
      if (!txt) return
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      snapshotsRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      ctx.fillStyle = color
      ctx.font = `${12 + thickness * 2}px sans-serif`
      ctx.fillText(txt, p.x, p.y)
      onSnapshotChange()
      return
    }
    drawingRef.current = true
    const p = getPos(e)
    startRef.current = p
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    snapshotsRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (tool === 'pen') {
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
      ctx.strokeStyle = color; ctx.lineWidth = thickness
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    }
  }

  const onMove = (e) => {
    if (!drawingRef.current) return
    const p = getPos(e)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (tool === 'pen') { ctx.lineTo(p.x, p.y); ctx.stroke(); return }
    const snaps = snapshotsRef.current
    if (snaps.length) ctx.putImageData(snaps[snaps.length - 1], 0, 0)
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.lineCap = 'round'
    const { x: sx, y: sy } = startRef.current
    if (tool === 'rect') {
      ctx.beginPath(); ctx.strokeRect(sx, sy, p.x - sx, p.y - sy)
    } else if (tool === 'circle') {
      const rx = Math.abs(p.x - sx) / 2, ry = Math.abs(p.y - sy) / 2
      ctx.beginPath()
      ctx.ellipse(sx + (p.x - sx) / 2, sy + (p.y - sy) / 2, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (tool === 'arrow') {
      drawArrow(ctx, sx, sy, p.x, p.y)
    }
  }

  const onUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (tool === 'pen') canvasRef.current.getContext('2d').closePath()
    onSnapshotChange()
  }

  return (
    <canvas
      ref={canvasRef}
      id="annCanvas"
      style={{ display: 'block', width: '100%', touchAction: 'none' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={e => { e.preventDefault(); onDown(e) }}
      onTouchMove={e  => { e.preventDefault(); onMove(e) }}
      onTouchEnd={e   => { e.preventDefault(); onUp() }}
    />
  )
}

export default function TicketModal({ onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('info')
  const [saving, setSaving] = useState(false)
  const [, forceUpdate] = useState(0)

  const [form, setForm] = useState({
    issue_reception_date: '', meeting_date: '', department: '', categories: '',
    brand: '', plant: '', status: 'not_started', quality_issue: '',
    ship_to: '', sold_to: '', ref_so: '', sc_number: '', qty_affected: '', cost_approx: '',
  })
  const [ac, setAc] = useState({
    assigned_to: '', due_date: '', description: '', status: 'À faire', close_date: '', notes: '',
  })

  const [tool, setTool]       = useState('select')
  const [color, setColor]     = useState('#ef4444')
  const [thickness, setThick] = useState(3)
  const [photos, setPhotos]   = useState([])
  const [activePhoto, setActivePhoto] = useState(0)
  const snapshotsRef = useRef([])
  const photoAnnsRef = useRef({})
  const bgImgRef     = useRef(null)

  const setField   = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setAcField = (k, v) => setAc(a => ({ ...a, [k]: v }))

  const loadPhotos = (e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const img = new Image()
        img.onload = () => {
          setPhotos(prev => {
            const next = [...prev, { img, src: ev.target.result }]
            if (next.length === 1) setTimeout(() => activatePhoto(0, next), 50)
            return next
          })
        }
        img.src = ev.target.result
      }
      reader.readAsDataURL(file)
    })
  }

  const activatePhoto = useCallback((idx, photoList) => {
    const list = photoList || photos
    if (!list[idx]) return
    const canvas = document.getElementById('annCanvas')
    if (canvas && photos.length > 0) photoAnnsRef.current[activePhoto] = canvas.toDataURL()
    setActivePhoto(idx)
    snapshotsRef.current = []
    const p = list[idx]
    if (!canvas) return
    const W = canvas.parentElement?.clientWidth || 600
    const scale = Math.min(W / p.img.width, 320 / p.img.height, 1)
    canvas.width  = Math.round(p.img.width  * scale)
    canvas.height = Math.round(p.img.height * scale)
    bgImgRef.current = p.img
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(p.img, 0, 0, canvas.width, canvas.height)
    if (photoAnnsRef.current[idx]) {
      const saved = new Image()
      saved.onload = () => ctx.drawImage(saved, 0, 0)
      saved.src = photoAnnsRef.current[idx]
    }
  }, [photos, activePhoto])

  const undoAnnotation = () => {
    const canvas = document.getElementById('annCanvas')
    if (!canvas || !snapshotsRef.current.length) return
    canvas.getContext('2d').putImageData(snapshotsRef.current.pop(), 0, 0)
    forceUpdate(n => n + 1)
  }

  const clearAnnotation = () => {
    const canvas = document.getElementById('annCanvas')
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    snapshotsRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, canvas.width, canvas.height)
    forceUpdate(n => n + 1)
  }

  const handleSubmit = async (asDraft = false) => {
    if (!form.issue_reception_date || !form.department || !form.categories || !form.quality_issue) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      setActiveTab('info')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        qty_affected: form.qty_affected ? Number(form.qty_affected) : null,
        cost_approx:  form.cost_approx  ? Number(form.cost_approx)  : null,
        status: asDraft ? 'not_started' : form.status,
        date_yyyy_mm: form.issue_reception_date ? form.issue_reception_date.slice(0, 7) : null,
        action_corrective: ac.description ? ac : null,
      }
      const { data } = await ticketApi.create(payload)
      toast.success('Ticket créé avec succès')
      onClose?.()
      navigate(`/tickets/${data.id}`)
    } catch (err) {
      toast.error('Erreur lors de la création du ticket')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '32px 16px', zIndex: 1000, overflowY: 'auto',
    }}>
      <div style={{
        background: 'var(--color-background-primary,#fff)',
        borderRadius: 12, border: '0.5px solid #e5e7eb',
        width: '100%', maxWidth: 660,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', position: 'relative',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '0.5px solid #e5e7eb' }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>Nouveau ticket qualité</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Tous les champs marqués <span style={{ color: '#ef4444' }}>*</span> sont obligatoires
          </div>
          <button onClick={onClose} style={{
            position: 'absolute', top: 14, right: 16,
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af',
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e7eb', padding: '0 20px' }}>
          {[
            { id: 'info', label: 'Informations',      icon: 'ⓘ' },
            { id: 'pj',   label: `Pièces jointes ${photos.length}`, icon: '📎' },
            { id: 'ac',   label: 'Action corrective', icon: '🔧' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '10px 14px 9px', fontSize: 13, cursor: 'pointer',
              border: 'none', background: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab.id ? 500 : 400,
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB INFORMATIONS ── */}
        {activeTab === 'info' && (
          <div style={{ padding: '16px 20px' }}>
            <Row2>
              <Field label="Date réception *">
                <input type="date" value={form.issue_reception_date} onChange={e => setField('issue_reception_date', e.target.value)} />
              </Field>
              <Field label="Date réunion">
                <input type="date" value={form.meeting_date} onChange={e => setField('meeting_date', e.target.value)} />
              </Field>
            </Row2>
            <Row2>
              <Field label="Département *">
                <select value={form.department} onChange={e => setField('department', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Catégorie *">
                <select value={form.categories} onChange={e => setField('categories', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </Row2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="Marque (Brand)">
                <select value={form.brand} onChange={e => setField('brand', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Usine (Plant)">
                <select value={form.plant} onChange={e => setField('plant', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {PLANTS.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Statut">
                <select value={form.status} onChange={e => setField('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 10 }}>
              <Field label="Problème qualité (Quality issue) *">
                <textarea rows={3} placeholder="Décrire le problème en détail..."
                  value={form.quality_issue} onChange={e => setField('quality_issue', e.target.value)}
                  style={{ resize: 'vertical' }} />
              </Field>
            </div>
            <Row2>
              <Field label="Ship To"><input placeholder="Ex: HIEX Page, AZ" value={form.ship_to} onChange={e => setField('ship_to', e.target.value)} /></Field>
              <Field label="Sold To"><input placeholder="Ex: Hilton Supply Management" value={form.sold_to} onChange={e => setField('sold_to', e.target.value)} /></Field>
            </Row2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="REF SO"><input placeholder="66882" value={form.ref_so} onChange={e => setField('ref_so', e.target.value)} /></Field>
              <Field label="SC#"><input placeholder="68489" value={form.sc_number} onChange={e => setField('sc_number', e.target.value)} /></Field>
              <Field label="Qté affectée"><input type="number" placeholder="1" value={form.qty_affected} onChange={e => setField('qty_affected', e.target.value)} /></Field>
              <Field label="Coût approx. $"><input type="number" placeholder="800" value={form.cost_approx} onChange={e => setField('cost_approx', e.target.value)} /></Field>
            </div>
            <div onClick={() => setActiveTab('pj')} style={{
              border: '1.5px dashed #d1d5db', borderRadius: 8, padding: 20,
              textAlign: 'center', cursor: 'pointer', background: '#f9fafb',
            }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>☁️</div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Glisser les fichiers ici ou cliquer pour parcourir</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>JPG, PNG, PDF, Word, Excel, Vidéo · Max 20 MB par fichier</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                {[['📷','Photo','#eff6ff','#1d4ed8'],['📄','PDF','#fef2f2','#b91c1c'],['📊','Excel','#f0fdf4','#15803d'],['🎬','Vidéo','#fdf4ff','#9333ea']].map(([ic,lb,bg,cl]) => (
                  <span key={lb} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: bg, color: cl, fontWeight: 500 }}>{ic} {lb}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB PIÈCES JOINTES ── */}
        {activeTab === 'pj' && (
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>PHOTOS D'INSPECTION</div>

            {/* Toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
              background: '#f3f4f6', border: '0.5px solid #e5e7eb', borderRadius: 8,
              padding: '5px 8px', marginBottom: 8,
            }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: 4, border: '0.5px solid #bfdbfe', marginRight: 4 }}>
                {TOOL_NAMES[tool]}
              </span>
              <Sep />
              {['select','pen','arrow','rect','circle','text'].map(t => (
                <ToolBtn key={t} active={tool === t} onClick={() => setTool(t)}>
                  {{ select:'⬡', pen:'✏️', arrow:'↗', rect:'▭', circle:'◯', text:'T' }[t]}
                </ToolBtn>
              ))}
              <Sep />
              {COLORS.map(c => (
                <div key={c} onClick={() => setColor(c)} style={{
                  width: 16, height: 16, borderRadius: '50%', background: c, cursor: 'pointer', flexShrink: 0,
                  border: color === c ? '2.5px solid #111' : '1px solid #d1d5db',
                  transform: color === c ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.1s',
                }} />
              ))}
              <Sep />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: '#6b7280' }}>≡</span>
                <input type="range" min="1" max="10" step="1" value={thickness}
                  onChange={e => setThick(Number(e.target.value))}
                  style={{ width: 50, accentColor: '#2563eb' }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', minWidth: 12 }}>{thickness}</span>
              </div>
              <Sep />
              <ToolBtn onClick={undoAnnotation}>↩</ToolBtn>
              <ToolBtn onClick={clearAnnotation}>⌫</ToolBtn>
            </div>

            {/* Canvas */}
            <div style={{
              border: '1.5px dashed #d1d5db', borderRadius: 8, background: '#f9fafb',
              overflow: 'hidden', position: 'relative', minHeight: 200,
            }}>
              {photos.length === 0 ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: 260 }}>
                    {[{ label: 'Prendre photo', icon: '📷', capture: 'environment' }, { label: 'Depuis galerie', icon: '🖼️' }].map(({ label, icon, capture }) => (
                      <label key={label} style={{
                        padding: '12px 8px', border: '1px dashed #d1d5db', borderRadius: 8,
                        background: '#fff', cursor: 'pointer', textAlign: 'center', color: '#6b7280',
                        fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      }}>
                        <span style={{ fontSize: 22 }}>{icon}</span>{label}
                        <input type="file" accept="image/*" multiple capture={capture} onChange={loadPhotos} style={{ display: 'none' }} />
                      </label>
                    ))}
                  </div>
                  <small style={{ fontSize: 11, color: '#9ca3af' }}>Ou faites glisser une image ici</small>
                </div>
              ) : (
                <AnnotationCanvas
                  tool={tool} color={color} thickness={thickness}
                  snapshotsRef={snapshotsRef} onSnapshotChange={() => forceUpdate(n => n + 1)}
                />
              )}
            </div>

            {/* Thumbnails */}
            {photos.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {photos.map((p, i) => (
                  <img key={i} src={p.src} onClick={() => activatePhoto(i)} style={{
                    width: 48, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer',
                    border: i === activePhoto ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
                  }} />
                ))}
                <label style={{
                  width: 48, height: 48, borderRadius: 6, border: '1.5px dashed #d1d5db',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', fontSize: 20, color: '#9ca3af', background: '#f9fafb',
                }}>
                  +<input type="file" accept="image/*" multiple onChange={loadPhotos} style={{ display: 'none' }} />
                </label>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>{photos.length} photo(s)</div>

            {/* Autres fichiers */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>AUTRES PIÈCES JOINTES</div>
              <label style={{
                display: 'block', border: '1.5px dashed #d1d5db', borderRadius: 8,
                padding: 18, textAlign: 'center', cursor: 'pointer', background: '#f9fafb',
              }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>PDF, Word, Excel, Vidéo</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Max 20 MB par fichier</div>
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov" multiple style={{ display: 'none' }} />
              </label>
            </div>
          </div>
        )}

        {/* ── TAB ACTION CORRECTIVE ── */}
        {activeTab === 'ac' && (
          <div style={{ padding: '16px 20px' }}>
            {[
              {
                title: '👤 Responsable',
                body: (
                  <Row2>
                    <Field label="Assigné à"><input placeholder="Nom du responsable" value={ac.assigned_to} onChange={e => setAcField('assigned_to', e.target.value)} /></Field>
                    <Field label="Date limite"><input type="date" value={ac.due_date} onChange={e => setAcField('due_date', e.target.value)} /></Field>
                  </Row2>
                ),
              },
              {
                title: "📋 Description de l'action",
                body: <Field label=""><textarea rows={4} placeholder="Décrire l'action corrective..." value={ac.description} onChange={e => setAcField('description', e.target.value)} style={{ resize: 'vertical' }} /></Field>,
              },
              {
                title: '✅ Suivi',
                body: (
                  <>
                    <Row2>
                      <Field label="Statut action">
                        <select value={ac.status} onChange={e => setAcField('status', e.target.value)}>
                          {['À faire','En cours','Complétée'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      </Field>
                      <Field label="Date de clôture"><input type="date" value={ac.close_date} onChange={e => setAcField('close_date', e.target.value)} /></Field>
                    </Row2>
                    <Field label="Notes de suivi"><textarea rows={2} placeholder="Notes additionnelles..." value={ac.notes} onChange={e => setAcField('notes', e.target.value)} style={{ marginTop: 8 }} /></Field>
                  </>
                ),
              },
            ].map(({ title, body }) => (
              <div key={title} style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 10, border: '0.5px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>{title}</div>
                {body}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '0.5px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>Annuler</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleSubmit(true)} disabled={saving} style={btnStyle('draft')}>💾 Brouillon</button>
            <button onClick={() => handleSubmit(false)} disabled={saving} style={btnStyle('primary')}>
              {saving ? 'Création...' : '📤 Créer le ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      {label && <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>{label}</label>}
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  )
}
function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>{children}</div>
}
function Sep() {
  return <div style={{ width: '0.5px', height: 18, background: '#e5e7eb', margin: '0 3px' }} />
}
function ToolBtn({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 28, height: 28, border: active ? '0.5px solid #374151' : '0.5px solid transparent',
      borderRadius: 6, background: active ? '#fff' : 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, color: active ? '#111' : '#6b7280',
    }}>
      {children}
    </button>
  )
}
function btnStyle(variant) {
  const base = { padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
  if (variant === 'primary') return { ...base, background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
  if (variant === 'draft')   return { ...base, background: '#fff', color: '#374151', border: '0.5px solid #d1d5db' }
  return { ...base, background: 'none', color: '#6b7280', border: 'none' }
}
