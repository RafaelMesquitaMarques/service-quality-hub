import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { supabase } from '../../services/supabase'
import { PageHeader, Spinner, StatusBadge } from '../../components/ui'
import { usePermissions } from '../../hooks/usePermissions'
import { useThemeStore } from '../../store/themeStore'
import { normalizeMediaFile, isVideoFile, isVideoUrl, MAX_VIDEO_BYTES, MAX_VIDEO_MB } from '../../utils/media'
import toast from 'react-hot-toast'

const STATUS_OPTS = ['not_started','service_desk','quality_meeting','completed','cancelled']
const STATUS_LBL  = {
  not_started:     'Not started',
  service_desk:    'Service Desk',
  quality_meeting: 'Quality Meeting',
  completed:       'Completed',
  cancelled:       'Cancelled',
}
const STATUS_CLR_LIGHT = {
  not_started:     { bg:'#f3f4f6', color:'#6b7280' },
  service_desk:    { bg:'#E6F1FB', color:'#0C447C' },
  quality_meeting: { bg:'#FAEEDA', color:'#633806' },
  completed:       { bg:'#eaf3de', color:'#27500a' },
  cancelled:       { bg:'#fcebeb', color:'#791f1f' },
}
const STATUS_CLR_DARK = {
  not_started:     { bg:'#1f2937', color:'#9ca3af' },
  service_desk:    { bg:'#1e3a5f', color:'#93c5fd' },
  quality_meeting: { bg:'#3b2a00', color:'#fcd34d' },
  completed:       { bg:'#14532d', color:'#86efac' },
  cancelled:       { bg:'#4a1b0c', color:'#fca5a5' },
}
const DEPARTMENTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]
const CATEGORIES = ['Damage','Missing parts','Wrong item','Assembly issue','Finish defect','Packaging','Measurement','Other']
const ROOT_CAUSES = ['Fabrication','Matériau','Conception/design','Assemblage','Transport/manutention','Fournisseur','Installation','Commande/spécification','Autre']
const URGENCIES   = ['overnight','urgent','normal']
const URGENCY_LBL = { overnight:'Overnight', urgent:'Urgent', normal:'Normal' }
const COLORS  = ['#E24B4A','#185FA5','#1D9E75','#BA7517','#888780','#ffffff']
const TOOLS   = [
  { id:'select',  icon:'ti-cursor-text',    label:'Sélection' },
  { id:'pen',     icon:'ti-pencil',         label:'Stylo' },
  { id:'arrow',   icon:'ti-arrow-up-right', label:'Flèche' },
  { id:'rect',    icon:'ti-square',         label:'Rectangle' },
  { id:'circle',  icon:'ti-circle',         label:'Cercle' },
  { id:'text',    icon:'ti-letter-t',       label:'Texte' },
  { id:'measure', icon:'ti-ruler',          label:'Mesure' },
]

// Status pipeline para avançar/recuar
const STATUS_FLOW = ['not_started','service_desk','quality_meeting','completed']
function nextStatus(s) {
  const i = STATUS_FLOW.indexOf(s)
  return i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null
}
function prevStatus(s) {
  if (s === 'cancelled') return null
  if (s === 'completed') return 'quality_meeting'
  const i = STATUS_FLOW.indexOf(s)
  return i > 0 ? STATUS_FLOW[i - 1] : null
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

// ── Champ d'une ligne (libellé / valeur, fond zébré) ───────────────────────
function LineField({ label, value, highlight }) {
  return (
    <div className="flex justify-between py-1.5 px-2 odd:bg-white dark:odd:bg-gray-900 even:bg-gray-100 dark:even:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
      <span className="text-gray-400">{label}</span>
      <span className={`text-gray-900 dark:text-gray-100 ${highlight ? 'text-red-500 font-medium' : ''}`}>{value}</span>
    </div>
  )
}

// ── Lightbox (visualisation agrandie avec zoom) ────────────────────────────
function Lightbox({ url, onClose }) {
  const [scale, setScale] = useState(1)
  const [pos,   setPos]   = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const zoomBy = (d) => setScale(s => {
    const ns = Math.min(6, Math.max(1, +(s + d).toFixed(2)))
    if (ns <= 1) setPos({ x: 0, y: 0 })
    return ns
  })
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }) }

  const onWheel = (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.3 : -0.3) }
  const onDown  = (e) => { if (scale > 1) drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y } }
  const onMove  = (e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }) }
  const onUp    = () => { drag.current = null }

  const btn = "w-9 h-9 rounded-full flex items-center justify-center text-white text-base border-0 cursor-pointer"
  const btnStyle = { background: 'rgba(255,255,255,0.15)' }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center select-none"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose} onWheel={onWheel} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
      <div className="absolute top-4 right-4 flex gap-2 z-10" onClick={e => e.stopPropagation()}>
        <button className={btn} style={btnStyle} onClick={() => zoomBy(-0.5)} title="Dézoomer"><i className="ti ti-minus" /></button>
        <button className={btn} style={btnStyle} onClick={() => zoomBy(0.5)}  title="Zoomer"><i className="ti ti-plus" /></button>
        <button className={btn} style={btnStyle} onClick={reset}              title="Réinitialiser"><i className="ti ti-aspect-ratio" /></button>
        <button className={btn} style={btnStyle} onClick={onClose}            title="Fermer">✕</button>
      </div>
      <img src={url} draggable={false} alt=""
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.stopPropagation(); scale > 1 ? reset() : setScale(2.5) }}
        onMouseDown={onDown}
        style={{
          maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain',
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transition: drag.current ? 'none' : 'transform 0.12s ease-out',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs" onClick={e => e.stopPropagation()}>
        {Math.round(scale * 100)}% · molette ou double-clic pour zoomer
      </div>
    </div>
  )
}

