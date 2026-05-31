import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ticketApi } from '../../services/api'
import toast from 'react-hot-toast'

const DEPARTMENTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]
const CATEGORIES = ['Damaged','Missing Part','Wrong Item','Quality Defect','Packaging','Documentation','Delay']
const BRANDS     = ['BDI','Casabianca','Euro Style','Nexera','Tvilum']
const PLANTS     = ['Vietnam','China','Canada','USA']
const STATUSES   = ['not_started','wip','completed','cancelled']
const STATUS_LBL = { not_started:'Not started', wip:'WIP', completed:'Completed', cancelled:'Cancelled' }
const ANN_COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#1f2937','#ffffff']

function makeArrow(x1, y1, x2, y2, color, lw) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const sz    = 10 + lw * 1.5
  const line  = new window.fabric.Line([x1, y1, x2, y2], { stroke: color, strokeWidth: lw, selectable: false })
  const head  = new window.fabric.Triangle({
    left: x2, top: y2, width: sz, height: sz,
    fill: color, angle: (angle * 180) / Math.PI + 90,
    originX: 'center', originY: 'center', selectable: false,
  })
  return new window.fabric.Group([line, head], { selectable: false, evented: false })
}

function PhotoAnnotator({ photos, activeIdx, onActivate, onAddPhoto, fabricRef }) {
  const canvasElRef  = useRef(null)
  const wrapRef      = useRef(null)
  const fabricInst   = useRef(null)
  const statesRef    = useRef({})
  const [tool,  setTool]  = useState('select')
  const [color, setColor] = useState('#ef4444')
  const [thick, setThick] = useState(3)
  const isDrawing    = useRef(false)
  const startPt      = useRef({ x:0, y:0 })
  const activeObj    = useRef(null)
  const toolRef      = useRef('select')
  const colorRef     = useRef('#ef4444')
  const thickRef     = useRef(3)
  const activeIdxRef = useRef(activeIdx)
  const canvasReady  = useRef(false)

  useEffect(() => { toolRef.current  = tool  }, [tool])
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { thickRef.current = thick }, [thick])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])

  fabricRef.current = {
    saveState: () => {
      if (fabricInst.current) statesRef.current[activeIdxRef.current] = fabricInst.current.toJSON()
    },
  }

  const loadPhotoOnCanvas = useCallback((fc, photo, idx) => {
    if (!fc || !photo) return
    const wrap  = wrapRef.current
    const maxW  = wrap ? wrap.clientWidth - 4 : 600
    const maxH  = 340
    const img   = photo.img
    const scale = Math.min(maxW / img.width, maxH / img.height, 1)
    const W     = Math.round(img.width  * scale)
    const H     = Math.round(img.height * scale)
    fc.setWidth(W)
    fc.setHeight(H)
    const saved = statesRef.current[idx]
    if (saved) {
      fc.loadFromJSON(saved, () => fc.renderAll())
    } else {
      fc.clear()
      const fImg = new window.fabric.Image(img, {
        left: 0, top: 0, scaleX: scale, scaleY: scale,
        selectable: false, evented: false,
      })
      fc.setBackgroundImage(fImg, fc.renderAll.bind(fc))
    }
  }, [])

  // Init Fabric once when canvas element is available
  useEffect(() => {
    if (!canvasElRef.current || !window.fabric || canvasReady.current) return
    canvasReady.current = true

    const fc = new window.fabric.Canvas(canvasElRef.current, {
      selection: true,
      preserveObjectStacking: true,
    })
    fabricInst.current = fc

    // ── mouse:down: only start drawing if tool is NOT select ──
    fc.on('mouse:down', (opt) => {
      const t = toolRef.current
      // If clicking on an existing object in any mode, let Fabric handle it natively
      if (opt.target) return
      if (t === 'select') return
      if (t === 'text') {
        const p = fc.getPointer(opt.e)
        const itext = new window.fabric.IText('Annotation', {
          left: p.x, top: p.y,
          fontSize: 14 + thickRef.current * 2,
          fill: colorRef.current,
          fontFamily: 'sans-serif',
          editable: true, selectable: true,
        })
        fc.add(itext)
        fc.setActiveObject(itext)
        itext.enterEditing()
        itext.selectAll()
        fc.renderAll()
        statesRef.current[activeIdxRef.current] = fc.toJSON()
        return
      }
      if (t === 'pen') return
      isDrawing.current = true
      const p = fc.getPointer(opt.e)
      startPt.current = { x: p.x, y: p.y }
    })

    fc.on('mouse:move', (opt) => {
      if (!isDrawing.current) return
      const t  = toolRef.current
      if (t === 'pen' || t === 'select' || t === 'text') return
      const p  = fc.getPointer(opt.e)
      const sx = startPt.current.x, sy = startPt.current.y
      const c  = colorRef.current, lw = thickRef.current
      if (activeObj.current) { fc.remove(activeObj.current); activeObj.current = null }
      let shape
      if (t === 'arrow') {
        shape = makeArrow(sx, sy, p.x, p.y, c, lw)
      } else if (t === 'rect') {
        shape = new window.fabric.Rect({
          left: Math.min(sx, p.x), top: Math.min(sy, p.y),
          width: Math.abs(p.x - sx), height: Math.abs(p.y - sy),
          fill: 'transparent', stroke: c, strokeWidth: lw, selectable: false,
        })
      } else if (t === 'circle') {
        const rx = Math.abs(p.x - sx) / 2, ry = Math.abs(p.y - sy) / 2
        shape = new window.fabric.Ellipse({
          left: Math.min(sx, p.x), top: Math.min(sy, p.y),
          rx, ry, fill: 'transparent', stroke: c, strokeWidth: lw, selectable: false,
        })
      }
      if (shape) { fc.add(shape); activeObj.current = shape; fc.renderAll() }
    })

    fc.on('mouse:up', () => {
      if (!isDrawing.current) return
      isDrawing.current = false
      fc.isDrawingMode = false
      fc.selection = true
      if (activeObj.current) {
        activeObj.current.set({ selectable: true, evented: true })
        fc.setActiveObject(activeObj.current)
        activeObj.current = null
      }
      fc.renderAll()
      statesRef.current[activeIdxRef.current] = fc.toJSON()
    })

    fc.on('object:modified', () => {
      statesRef.current[activeIdxRef.current] = fc.toJSON()
    })

    return () => { fc.dispose(); canvasReady.current = false }
  }, [photos.length > 0])

  // Sync tool mode to Fabric
  useEffect(() => {
    const fc = fabricInst.current
    if (!fc) return
    if (tool === 'select') {
      fc.isDrawingMode = false
      fc.selection = true
      fc.defaultCursor = 'default'
      fc.hoverCursor = 'move'
      fc.forEachObject(o => { o.selectable = true; o.evented = true })
      fc.renderAll()
    } else if (tool === 'pen') {
      fc.isDrawingMode = true
      fc.freeDrawingBrush.color = color
      fc.freeDrawingBrush.width = thick
      fc.selection = false
    } else if (tool === 'text') {
      fc.isDrawingMode = false
      fc.selection = false
      fc.defaultCursor = 'text'
    } else {
      fc.isDrawingMode = false
      fc.selection = false
      fc.defaultCursor = 'crosshair'
      fc.forEachObject(o => { o.selectable = false; o.evented = false })
      fc.renderAll()
    }
  }, [tool, color, thick])

  // Load photo when activeIdx or photos change
  useEffect(() => {
    const fc = fabricInst.current
    if (!fc || !photos[activeIdx]) return
    loadPhotoOnCanvas(fc, photos[activeIdx], activeIdx)
  }, [activeIdx, photos, loadPhotoOnCanvas])

  const undo = () => {
    const fc = fabricInst.current
    if (!fc) return
    const objs = fc.getObjects()
    if (objs.length > 0) { fc.remove(objs[objs.length - 1]); fc.renderAll(); statesRef.current[activeIdx] = fc.toJSON() }
  }

  const deleteSelected = () => {
    const fc = fabricInst.current
    if (!fc) return
    const obj = fc.getActiveObject()
    if (obj) { fc.remove(obj); fc.renderAll(); statesRef.current[activeIdx] = fc.toJSON() }
  }

  const clearAll = () => {
    const fc = fabricInst.current
    if (!fc || !photos[activeIdx]) return
    delete statesRef.current[activeIdx]
    loadPhotoOnCanvas(fc, photos[activeIdx], activeIdx)
  }

  const toolNames = { select:'SÉLECTION', pen:'STYLO', arrow:'FLÈCHE', rect:'RECTANGLE', circle:'CERCLE', text:'TEXTE' }

  return (
    <div>
      <div style={S.toolbar}>
        <span style={S.badge}>{toolNames[tool]}</span>
        <VSep />
        {[
          { id:'select', icon:'⬡', title:'Sélectionner / déplacer / redimensionner' },
          { id:'pen',    icon:'✏️', title:'Dessin libre' },
          { id:'arrow',  icon:'↗',  title:'Flèche' },
          { id:'rect',   icon:'▭',  title:'Rectangle' },
          { id:'circle', icon:'◯',  title:'Ellipse' },
          { id:'text',   icon:'T',  title:'Texte éditable' },
        ].map(t => (
          <TB key={t.id} active={tool === t.id} onClick={() => setTool(t.id)} title={t.title}>{t.icon}</TB>
        ))}
        <VSep />
        {ANN_COLORS.map(c => (
          <div key={c} onClick={() => setColor(c)} style={{
            width:15, height:15, borderRadius:'50%', background:c, cursor:'pointer', flexShrink:0,
            border: color === c ? '2.5px solid #374151' : c === '#ffffff' ? '1px solid #d1d5db' : '1.5px solid transparent',
            transform: color === c ? 'scale(1.25)' : 'scale(1)', transition:'transform 0.1s',
          }} />
        ))}
        <VSep />
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ fontSize:10, color:'#6b7280' }}>≡</span>
          <input type="range" min="1" max="12" step="1" value={thick}
            onChange={e => setThick(Number(e.target.value))}
            style={{ width:46, accentColor:'#2563eb' }} />
          <span style={{ fontSize:10, fontWeight:500, color:'#374151', minWidth:12 }}>{thick}</span>
        </div>
        <VSep />
        <TB onClick={undo} title="Annuler dernier">↩</TB>
        <TB onClick={deleteSelected} title="Supprimer sélection">🗑</TB>
        <TB onClick={clearAll} title="Tout effacer">⌫</TB>
      </div>

      <div ref={wrapRef} style={S.canvasWrap}>
        {photos.length === 0 ? (
          <div style={S.uploadPh}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, width:260 }}>
              {[
                { label:'Prendre photo', icon:'📷', capture:'environment' },
                { label:'Depuis galerie', icon:'🖼️', capture:undefined },
              ].map(({ label, icon, capture }) => (
                <label key={label} style={S.upBtn}>
                  <span style={{ fontSize:22 }}>{icon}</span>
                  {label}
                  <input type="file" accept="image/*" multiple capture={capture}
                    onChange={onAddPhoto} style={{ display:'none' }} />
                </label>
              ))}
            </div>
            <small style={{ fontSize:11, color:'#9ca3af' }}>Ou faites glisser une image ici</small>
          </div>
        ) : (
          <canvas ref={canvasElRef} />
        )}
      </div>

      {photos.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:8 }}>
          {photos.map((p, i) => (
            <img key={i} src={p.src} onClick={() => onActivate(i)} style={{
              width:48, height:48, objectFit:'cover', borderRadius:6, cursor:'pointer',
              border: i === activeIdx ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
            }} />
          ))}
          <label style={S.addThumb}>
            +<input type="file" accept="image/*" multiple onChange={onAddPhoto} style={{ display:'none' }} />
          </label>
        </div>
      )}
      <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>{photos.length} photo(s)</div>
    </div>
  )
}