// ── Photo Annotator ────────────────────────────────────────────────────────
function PhotoAnnotator({ photo, onSave, onClose }) {
  const canvasRef  = useRef(null)
  const fabricRef  = useRef(null)
  const [tool,     setTool]     = useState('select')
  const [color,    setColor]    = useState('#E24B4A')
  const [thick,    setThick]    = useState(3)
  const [measuring, setMeasuring] = useState(false)
  const [measureVal, setMeasureVal] = useState('')
  const [measureGrp, setMeasureGrp] = useState(null)
  const [fabricReady, setFabricReady] = useState(!!window.fabric)

  useEffect(() => {
    if (window.fabric) { setFabricReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js'
    s.onload = () => setFabricReady(true)
    s.onerror = () => {
      const s2 = document.createElement('script')
      s2.src = 'https://cdn.jsdelivr.net/npm/fabric@5.3.1/dist/fabric.min.js'
      s2.onload = () => setFabricReady(true)
      document.head.appendChild(s2)
    }
    document.head.appendChild(s)
  }, [])

  useEffect(() => {
    if (!fabricReady || !canvasRef.current) return
    const canvas = new window.fabric.Canvas(canvasRef.current, { width: 560, height: 340 })
    fabricRef.current = canvas
    const src = photo.url || photo.preview
    const addImageToCanvas = (dataUrl) => {
      const imgEl = new Image()
      imgEl.onload = () => {
        const fabricImg = new window.fabric.Image(imgEl)
        const scale = Math.min(560 / imgEl.width, 380 / imgEl.height, 1)
        fabricImg.scale(scale)
        canvas.setWidth(Math.round(imgEl.width * scale))
        canvas.setHeight(Math.round(imgEl.height * scale))
        canvas.add(fabricImg)
        fabricImg.selectable = false
        fabricImg.evented = false
        canvas.sendToBack(fabricImg)
        canvas.renderAll()
      }
      imgEl.src = dataUrl
    }
    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader()
        reader.onload = e => addImageToCanvas(e.target.result)
        reader.readAsDataURL(blob)
      })
      .catch(() => addImageToCanvas(src))
    return () => canvas.dispose()
  }, [fabricReady])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.isDrawingMode = false
    canvas.off('mouse:down'); canvas.off('mouse:move'); canvas.off('mouse:up')
    if (tool === 'pen') {
      canvas.isDrawingMode = true
      canvas.freeDrawingBrush.color = color
      canvas.freeDrawingBrush.width = thick
      return
    }
    canvas.selection = tool === 'select'
    if (tool === 'measure') {
      let pts = []; let tempLine = null
      canvas.on('mouse:down', o => {
        const p = canvas.getPointer(o.e)
        if (pts.length === 0) { pts = [p] }
        else {
          pts.push(p)
          if (tempLine) canvas.remove(tempLine)
          const line = new window.fabric.Line([pts[0].x,pts[0].y,pts[1].x,pts[1].y],{stroke:color,strokeWidth:2,selectable:false,evented:false})
          const d1 = new window.fabric.Circle({left:pts[0].x-4,top:pts[0].y-4,radius:4,fill:color,selectable:false,evented:false})
          const d2 = new window.fabric.Circle({left:pts[1].x-4,top:pts[1].y-4,radius:4,fill:color,selectable:false,evented:false})
          const grp = new window.fabric.Group([line,d1,d2],{selectable:true})
          canvas.add(grp); setMeasureGrp(grp); canvas.renderAll()
          pts = []; setMeasuring(true)
        }
      })
      canvas.on('mouse:move', o => {
        if (pts.length === 1) {
          if (tempLine) canvas.remove(tempLine)
          const p = canvas.getPointer(o.e)
          tempLine = new window.fabric.Line([pts[0].x,pts[0].y,p.x,p.y],{stroke:color,strokeWidth:2,selectable:false,strokeDashArray:[4,4]})
          canvas.add(tempLine); canvas.renderAll()
        }
      })
      return
    }
    if (['arrow','rect','circle','text'].includes(tool)) {
      let origin = null; let shape = null
      canvas.on('mouse:down', o => {
        origin = canvas.getPointer(o.e)
        if (tool === 'text') {
          const txt = new window.fabric.IText('Text',{left:origin.x,top:origin.y,fontSize:16,fill:color,fontFamily:'sans-serif',editable:true})
          canvas.add(txt); canvas.setActiveObject(txt); txt.enterEditing(); canvas.renderAll(); origin = null
        }
      })
      canvas.on('mouse:move', o => {
        if (!origin) return
        const p = canvas.getPointer(o.e)
        if (shape) canvas.remove(shape)
        if (tool === 'rect') shape = new window.fabric.Rect({left:Math.min(origin.x,p.x),top:Math.min(origin.y,p.y),width:Math.abs(p.x-origin.x),height:Math.abs(p.y-origin.y),stroke:color,strokeWidth:thick,fill:'transparent'})
        else if (tool === 'circle') { const r=Math.sqrt(Math.pow(p.x-origin.x,2)+Math.pow(p.y-origin.y,2))/2; shape=new window.fabric.Circle({left:Math.min(origin.x,p.x),top:Math.min(origin.y,p.y),radius:r,stroke:color,strokeWidth:thick,fill:'transparent'}) }
        else if (tool === 'arrow') { const angle=Math.atan2(p.y-origin.y,p.x-origin.x)*180/Math.PI; const len=Math.sqrt(Math.pow(p.x-origin.x,2)+Math.pow(p.y-origin.y,2)); shape=new window.fabric.Group([new window.fabric.Line([0,0,len,0],{stroke:color,strokeWidth:thick}),new window.fabric.Triangle({width:12,height:14,fill:color,left:len-6,top:-7})],{left:origin.x,top:origin.y,angle,originX:'left',originY:'center'}) }
        if (shape) { canvas.add(shape); canvas.renderAll() }
      })
      canvas.on('mouse:up', () => { shape=null; origin=null })
    }
  }, [tool, color, thick, fabricReady])

  const handleSaveMeasure = () => {
    if (!measureVal || !measureGrp || !fabricRef.current) return
    const b = measureGrp.getBoundingRect()
    const bg = new window.fabric.Rect({left:b.left+b.width/2-30,top:b.top-22,width:60,height:20,fill:color,rx:4,ry:4,selectable:false})
    const tx = new window.fabric.Text(`${measureVal} cm`,{left:b.left+b.width/2,top:b.top-20,fontSize:11,fill:'white',fontFamily:'sans-serif',originX:'center',selectable:false})
    fabricRef.current.add(bg,tx); fabricRef.current.renderAll()
    setMeasuring(false); setMeasureVal(''); setMeasureGrp(null); setTool('select')
  }

  const handleUndo = () => {
    const c = fabricRef.current; if (!c) return
    const objs = c.getObjects(); if (objs.length > 1) { c.remove(objs[objs.length-1]); c.renderAll() }
  }

  const handleDeleteSelected = () => {
    const c = fabricRef.current; if (!c) return
    const active = c.getActiveObject()
    if (active?.isEditing) return // texte en cours d'édition
    const objs = c.getActiveObjects()
    if (!objs.length) return
    objs.forEach(o => c.remove(o))
    c.discardActiveObject()
    c.renderAll()
  }

  // Touche Delete/Backspace pour supprimer l'annotation sélectionnée
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const c = fabricRef.current; if (!c) return
      const active = c.getActiveObject()
      if (!active || active.isEditing) return
      e.preventDefault()
      handleDeleteSelected()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleSave = () => {
    const c = fabricRef.current; if (!c) return
    onSave(c.toDataURL({ format:'jpeg', quality:0.85 }))
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ maxWidth:620 }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Annotation</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer text-lg">✕</button>
        </div>
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1 flex-wrap bg-gray-50 dark:bg-[#0D1117]">
          {TOOLS.map(tk => (
            <button key={tk.id} onClick={() => setTool(tk.id)} title={tk.label} aria-label={tk.label}
              className="w-7 h-7 rounded flex items-center justify-center border cursor-pointer transition-all"
              style={{ border: tool===tk.id ? `1.5px solid ${color}` : '0.5px solid var(--color-border-tertiary)', background: tool===tk.id ? color+'22' : 'var(--color-background-primary)', color: tool===tk.id ? color : 'var(--color-text-secondary)' }}>
              <i className={`ti ${tk.icon}`} style={{ fontSize:13 }} aria-hidden="true" />
            </button>
          ))}
          <div style={{ width:1,height:20,background:'var(--color-border-tertiary)',margin:'0 3px' }} />
          {COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)} style={{ width:14,height:14,borderRadius:'50%',background:c,cursor:'pointer',border:color===c?'2px solid #185FA5':'1px solid var(--color-border-tertiary)',flexShrink:0 }} />
          ))}
          <div style={{ width:1,height:20,background:'var(--color-border-tertiary)',margin:'0 3px' }} />
          <input type="range" min="1" max="8" value={thick} onChange={e => setThick(Number(e.target.value))} style={{ width:60 }} />
          <div style={{ width:1,height:20,background:'var(--color-border-tertiary)',margin:'0 3px' }} />
          <button onClick={handleUndo} title="Annuler le dernier" aria-label="Annuler le dernier" className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 dark:border-gray-700 cursor-pointer bg-transparent">
            <i className="ti ti-arrow-back-up" style={{ fontSize:13,color:'var(--color-text-secondary)' }} aria-hidden="true" />
          </button>
          <button onClick={handleDeleteSelected} title="Supprimer la sélection (Delete)" aria-label="Supprimer la sélection" className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 dark:border-gray-700 cursor-pointer bg-transparent">
            <i className="ti ti-trash" style={{ fontSize:13, color:'#ef4444' }} aria-hidden="true" />
          </button>
        </div>
        {measuring && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3">
            <i className="ti ti-ruler text-amber-600 text-sm" aria-hidden="true" />
            <span className="text-xs text-amber-700 dark:text-amber-300">Mesure tracée — entrez la valeur:</span>
            <input type="text" value={measureVal} onChange={e => setMeasureVal(e.target.value)}
              className="border border-amber-300 rounded px-2 py-1 text-xs w-20 outline-none dark:bg-[#161B22] dark:text-gray-100"
              placeholder="ex: 35" autoFocus onKeyDown={e => e.key==='Enter' && handleSaveMeasure()} />
            <span className="text-xs text-amber-600">cm</span>
            <button onClick={handleSaveMeasure} className="btn-primary text-xs py-1 px-3">OK</button>
          </div>
        )}
        <div style={{ overflow:'auto', maxHeight:400 }}>
          <canvas ref={canvasRef} />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="btn-ghost text-xs">Annuler</button>
          <button onClick={handleSave} className="btn-primary text-xs">Sauvegarder</button>
        </div>
      </div>
    </div>
  )
}