function VSep() { return <div style={{ width:'0.5px', height:18, background:'#e5e7eb', margin:'0 3px', flexShrink:0 }} /> }
function TB({ children, active, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width:28, height:28, border: active ? '1px solid #374151' : '1px solid transparent',
      borderRadius:6, background: active ? '#fff' : 'none', cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:13, color: active ? '#111827' : '#6b7280', flexShrink:0,
    }}>{children}</button>
  )
}

export default function TicketModal({ onClose }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('info')
  const [saving,    setSaving]    = useState(false)
  const fabricRef  = useRef({})
  const [photos,   setPhotos]    = useState([])
  const [activePhoto, setActivePhoto] = useState(0)
  const [fabricLoaded, setFabricLoaded] = useState(!!window.fabric)

  const [form, setForm] = useState({
    issue_reception_date:'', meeting_date:'', department:'', categories:'',
    brand:'', plant:'', status:'not_started', quality_issue:'',
    ship_to:'', sold_to:'', ref_so:'', sc_number:'', qty_affected:'', cost_approx:'',
  })
  const [ac, setAc] = useState({
    assigned_to:'', due_date:'', description:'', status:'À faire', close_date:'', notes:'',
  })

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const sa = (k, v) => setAc(a => ({ ...a, [k]: v }))

  useEffect(() => {
    if (window.fabric) { setFabricLoaded(true); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js'
    s.onload = () => setFabricLoaded(true)
    document.head.appendChild(s)
  }, [])

  const handleAddPhoto = useCallback((e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const img = new Image()
        img.onload = () => {
          setPhotos(prev => {
            const next = [...prev, { img, src: ev.target.result }]
            if (next.length === 1) setActivePhoto(0)
            return next
          })
        }
        img.src = ev.target.result
      }
      reader.readAsDataURL(file)
    })
  }, [])

  const handleActivate = useCallback((idx) => {
    fabricRef.current?.saveState?.()
    setActivePhoto(idx)
  }, [])

  const handleTabChange = (tab) => {
    fabricRef.current?.saveState?.()
    setActiveTab(tab)
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
        date_yyyy_mm: form.issue_reception_date?.slice(0, 7) || null,
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

  const inp = {
    width:'100%', fontSize:13, padding:'7px 10px',
    border:'1px solid #d1d5db', borderRadius:7,
    background:'#fff', color:'#111827', outline:'none', boxSizing:'border-box',
  }

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ padding:'16px 44px 12px 20px', borderBottom:'1px solid #e5e7eb' }}>
          <div style={{ fontSize:15, fontWeight:500, color:'#111827' }}>Nouveau ticket qualité</div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            Tous les champs marqués <span style={{ color:'#ef4444' }}>*</span> sont obligatoires
          </div>
          <button onClick={onClose} style={{ position:'absolute', top:14, right:16, background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ display:'flex', borderBottom:'1px solid #e5e7eb', padding:'0 20px' }}>
          {[
            { id:'info', label:'Informations',      icon:'ⓘ' },
            { id:'pj',   label:`Pièces jointes ${photos.length}`, icon:'📎' },
            { id:'ac',   label:'Action corrective', icon:'🔧' },
          ].map(tab => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id)} style={{
              padding:'10px 14px 9px', fontSize:13, cursor:'pointer', border:'none', background:'none',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab.id ? 500 : 400,
              display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap',
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'info' && (
          <div style={S.body}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <F2 label="Date réception *"><input style={inp} type="date" value={form.issue_reception_date} onChange={e => sf('issue_reception_date', e.target.value)} /></F2>
              <F2 label="Date réunion"><input style={inp} type="date" value={form.meeting_date} onChange={e => sf('meeting_date', e.target.value)} /></F2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <F2 label="Département *">
                <select style={inp} value={form.department} onChange={e => sf('department', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </F2>
              <F2 label="Catégorie *">
                <select style={inp} value={form.categories} onChange={e => sf('categories', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </F2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
              <F2 label="Marque (Brand)">
                <select style={inp} value={form.brand} onChange={e => sf('brand', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </F2>
              <F2 label="Usine (Plant)">
                <select style={inp} value={form.plant} onChange={e => sf('plant', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {PLANTS.map(p => <option key={p}>{p}</option>)}
                </select>
              </F2>
              <F2 label="Statut">
                <select style={inp} value={form.status} onChange={e => sf('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{STATUS_LBL[s]}</option>)}
                </select>
              </F2>
            </div>
            <div style={{ marginBottom:10 }}>
              <F2 label="Problème qualité (Quality issue) *">
                <textarea style={{ ...inp, resize:'vertical', height:80 }}
                  placeholder="Décrire le problème en détail..."
                  value={form.quality_issue} onChange={e => sf('quality_issue', e.target.value)} />
              </F2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <F2 label="Ship To"><input style={inp} placeholder="Ex: HIEX Page, AZ" value={form.ship_to} onChange={e => sf('ship_to', e.target.value)} /></F2>
              <F2 label="Sold To"><input style={inp} placeholder="Ex: Hilton Supply Management" value={form.sold_to} onChange={e => sf('sold_to', e.target.value)} /></F2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:10 }}>
              <F2 label="REF SO"><input style={inp} placeholder="66882" value={form.ref_so} onChange={e => sf('ref_so', e.target.value)} /></F2>
              <F2 label="SC#"><input style={inp} placeholder="68489" value={form.sc_number} onChange={e => sf('sc_number', e.target.value)} /></F2>
              <F2 label="Qté affectée"><input style={inp} type="number" placeholder="1" value={form.qty_affected} onChange={e => sf('qty_affected', e.target.value)} /></F2>
              <F2 label="Coût approx. $"><input style={inp} type="number" placeholder="800" value={form.cost_approx} onChange={e => sf('cost_approx', e.target.value)} /></F2>
            </div>
            <div onClick={() => handleTabChange('pj')} style={S.dropZone}>
              <div style={{ fontSize:24, marginBottom:6 }}>☁</div>
              <div style={{ fontSize:13, fontWeight:500, color:'#374151', marginBottom:3 }}>Glisser les fichiers ici ou cliquer pour parcourir</div>
              <div style={{ fontSize:11, color:'#9ca3af', marginBottom:8 }}>JPG, PNG, PDF, Word, Excel, Vidéo · Max 20 MB par fichier</div>
              <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
                {[['📷','Photo','#eff6ff','#1d4ed8'],['📄','PDF','#fef2f2','#b91c1c'],['📊','Excel','#f0fdf4','#15803d'],['🎬','Vidéo','#fdf4ff','#9333ea']].map(([ic,lb,bg,cl]) => (
                  <span key={lb} style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:bg, color:cl, fontWeight:500 }}>{ic} {lb}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pj' && (
          <div style={S.body}>
            <div style={S.secLabel}>PHOTOS D'INSPECTION</div>
            {fabricLoaded ? (
              <PhotoAnnotator
                photos={photos} activeIdx={activePhoto}
                onActivate={handleActivate} onAddPhoto={handleAddPhoto}
                fabricRef={fabricRef}
              />
            ) : (
              <div style={{ padding:30, textAlign:'center', color:'#9ca3af', fontSize:13 }}>
                Chargement des outils d'annotation…
              </div>
            )}
            <div style={{ marginTop:16 }}>
              <div style={S.secLabel}>AUTRES PIÈCES JOINTES</div>
              <label style={{ ...S.dropZone, cursor:'pointer' }}>
                <div style={{ fontSize:22, marginBottom:4 }}>📁</div>
                <div style={{ fontSize:13, fontWeight:500, color:'#374151' }}>PDF, Word, Excel, Vidéo</div>
                <div style={{ fontSize:11, color:'#9ca3af' }}>Max 20 MB par fichier</div>
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.mp4,.mov" multiple style={{ display:'none' }} />
              </label>
            </div>
          </div>
        )}

        {activeTab === 'ac' && (
          <div style={S.body}>
            {[
              {
                title:'👤 Responsable',
                body:(
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <F2 label="Assigné à"><input style={inp} placeholder="Nom du responsable" value={ac.assigned_to} onChange={e => sa('assigned_to', e.target.value)} /></F2>
                    <F2 label="Date limite"><input style={inp} type="date" value={ac.due_date} onChange={e => sa('due_date', e.target.value)} /></F2>
                  </div>
                ),
              },
              {
                title:"📋 Description de l'action",
                body:<F2 label=""><textarea style={{ ...inp, resize:'vertical', height:90 }} placeholder="Décrire l'action corrective…" value={ac.description} onChange={e => sa('description', e.target.value)} /></F2>,
              },
              {
                title:'✅ Suivi',
                body:(
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:8 }}>
                      <F2 label="Statut action">
                        <select style={inp} value={ac.status} onChange={e => sa('status', e.target.value)}>
                          {['À faire','En cours','Complétée'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      </F2>
                      <F2 label="Date de clôture"><input style={inp} type="date" value={ac.close_date} onChange={e => sa('close_date', e.target.value)} /></F2>
                    </div>
                    <F2 label="Notes"><textarea style={{ ...inp, resize:'vertical', height:56 }} placeholder="Notes additionnelles…" value={ac.notes} onChange={e => sa('notes', e.target.value)} /></F2>
                  </>
                ),
              },
            ].map(({ title, body }) => (
              <div key={title} style={S.acBlock}>
                <div style={{ fontSize:12, fontWeight:500, marginBottom:8, color:'#374151' }}>{title}</div>
                {body}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding:'12px 20px', borderTop:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={onClose} style={{ padding:'8px 14px', borderRadius:7, fontSize:13, cursor:'pointer', background:'none', border:'none', color:'#6b7280', display:'inline-flex', alignItems:'center', gap:4 }}>
            ✕ Annuler
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => handleSubmit(true)} disabled={saving} style={{ padding:'8px 16px', borderRadius:7, fontSize:13, cursor:'pointer', background:'#fff', color:'#374151', border:'1px solid #d1d5db', display:'inline-flex', alignItems:'center', gap:5 }}>
              💾 Brouillon
            </button>
            <button onClick={() => handleSubmit(false)} disabled={saving} style={{ padding:'8px 18px', borderRadius:7, fontSize:13, cursor:'pointer', background:'#2563eb', color:'#fff', border:'1px solid #2563eb', display:'inline-flex', alignItems:'center', gap:5, fontWeight:500 }}>
              {saving ? 'Création…' : '📤 Créer le ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function F2({ label, children }) {
  return (
    <div>
      {label && <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>{label}</label>}
      {children}
    </div>
  )
}

const S = {
  overlay:    { position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'28px 16px', zIndex:1000, overflowY:'auto' },
  modal:      { background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', width:'100%', maxWidth:640, boxShadow:'0 24px 48px rgba(0,0,0,0.18)', position:'relative' },
  body:       { padding:'16px 20px', maxHeight:'calc(100vh - 280px)', overflowY:'auto' },
  toolbar:    { display:'flex', alignItems:'center', gap:3, flexWrap:'wrap', background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:8, padding:'5px 8px', marginBottom:8 },
  badge:      { fontSize:10, fontWeight:500, color:'#2563eb', background:'#eff6ff', padding:'2px 7px', borderRadius:4, border:'1px solid #bfdbfe', marginRight:4, whiteSpace:'nowrap' },
  canvasWrap: { border:'1.5px dashed #d1d5db', borderRadius:8, background:'#f9fafb', overflow:'hidden', position:'relative', minHeight:200 },
  uploadPh:   { position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12 },
  upBtn:      { padding:'12px 8px', border:'1px dashed #d1d5db', borderRadius:8, background:'#fff', cursor:'pointer', textAlign:'center', color:'#6b7280', fontSize:12, display:'flex', flexDirection:'column', alignItems:'center', gap:5 },
  addThumb:   { width:48, height:48, borderRadius:6, border:'1.5px dashed #d1d5db', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:20, color:'#9ca3af', background:'#f9fafb' },
  dropZone:   { border:'1.5px dashed #d1d5db', borderRadius:8, padding:'18px 16px', textAlign:'center', cursor:'pointer', background:'#f9fafb', display:'block', marginTop:4 },
  secLabel:   { fontSize:10, fontWeight:600, letterSpacing:'0.08em', color:'#9ca3af', marginBottom:8 },
  acBlock:    { background:'#f9fafb', borderRadius:8, padding:12, marginBottom:10, border:'1px solid #e5e7eb' },
}