// ── Line Card (display + edit) ─────────────────────────────────────────────
function LineCard({ line, occurrenceId, onUpdate, onDelete, plants, status, t, canEdit: canEditProp, onView }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ...line })
  const [annotating, setAnnotating] = useState(null)
  const fileRef = useRef(null)

  const { data: photos, refetch: refetchPhotos } = useQuery({
    queryKey: ['line-photos', line.id],
    queryFn: async () => {
      const { data } = await supabase.from('ticket_photos').select('*').eq('line_id', line.id).order('created_at')
      return data || []
    },
    enabled: !!line.id,
  })

  const uploadMut = useMutation({
    mutationFn: async (rawFile) => {
      const file  = await normalizeMediaFile(rawFile)
      const video = isVideoFile(file)
      const ext   = (file.name || 'photo.jpg').split('.').pop().replace(/[^a-z0-9]/gi, '') || 'jpg'
      const path  = `tickets/${occurrenceId}/${Date.now()}_line${line.id}.${ext}`
      const { error: upErr } = await supabase.storage.from('ticket-photos').upload(path, file, { contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
      const { error: dbErr } = await supabase.from('ticket_photos').insert({
        ticket_id: occurrenceId, url: urlData.publicUrl, name: file.name, path, line_id: line.id, media_type: video ? 'video' : 'image'
      })
      if (dbErr) throw dbErr
    },
    onSuccess: () => { refetchPhotos(); toast.success(t('common.save')) },
    onError: (e) => { console.error('Upload error:', e); toast.error(e?.message || t('common.error')) },
  })

  const deletePhotoMut = useMutation({
    mutationFn: async ({ photoId, path }) => {
      if (path) await supabase.storage.from('ticket-photos').remove([path])
      await supabase.from('ticket_photos').delete().eq('id', photoId)
    },
    onSuccess: () => refetchPhotos(),
  })

  const saveAnnotationMut = useMutation({
    mutationFn: async ({ photoId, path, dataUrl }) => {
      // Convert dataUrl to blob
      const arr  = dataUrl.split(',')
      const mime = arr[0].match(/:(.*?);/)[1]
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) u8arr[n] = bstr.charCodeAt(n)
      const blob = new Blob([u8arr], { type: mime })

      // Usar sempre o mesmo path base (remove _annotated se já existir)
      const basePath = path.replace(/_annotated(\.jpg)?$/, '').replace(/\.[^.]+$/, '')
      const newPath  = basePath + '_annotated.jpg'

      const { error: upErr } = await supabase.storage
        .from('ticket-photos')
        .upload(newPath, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(newPath)
      const { error: dbErr } = await supabase
        .from('ticket_photos')
        .update({ url: urlData.publicUrl, path: newPath })
        .eq('id', photoId)
      if (dbErr) throw dbErr
    },
    onSuccess: () => { refetchPhotos(); setAnnotating(null); toast.success(t('common.save')) },
    onError: (e) => { console.error('Annotation save error:', e); toast.error(e?.message || t('common.error')) },
  })

  const saveLine = async () => {
    const { error } = await supabase.from('occurrence_lines').update({
      quality_issue: form.quality_issue,
      description:   form.description || null,
      line_item:     form.line_item,
      foliot_id:     form.foliot_id,
      plant:         form.plant,
      affected_qty:  form.affected_qty ? Number(form.affected_qty) : null,
      total_qty:     form.total_qty    ? Number(form.total_qty)    : null,
      completion_type: form.completion_type || null,
      updated_at:    new Date().toISOString(),
    }).eq('id', line.id)
    if (error) { toast.error(t('common.error')); return }
    toast.success(t('common.save'))
    onUpdate()
    setEditing(false)
  }

  // canEdit: role-based (from parent) AND status allows it
  const canEditLine = canEditProp && ['service_desk','quality_meeting','not_started'].includes(status)

  const isVid       = p => p.media_type === 'video' || isVideoUrl(p.url)
  const videoPhotos = (photos || []).filter(p =>  isVid(p))
  const imgPhotos   = (photos || []).filter(p => !isVid(p) &&  p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))
  const filePhotos  = (photos || []).filter(p => !isVid(p) && !p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))

  const completionLabel = line.completion_type === 'complete' ? t('ticket.complete_product')
    : line.completion_type === 'parts' ? t('ticket.parts_only') : null

  const idFields = [
    [t('ticket.line_item'),      line.line_item],
    [t('ticket.foliot_id'),      line.foliot_id],
    [t('ticket.plant'),          line.plant],
    [t('ticket.completion_type'), completionLabel],
  ].filter(([, v]) => v)

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-[#161B22] border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{t('ticket.line_n')} {line.sort_order + 1}</span>
        </div>
        {canEditLine && (
          <div className="flex gap-1">
            <button onClick={() => setEditing(!editing)} className="btn-ghost text-xs py-0.5 px-2">
              <i className={`ti ${editing ? 'ti-x' : 'ti-edit'} text-xs`} aria-hidden="true" />
            </button>
            <button onClick={() => { if (window.confirm(t('ticket.delete_line'))) onDelete(line.id) }}
              className="text-xs py-0.5 px-2 rounded border border-red-200 dark:border-red-900 text-red-500 bg-transparent cursor-pointer">
              <i className="ti ti-trash text-xs" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="label">{t('ticket.issue')} *</label>
                <input className="input text-xs" value={form.quality_issue || ''} onChange={e => setForm(f => ({...f, quality_issue: e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="label">{t('ticket.description')}</label>
                <textarea className="input text-xs" rows={2} value={form.description || ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
              </div>
              <div>
                <label className="label">{t('ticket.line_item')}</label>
                <input className="input text-xs" value={form.line_item || ''} onChange={e => setForm(f => ({...f, line_item: e.target.value}))} />
              </div>
              <div>
                <label className="label">{t('ticket.foliot_id')}</label>
                <input className="input text-xs" value={form.foliot_id || ''} onChange={e => setForm(f => ({...f, foliot_id: e.target.value}))} />
              </div>
              <div>
                <label className="label">{t('ticket.plant')}</label>
                <select className="input text-xs" value={form.plant || ''} onChange={e => setForm(f => ({...f, plant: e.target.value}))}>
                  <option value="">—</option>
                  {(plants || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('ticket.affected_qty')}</label>
                <input className="input text-xs" type="number" value={form.affected_qty || ''} onChange={e => setForm(f => ({...f, affected_qty: e.target.value}))} />
              </div>
              <div>
                <label className="label">{t('ticket.total_qty')}</label>
                <input className="input text-xs" type="number" value={form.total_qty || ''} onChange={e => setForm(f => ({...f, total_qty: e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="label">{t('ticket.completion_type')}</label>
                <select className="input text-xs" value={form.completion_type || ''} onChange={e => setForm(f => ({...f, completion_type: e.target.value}))}>
                  <option value="">—</option>
                  <option value="complete">{t('ticket.complete_product')}</option>
                  <option value="parts">{t('ticket.parts_only')}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
              <button onClick={saveLine} className="btn-primary text-xs">{t('common.save')}</button>
            </div>
          </div>
        ) : (
          <div className="text-xs mb-2">
            {line.quality_issue && (
              <div className="text-gray-900 dark:text-gray-100 font-medium mb-1">{line.quality_issue}</div>
            )}
            {line.description && (
              <div className="text-gray-600 dark:text-gray-300 mb-2">{line.description}</div>
            )}
            {idFields.length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {idFields.map(([label, val]) => <LineField key={label} label={label} value={val} />)}
              </div>
            )}
            {/* Affected qty et Total qty toujours côte à côte */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
              <LineField label={t('ticket.affected_qty')} value={line.affected_qty != null ? line.affected_qty : '—'} />
              <LineField label={t('ticket.total_qty')}    value={line.total_qty    != null ? line.total_qty    : '—'} />
            </div>
          </div>
        )}

        {/* Photos */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
          {imgPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {imgPhotos.map(p => (
                <div key={p.id} className="relative group">
                  <img src={p.url} alt="" onClick={() => onView(p.url)}
                    className="w-24 h-24 object-cover rounded border border-gray-200 dark:border-gray-700 cursor-zoom-in" />
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canEditLine && (
                      <button onClick={e => { e.stopPropagation(); setAnnotating(p) }} title="Annoter"
                        className="w-5 h-5 rounded bg-black/60 hover:bg-black/80 text-white flex items-center justify-center border-0 cursor-pointer">
                        <i className="ti ti-pencil" style={{ fontSize:10 }} aria-hidden="true" />
                      </button>
                    )}
                    {canEditLine && (
                      <button onClick={e => { e.stopPropagation(); deletePhotoMut.mutate({ photoId: p.id, path: p.path }) }} title="Supprimer"
                        className="w-5 h-5 rounded bg-red-500 hover:bg-red-600 text-white flex items-center justify-center border-0 cursor-pointer">
                        <i className="ti ti-x" style={{ fontSize:10 }} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <i className="ti ti-zoom-in text-white" style={{ fontSize:13, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }} aria-hidden="true" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {videoPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {videoPhotos.map(p => (
                <div key={p.id} className="relative group">
                  <video src={p.url} controls playsInline className="w-44 rounded border border-gray-200 dark:border-gray-700 bg-black" />
                  {canEditLine && (
                    <button onClick={() => deletePhotoMut.mutate({ photoId: p.id, path: p.path })} title="Supprimer"
                      className="absolute top-1 right-1 w-5 h-5 rounded bg-red-500 hover:bg-red-600 text-white flex items-center justify-center border-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                      <i className="ti ti-x" style={{ fontSize:10 }} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {filePhotos.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-[#161B22] rounded text-xs mb-1">
              <i className="ti ti-file text-red-400 text-sm" aria-hidden="true" />
              <a href={p.url} target="_blank" rel="noreferrer" className="flex-1 text-blue-500 hover:underline">{p.name}</a>
              {canEditLine && (
                <button onClick={() => deletePhotoMut.mutate({ photoId: p.id, path: p.path })} className="text-red-400 bg-transparent border-0 cursor-pointer p-0">
                  <i className="ti ti-trash text-xs" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}

          {canEditLine && (
            <label className="btn-ghost text-xs py-1 px-2 cursor-pointer">
              <i className="ti ti-upload text-xs" aria-hidden="true" /> {(photos || []).length === 0 ? t('ticket.add_media') : t('common.add')}
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif,video/*,.pdf" multiple className="hidden"
                onChange={e => Array.from(e.target.files).forEach(f => {
                  if (isVideoFile(f) && f.size > MAX_VIDEO_BYTES) { toast.error(`${f.name} — ${t('ticket.video_too_large', { mb: MAX_VIDEO_MB })}`); return }
                  uploadMut.mutate(f)
                })} />
            </label>
          )}
        </div>
      </div>

      {annotating && (
        <PhotoAnnotator
          photo={annotating}
          onSave={(dataUrl) => saveAnnotationMut.mutate({ photoId: annotating.id, path: annotating.path, dataUrl })}
          onClose={() => setAnnotating(null)}
        />
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function TicketDetail() {
  const { id }      = useParams()
  const { t }       = useTranslation()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = usePermissions()

  const [searchParams] = useState(() => new URLSearchParams(window.location.search))
  const fromMeeting    = searchParams.get('from') === 'meeting'
  const meetingId      = searchParams.get('meetingId')

  const [rootCause,   setRootCause]   = useState('')
  const [corrective,  setCorrective]  = useState('')
  const [sdNotes,     setSdNotes]     = useState('')
  const [scNumber,    setScNumber]    = useState('')
  const [categories,  setCategories]  = useState('')
  const [department,  setDepartment]  = useState('')
  const [costApprox,  setCostApprox]  = useState('')
  const [costFinal,   setCostFinal]   = useState('')
  const [initialized, setInitialized] = useState(false)
  const [lightbox,    setLightbox]    = useState(null)
  const [addingLine,  setAddingLine]  = useState(false)
  const [newLine,     setNewLine]     = useState({ quality_issue:'', description:'', line_item:'', foliot_id:'', plant:'', affected_qty:'', total_qty:'', completion_type:'' })

  // Edição dos campos de informação
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoDraft,   setInfoDraft]   = useState(null)

  const { dark: isDark } = useThemeStore()
  const SC = isDark ? STATUS_CLR_DARK : STATUS_CLR_LIGHT

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketApi.get(id).then(r => r.data),
  })

  useEffect(() => {
    if (ticket && !initialized) {
      setRootCause(ticket.root_cause || '')
      setCorrective(ticket.corrective_action || '')
      setSdNotes(ticket.service_desk_notes || '')
      setScNumber(ticket.sc_number || '')
      setCategories(ticket.categories || '')
      setDepartment(ticket.department || '')
      setCostApprox(ticket.cost_approx != null ? String(ticket.cost_approx) : '')
      setCostFinal(ticket.cost_final != null ? String(ticket.cost_final) : '')
      setInitialized(true)
    }
  }, [ticket, initialized])

  const { data: lines, refetch: refetchLines } = useQuery({
    queryKey: ['occurrence-lines', id],
    queryFn: async () => {
      const { data } = await supabase.from('occurrence_lines').select('*').eq('occurrence_id', id).order('sort_order')
      return data || []
    },
    enabled: !!id,
  })

  const { data: globalPhotos, refetch: refetchGlobalPhotos } = useQuery({
    queryKey: ['ticket-photos-global', id],
    queryFn: async () => {
      const { data } = await supabase.from('ticket_photos').select('*').eq('ticket_id', id).is('line_id', null).order('created_at')
      return data || []
    },
    enabled: !!id,
  })

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').eq('active', true).order('name')
      return data || []
    },
  })

  const { data: creator } = useQuery({
    queryKey: ['ticket-creator', ticket?.created_by],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('full_name').eq('id', ticket.created_by).single()
      return data
    },
    enabled: !!ticket?.created_by,
  })

  const updateMut = useMutation({
    mutationFn: (payload) => ticketApi.update(id, payload),
    onSuccess: () => { queryClient.invalidateQueries(['ticket', id]); toast.success(t('common.save')) },
    onError: () => toast.error(t('common.error')),
  })

  const addLineMut = useMutation({
    mutationFn: async () => {
      const maxOrder = (lines || []).reduce((m, l) => Math.max(m, l.sort_order), -1)
      const { error } = await supabase.from('occurrence_lines').insert({
        occurrence_id: id,
        quality_issue: newLine.quality_issue || null,
        description:   newLine.description   || null,
        line_item:     newLine.line_item     || null,
        foliot_id:     newLine.foliot_id     || null,
        plant:         newLine.plant         || null,
        affected_qty:  newLine.affected_qty  ? Number(newLine.affected_qty) : null,
        total_qty:     newLine.total_qty     ? Number(newLine.total_qty)    : null,
        completion_type: newLine.completion_type || null,
        sort_order:    maxOrder + 1,
      })
      if (error) throw error
    },
    onSuccess: () => {
      refetchLines()
      setAddingLine(false)
      setNewLine({ quality_issue:'', description:'', line_item:'', foliot_id:'', plant:'', affected_qty:'', total_qty:'', completion_type:'' })
      toast.success(t('ticket.add_line'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const deleteLineMut = useMutation({
    mutationFn: async (lineId) => {
      const { error } = await supabase.from('occurrence_lines').delete().eq('id', lineId)
      if (error) throw error
    },
    onSuccess: () => refetchLines(),
    onError: () => toast.error(t('common.error')),
  })

  const handleSave = () => updateMut.mutate({
    root_cause:         rootCause  || null,
    corrective_action:  corrective || null,
    service_desk_notes: sdNotes    || null,
    sc_number:          scNumber   || null,
    categories:         categories || null,
    department:         department || null,
    cost_approx:        costApprox !== '' ? Number(costApprox) : null,
    cost_final:         costFinal  !== '' ? Number(costFinal)  : null,
  })

  // Salvar edição dos campos de informação
  const handleSaveInfo = () => {
    updateMut.mutate({
      ...infoDraft,
      delivery_date:    infoDraft.delivery_date || null,
      installer_needed: infoDraft.installer_needed === '' ? null : infoDraft.installer_needed === 'yes',
      urgency:          infoDraft.urgency || null,
      comment:          infoDraft.comment || null,
    }, {
      onSuccess: () => setEditingInfo(false)
    })
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  if (!ticket) return null

  const sc = SC[ticket.status] || SC.not_started

  const prev = prevStatus(ticket.status)
  const next = nextStatus(ticket.status)

  return (
    <>
      <PageHeader
        title={ticket.quality_issue || `SC# ${ticket.sc_number}`}
        subtitle={`${ticket.occurrence_no ? `#${ticket.occurrence_no} · ` : ''}SC# ${ticket.sc_number || '—'} · ${formatDate(ticket.issue_reception_date)}`}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => fromMeeting ? navigate(`/meetings?meetingId=${meetingId}`) : navigate(-1)}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('ticket.back')}
            </button>
            {canEdit && (
              <button className="btn-primary" onClick={handleSave} disabled={updateMut.isPending}>
                <i className="ti ti-device-floppy" aria-hidden="true" /> {updateMut.isPending ? t('common.loading') : t('ticket.save')}
              </button>
            )}
          </div>
        }
      />

      {/* Banner read-only para Utilisateur */}
      {!canEdit && (
        <div className="mx-5 mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs">
          <i className="ti ti-lock text-sm" aria-hidden="true" />
          {t('ticket.readonly_notice') || 'Vous pouvez consulter cette occurrence, mais pas la modifier.'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 bg-gray-50 dark:bg-[#0D1117]">
        <div className="grid gap-4 max-w-6xl" style={{ gridTemplateColumns:'1fr 1fr' }}>

          {/* ── COL 1 ── */}
          <div className="flex flex-col gap-4">

            {/* Status + workflow */}
            <div className="card">
              <SectionHeader icon="ti-circle-check" title={t('ticket.status')}
                right={<span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background:sc.bg, color:sc.color }}>{STATUS_LBL[ticket.status]}</span>}
              />
              <div className="px-4 py-3 flex gap-2 flex-wrap">
                {STATUS_OPTS.map(s => (
                  <button key={s}
                    onClick={() => canEdit && updateMut.mutate({ status: s })}
                    disabled={!canEdit}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all min-w-0"
                    style={{
                      cursor:     canEdit ? 'pointer' : 'default',
                      border:     ticket.status === s ? '1px solid #2563eb' : '1px solid ' + (isDark ? '#374151' : '#e5e7eb'),
                      background: ticket.status === s ? '#2563eb' : (isDark ? '#161B22' : '#fff'),
                      color:      ticket.status === s ? '#fff' : (isDark ? '#9ca3af' : '#6b7280'),
                      fontSize:   10,
                      opacity:    !canEdit && ticket.status !== s ? 0.5 : 1,
                    }}>
                    {STATUS_LBL[s]}
                  </button>
                ))}
              </div>

              {/* Botões avançar / recuar — só para editors */}
              {canEdit && (
                <div className="px-4 pb-3 flex flex-col gap-2">
                  {/* Avançar */}
                  {ticket.status === 'not_started' && (
                    <button onClick={() => updateMut.mutate({ status: 'service_desk' })} className="btn-primary text-xs w-full justify-center">
                      <i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_sd')}
                    </button>
                  )}
                  {ticket.status === 'service_desk' && (
                    <button onClick={() => updateMut.mutate({ status: 'quality_meeting', sd_completed_at: new Date().toISOString() })} className="btn-primary text-xs w-full justify-center" style={{ background:'#1D9E75' }}>
                      <i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_qm')}
                    </button>
                  )}
                  {ticket.status === 'quality_meeting' && (
                    <button onClick={() => updateMut.mutate({ status: 'completed' })} className="btn-primary text-xs w-full justify-center" style={{ background:'#1D9E75' }}>
                      <i className="ti ti-circle-check text-xs" aria-hidden="true" /> {t('ticket.mark_completed')}
                    </button>
                  )}
                  {/* Recuar status */}
                  {prev && ticket.status !== 'cancelled' && (
                    <button
                      onClick={() => updateMut.mutate({ status: prev })}
                      disabled={updateMut.isPending}
                      className="btn-ghost text-xs w-full justify-center"
                      style={{ border: '1px solid ' + (isDark ? '#374151' : '#e5e7eb') }}
                    >
                      <i className="ti ti-chevron-left text-xs" aria-hidden="true" />
                      {t('ticket.revert_to') || 'Retour à'} «{STATUS_LBL[prev]}»
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Global info */}
            <div className="card">
              <SectionHeader icon="ti-info-circle" title={t('ticket.informations')}
                right={
                  canEdit && !editingInfo ? (
                    <button className="btn-ghost text-xs py-0.5 px-2" onClick={() => {
                      setInfoDraft({
                        project_name: ticket.project_name || '',
                        ship_to: ticket.ship_to || '',
                        sold_to: ticket.sold_to || '',
                        brand:   ticket.brand   || '',
                        ref_so:  ticket.ref_so  || '',
                        sc_number: ticket.sc_number || '',
                        issue_reception_date: ticket.issue_reception_date || '',
                        delivery_date: ticket.delivery_date || '',
                        installer_needed: ticket.installer_needed === true ? 'yes' : ticket.installer_needed === false ? 'no' : '',
                        urgency: ticket.urgency || '',
                        comment: ticket.comment || '',
                      })
                      setEditingInfo(true)
                    }}>
                      <i className="ti ti-edit text-xs" aria-hidden="true" /> {t('common.edit') || 'Modifier'}
                    </button>
                  ) : null
                }
              />
              <div className="px-4 py-2">
                {editingInfo && infoDraft ? (
                  <div className="space-y-2">
                    {[
                      ['project_name', t('ticket.project_name')],
                      ['ship_to',  t('ticket.ship_to')],
                      ['sold_to',  t('ticket.sold_to')],
                      ['brand',    t('ticket.brand')],
                      ['ref_so',   t('ticket.ref_so')],
                      ['sc_number',t('ticket.sc_number')],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className="label">{label}</label>
                        <input className="input text-xs" value={infoDraft[key] || ''} onChange={e => setInfoDraft(d => ({ ...d, [key]: e.target.value }))} />
                      </div>
                    ))}
                    <div>
                      <label className="label">{t('ticket.reception_date')}</label>
                      <input className="input text-xs" type="date" value={infoDraft.issue_reception_date?.slice(0,10) || ''} onChange={e => setInfoDraft(d => ({ ...d, issue_reception_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">{t('ticket.delivery_date')}</label>
                      <input className="input text-xs" type="date" value={infoDraft.delivery_date?.slice(0,10) || ''} onChange={e => setInfoDraft(d => ({ ...d, delivery_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">{t('ticket.installer_needed')}</label>
                      <select className="input text-xs" value={infoDraft.installer_needed} onChange={e => setInfoDraft(d => ({ ...d, installer_needed: e.target.value }))}>
                        <option value="">—</option>
                        <option value="yes">{t('common.yes')}</option>
                        <option value="no">{t('common.no')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{t('ticket.urgency')}</label>
                      <select className="input text-xs" value={infoDraft.urgency} onChange={e => setInfoDraft(d => ({ ...d, urgency: e.target.value }))}>
                        <option value="">—</option>
                        {URGENCIES.map(u => <option key={u} value={u}>{URGENCY_LBL[u]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">{t('ticket.comment')}</label>
                      <textarea className="input text-xs" rows={2} value={infoDraft.comment} onChange={e => setInfoDraft(d => ({ ...d, comment: e.target.value }))} />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={() => setEditingInfo(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
                      <button onClick={handleSaveInfo} disabled={updateMut.isPending} className="btn-primary text-xs">{t('common.save')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {[
                      [t('ticket.occurrence_no'),  ticket.occurrence_no ? `#${ticket.occurrence_no}` : null],
                      [t('ticket.project_name'),   ticket.project_name],
                      [t('ticket.created_by'),     creator?.full_name],
                      [t('ticket.ship_to'),        ticket.ship_to],
                      [t('ticket.sold_to'),         ticket.sold_to],
                      [t('ticket.brand'),           ticket.brand],
                      [t('ticket.ref_so'),          ticket.ref_so],
                      [t('ticket.sc_number'),       ticket.sc_number],
                      [t('ticket.reception_date'),  formatDate(ticket.issue_reception_date)],
                      [t('ticket.delivery_date'),   ticket.delivery_date ? formatDate(ticket.delivery_date) : null],
                      [t('ticket.installer_needed'), ticket.installer_needed === true ? t('common.yes') : ticket.installer_needed === false ? t('common.no') : null],
                      [t('ticket.urgency'),         URGENCY_LBL[ticket.urgency] || null],
                      [t('ticket.comment'),         ticket.comment],
                    ].filter(([,v]) => v).map(([label, value]) => (
                      <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-50 dark:border-gray-800 text-xs">
                        <span className="text-gray-400">{label}</span>
                        <span className="text-gray-900 dark:text-gray-100">{value}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* SD Notes */}
            {['service_desk','quality_meeting','completed'].includes(ticket.status) && (
              <div className="card">
                <SectionHeader icon="ti-notes" title={t('ticket.step2')} />
                <div className="px-4 py-3 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">{t('ticket.sc_number')}</label>
                      <input value={scNumber} onChange={e => setScNumber(e.target.value)}
                        disabled={!canEdit} placeholder="SC#..."
                        className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
                    </div>
                    <div>
                      <label className="label">{t('ticket.cost')}</label>
                      <input type="number" min="0" value={costApprox} onChange={e => setCostApprox(e.target.value)}
                        disabled={!canEdit} placeholder="$0.00"
                        className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
                    </div>
                  </div>
                  <div>
                    <label className="label">{t('ticket.sd_notes')}</label>
                    <textarea rows={3} value={sdNotes} onChange={e => setSdNotes(e.target.value)}
                      disabled={!canEdit}
                      placeholder={t('ticket.sd_notes_placeholder')}
                      className="input resize-y text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>
            )}

            {/* Quality Meeting — classification + résolution */}
            {['quality_meeting','completed'].includes(ticket.status) && (
              <div className="card">
                <SectionHeader icon="ti-clipboard-check" title={t('ticket.step3')} />
                <div className="px-4 py-3 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">{t('ticket.categories')}</label>
                      <select value={categories} onChange={e => setCategories(e.target.value)} disabled={!canEdit}
                        className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                        <option value="">—</option>
                        {categories && !CATEGORIES.includes(categories) && <option value={categories}>{categories}</option>}
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">{t('ticket.department')}</label>
                      <select value={department} onChange={e => setDepartment(e.target.value)} disabled={!canEdit}
                        className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                        <option value="">—</option>
                        {department && !DEPARTMENTS.includes(department) && <option value={department}>{department}</option>}
                        {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">{t('ticket.root_cause')}</label>
                    <select value={rootCause} onChange={e => setRootCause(e.target.value)} disabled={!canEdit}
                      className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                      <option value="">—</option>
                      {rootCause && !ROOT_CAUSES.includes(rootCause) && <option value={rootCause}>{rootCause}</option>}
                      {ROOT_CAUSES.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('ticket.corrective_action')}</label>
                    <textarea rows={3} value={corrective} onChange={e => setCorrective(e.target.value)}
                      disabled={!canEdit}
                      placeholder={t('ticket.corrective_placeholder')} className="input resize-y text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="label">{t('ticket.cost_final')}</label>
                    <input type="number" min="0" value={costFinal} onChange={e => setCostFinal(e.target.value)}
                      disabled={!canEdit} placeholder="$0.00"
                      className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>
            )}

            {/* History */}
            <div className="card">
              <SectionHeader icon="ti-history" title={t('ticket.history')} />
              <div className="px-4 py-2">
                {[
                  { dot:'#2563eb', time: formatDate(ticket.updated_at || ticket.created_at), text: t('ticket.last_modified') },
                  { dot:'#9ca3af', time: formatDate(ticket.issue_reception_date), text: `${t('ticket.created')}${creator?.full_name ? ` · ${creator.full_name}` : ''} · SC# ${ticket.sc_number || '—'}` },
                ].map((h, i) => (
                  <div key={i} className="flex gap-3 py-2 border-b border-gray-50 dark:border-gray-800 text-xs">
                    <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: h.dot }} />
                    <div className="text-gray-400 min-w-20">{h.time}</div>
                    <div className="text-gray-600 dark:text-gray-300">{h.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── COL 2 ── */}
          <div className="flex flex-col gap-4">
            <div className="card">
              <SectionHeader icon="ti-list-details" title={`${t('ticket.lines')} (${(lines || []).length})`}
                right={
                  canEdit ? (
                    <button onClick={() => setAddingLine(!addingLine)} className="btn-ghost text-xs py-1 px-2">
                      <i className={`ti ${addingLine ? 'ti-x' : 'ti-plus'} text-xs`} aria-hidden="true" /> {t('ticket.add_line')}
                    </button>
                  ) : null
                }
              />
              <div className="px-4 py-3">
                {addingLine && canEdit && (
                  <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3 bg-blue-50/30 dark:bg-blue-900/10">
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">{t('ticket.line_n')} {(lines || []).length + 1} — Nouvelle</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="label">{t('ticket.issue')} *</label>
                        <input className="input text-xs" value={newLine.quality_issue} onChange={e => setNewLine(f => ({...f, quality_issue: e.target.value}))} placeholder="Description..." />
                      </div>
                      <div className="col-span-2">
                        <label className="label">{t('ticket.description')}</label>
                        <textarea className="input text-xs" rows={2} value={newLine.description} onChange={e => setNewLine(f => ({...f, description: e.target.value}))} />
                      </div>
                      <div>
                        <label className="label">{t('ticket.line_item')}</label>
                        <input className="input text-xs" value={newLine.line_item} onChange={e => setNewLine(f => ({...f, line_item: e.target.value}))} />
                      </div>
                      <div>
                        <label className="label">{t('ticket.foliot_id')}</label>
                        <input className="input text-xs" value={newLine.foliot_id} onChange={e => setNewLine(f => ({...f, foliot_id: e.target.value}))} />
                      </div>
                      <div>
                        <label className="label">{t('ticket.plant')}</label>
                        <select className="input text-xs" value={newLine.plant} onChange={e => setNewLine(f => ({...f, plant: e.target.value}))}>
                          <option value="">—</option>{(plants || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">{t('ticket.affected_qty')}</label>
                        <input className="input text-xs" type="number" value={newLine.affected_qty} onChange={e => setNewLine(f => ({...f, affected_qty: e.target.value}))} />
                      </div>
                      <div>
                        <label className="label">{t('ticket.total_qty')}</label>
                        <input className="input text-xs" type="number" value={newLine.total_qty} onChange={e => setNewLine(f => ({...f, total_qty: e.target.value}))} />
                      </div>
                      <div className="col-span-2">
                        <label className="label">{t('ticket.completion_type')}</label>
                        <select className="input text-xs" value={newLine.completion_type} onChange={e => setNewLine(f => ({...f, completion_type: e.target.value}))}>
                          <option value="">—</option>
                          <option value="complete">{t('ticket.complete_product')}</option>
                          <option value="parts">{t('ticket.parts_only')}</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setAddingLine(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
                      <button onClick={() => addLineMut.mutate()} disabled={!newLine.quality_issue} className="btn-primary text-xs disabled:opacity-40">
                        {addLineMut.isPending ? <Spinner size="sm" /> : t('common.add')}
                      </button>
                    </div>
                  </div>
                )}
                {(lines || []).map(line => (
                  <LineCard key={line.id} line={line} occurrenceId={id}
                    onUpdate={refetchLines} onDelete={(lineId) => deleteLineMut.mutate(lineId)}
                    plants={plants} status={ticket.status} t={t} canEdit={canEdit} onView={setLightbox} />
                ))}
                {(lines || []).length === 0 && !addingLine && (
                  <div className="text-center py-6 text-xs text-gray-400">{t('common.no_results')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
