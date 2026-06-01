import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ticketApi } from '../../services/api'
import { supabase } from '../../services/supabase'
import { PageHeader, Spinner, StatusBadge } from '../../components/ui'
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

  useEffect(() => {
    if (!window.fabric) return
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

    // Download via fetch with blob to avoid CORS
    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader()
        reader.onload = e => addImageToCanvas(e.target.result)
        reader.readAsDataURL(blob)
      })
      .catch(() => {
        // Final fallback - load directly
        addImageToCanvas(src)
      })

    return () => canvas.dispose()
  }, [])

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
  }, [tool, color, thick])

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
          <button onClick={handleUndo} title="Undo" aria-label="Undo" className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 dark:border-gray-700 cursor-pointer bg-transparent">
            <i className="ti ti-arrow-back-up" style={{ fontSize:13,color:'var(--color-text-secondary)' }} aria-hidden="true" />
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
function LineCard({ line, occurrenceId, onUpdate, onDelete, plants, status, t }) {
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
    mutationFn: async (file) => {
      const ext = file.name.split('.').pop()
      const path = `tickets/${occurrenceId}/${Date.now()}_line${line.id}.${ext}`
      const { error } = await supabase.storage.from('ticket-photos').upload(path, file)
      if (error) throw error
      const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
      await supabase.from('ticket_photos').insert({ ticket_id: occurrenceId, url: urlData.publicUrl, name: file.name, path, line_id: line.id })
    },
    onSuccess: () => refetchPhotos(),
    onError: () => toast.error(t('common.error')),
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
      // Convert dataUrl to blob without fetch
      const arr  = dataUrl.split(',')
      const mime = arr[0].match(/:(.*?);/)[1]
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) u8arr[n] = bstr.charCodeAt(n)
      const blob = new Blob([u8arr], { type: mime })

      const newPath = path.replace(/\.[^.]+$/, '_annotated.jpg')
      await supabase.storage.from('ticket-photos').upload(newPath, blob, { upsert: true })
      const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(newPath)
      await supabase.from('ticket_photos').update({ url: urlData.publicUrl, path: newPath }).eq('id', photoId)
    },
    onSuccess: () => { refetchPhotos(); setAnnotating(null) },
    onError: () => toast.error(t('common.error')),
  })

  const saveLine = async () => {
    const { error } = await supabase.from('occurrence_lines').update({
      quality_issue: form.quality_issue,
      categories:    form.categories,
      department:    form.department,
      line_item:     form.line_item,
      foliot_id:     form.foliot_id,
      plant:         form.plant,
      affected_qty:  form.affected_qty ? Number(form.affected_qty) : null,
      cost_approx:   form.cost_approx  ? Number(form.cost_approx)  : null,
      cost_final:    form.cost_final   ? Number(form.cost_final)   : null,
      updated_at:    new Date().toISOString(),
    }).eq('id', line.id)
    if (error) { toast.error(t('common.error')); return }
    toast.success(t('common.save'))
    onUpdate()
    setEditing(false)
  }

  const isDark = document.documentElement.classList.contains('dark')
  const imgPhotos  = (photos || []).filter(p =>  p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))
  const filePhotos = (photos || []).filter(p => !p.url?.match(/\.(jpg|jpeg|png|gif|webp)/i))
  const canEdit = ['service_desk','quality_meeting','not_started'].includes(status)

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-[#161B22] border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{t('ticket.line_n')} {line.sort_order + 1}</span>
          {line.categories && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">{line.categories}</span>}
          {line.department && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{line.department}</span>}
        </div>
        {canEdit && (
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
              <div>
                <label className="label">{t('ticket.categories')}</label>
                <select className="input text-xs" value={form.categories || ''} onChange={e => setForm(f => ({...f, categories: e.target.value}))}>
                  <option value="">—</option>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('ticket.department')}</label>
                <select className="input text-xs" value={form.department || ''} onChange={e => setForm(f => ({...f, department: e.target.value}))}>
                  <option value="">—</option>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
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
                <label className="label">{t('ticket.cost')}</label>
                <input className="input text-xs" value={form.cost_approx || ''} onChange={e => setForm(f => ({...f, cost_approx: e.target.value}))} placeholder="$0.00" />
              </div>
              <div>
                <label className="label">{t('ticket.cost_final')}</label>
                <input className="input text-xs" value={form.cost_final || ''} onChange={e => setForm(f => ({...f, cost_final: e.target.value}))} placeholder="$0.00" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(false)} className="btn-ghost text-xs">{t('common.cancel')}</button>
              <button onClick={saveLine} className="btn-primary text-xs">{t('common.save')}</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
            {line.quality_issue && (
              <div className="col-span-2 text-gray-900 dark:text-gray-100 font-medium mb-1">{line.quality_issue}</div>
            )}
            {[
              [t('ticket.line_item'), line.line_item],
              [t('ticket.foliot_id'), line.foliot_id],
              [t('ticket.plant'), line.plant],
              [t('ticket.affected_qty'), line.affected_qty],
              [t('ticket.cost'), line.cost_approx ? `$${Number(line.cost_approx).toLocaleString()}` : null],
              [t('ticket.cost_final'), line.cost_final ? `$${Number(line.cost_final).toLocaleString()}` : null],
            ].filter(([,v]) => v).map(([label, val]) => (
              <div key={label} className="flex justify-between border-b border-gray-50 dark:border-gray-800 py-0.5">
                <span className="text-gray-400">{label}</span>
                <span className={`text-gray-900 dark:text-gray-100 ${label === t('ticket.cost_final') ? 'text-red-500 font-medium' : ''}`}>{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* Photos */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
          {canEdit && (photos || []).length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-2">
              {TOOLS.map(tk => (
                <button key={tk.id} title={tk.label} aria-label={tk.label}
                  className="w-6 h-6 rounded flex items-center justify-center border cursor-pointer"
                  style={{ border:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-primary)', color:'var(--color-text-secondary)' }}>
                  <i className={`ti ${tk.icon}`} style={{ fontSize:11 }} aria-hidden="true" />
                </button>
              ))}
              <div style={{ width:1,height:16,background:'var(--color-border-tertiary)',margin:'0 2px' }} />
              {COLORS.map(c => (
                <div key={c} style={{ width:11,height:11,borderRadius:'50%',background:c,cursor:'pointer',border:'0.5px solid var(--color-border-tertiary)' }} />
              ))}
            </div>
          )}

          {imgPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {imgPhotos.map(p => (
                <div key={p.id} className="relative group cursor-pointer" onClick={() => setAnnotating(p)}>
                  <img src={p.url} alt="" className="w-14 h-14 object-cover rounded border border-gray-200 dark:border-gray-700" />
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); deletePhotoMut.mutate({ photoId: p.id, path: p.path }) }}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs items-center justify-center hidden group-hover:flex border-0 cursor-pointer">
                      <i className="ti ti-x" style={{ fontSize:8 }} aria-hidden="true" />
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
              {canEdit && (
                <button onClick={() => deletePhotoMut.mutate({ photoId: p.id, path: p.path })} className="text-red-400 bg-transparent border-0 cursor-pointer p-0">
                  <i className="ti ti-trash text-xs" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}

          {canEdit && (
            <label className="btn-ghost text-xs py-1 px-2 cursor-pointer">
              <i className="ti ti-upload text-xs" aria-hidden="true" /> {(photos || []).length === 0 ? 'Ajouter photos' : 'Ajouter'}
              <input ref={fileRef} type="file" accept="image/*,.pdf" multiple className="hidden"
                onChange={e => Array.from(e.target.files).forEach(f => uploadMut.mutate(f))} />
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

  const [searchParams] = useState(() => new URLSearchParams(window.location.search))
  const fromMeeting    = searchParams.get('from') === 'meeting'
  const meetingId      = searchParams.get('meetingId')

  const [rootCause,   setRootCause]   = useState('')
  const [corrective,  setCorrective]  = useState('')
  const [sdNotes,     setSdNotes]     = useState('')
  const [initialized, setInitialized] = useState(false)
  const [lightbox,    setLightbox]    = useState(null)
  const [addingLine,  setAddingLine]  = useState(false)
  const [newLine,     setNewLine]     = useState({ quality_issue:'', categories:'', department:'', line_item:'', foliot_id:'', plant:'', affected_qty:'', cost_approx:'' })

  const isDark = document.documentElement.classList.contains('dark')
  const SC = isDark ? STATUS_CLR_DARK : STATUS_CLR_LIGHT

  useEffect(() => {
    if (window.fabric) return
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.6.0/fabric.min.js'
    document.head.appendChild(script)
  }, [])

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketApi.get(id).then(r => r.data),
    onSuccess: (data) => {
      if (!initialized) {
        setRootCause(data.root_cause || '')
        setCorrective(data.corrective_action || '')
        setSdNotes(data.service_desk_notes || '')
        setInitialized(true)
      }
    }
  })

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
        categories:    newLine.categories    || null,
        department:    newLine.department    || null,
        line_item:     newLine.line_item     || null,
        foliot_id:     newLine.foliot_id     || null,
        plant:         newLine.plant         || null,
        affected_qty:  newLine.affected_qty  ? Number(newLine.affected_qty) : null,
        cost_approx:   newLine.cost_approx   ? Number(newLine.cost_approx)  : null,
        sort_order:    maxOrder + 1,
      })
      if (error) throw error
    },
    onSuccess: () => {
      refetchLines()
      setAddingLine(false)
      setNewLine({ quality_issue:'', categories:'', department:'', line_item:'', foliot_id:'', plant:'', affected_qty:'', cost_approx:'' })
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
    root_cause: rootCause, corrective_action: corrective, service_desk_notes: sdNotes,
  })

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
  if (!ticket) return null

  const sc = SC[ticket.status] || SC.not_started
  const totalCost = (lines || []).reduce((s, l) => s + Number(l.cost_approx || 0), 0)
  const finalCost = (lines || []).reduce((s, l) => s + Number(l.cost_final  || 0), 0)

  return (
    <>
      <PageHeader
        title={ticket.quality_issue || `SC# ${ticket.sc_number}`}
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
                  <button key={s} onClick={() => updateMut.mutate({ status: s })}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer min-w-0"
                    style={{
                      border:     ticket.status === s ? '1px solid #2563eb' : '1px solid ' + (isDark ? '#374151' : '#e5e7eb'),
                      background: ticket.status === s ? '#2563eb' : (isDark ? '#161B22' : '#fff'),
                      color:      ticket.status === s ? '#fff' : (isDark ? '#9ca3af' : '#6b7280'),
                      fontSize:   10,
                    }}>
                    {STATUS_LBL[s]}
                  </button>
                ))}
              </div>

              {/* Quick submit buttons */}
              <div className="px-4 pb-3 flex gap-2">
                {ticket.status === 'not_started' && (
                  <button onClick={() => updateMut.mutate({ status: 'service_desk' })}
                    className="btn-primary text-xs w-full justify-center">
                    <i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_sd')}
                  </button>
                )}
                {ticket.status === 'service_desk' && (
                  <button onClick={() => updateMut.mutate({ status: 'quality_meeting', sd_completed_at: new Date().toISOString() })}
                    className="btn-primary text-xs w-full justify-center" style={{ background:'#1D9E75' }}>
                    <i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_qm')}
                  </button>
                )}
                {ticket.status === 'quality_meeting' && (
                  <button onClick={() => updateMut.mutate({ status: 'completed' })}
                    className="btn-primary text-xs w-full justify-center" style={{ background:'#1D9E75' }}>
                    <i className="ti ti-circle-check text-xs" aria-hidden="true" /> {t('ticket.mark_completed')}
                  </button>
                )}
              </div>
            </div>

            {/* Global info */}
            <div className="card">
              <SectionHeader icon="ti-info-circle" title={t('ticket.informations')} />
              <div className="px-4 py-2">
                {[
                  [t('ticket.ship_to'),        ticket.ship_to],
                  [t('ticket.sold_to'),         ticket.sold_to],
                  [t('ticket.brand'),           ticket.brand],
                  [t('ticket.ref_so'),          ticket.ref_so],
                  [t('ticket.sc_number'),       ticket.sc_number],
                  [t('ticket.reception_date'),  formatDate(ticket.issue_reception_date)],
                  ['SC Cost total',             totalCost > 0 ? `$${Math.round(totalCost).toLocaleString()}` : null],
                  ['Coût final total',          finalCost > 0 ? `$${Math.round(finalCost).toLocaleString()}` : null],
                ].filter(([,v]) => v).map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-50 dark:border-gray-800 text-xs">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-gray-900 dark:text-gray-100">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* SD Notes */}
            {['service_desk','quality_meeting','completed'].includes(ticket.status) && (
              <div className="card">
                <SectionHeader icon="ti-notes" title={t('ticket.sd_notes')} />
                <div className="px-4 py-3">
                  <textarea rows={3} value={sdNotes} onChange={e => setSdNotes(e.target.value)}
                    placeholder={t('ticket.sd_notes_placeholder')}
                    className="input resize-y text-xs" />
                </div>
              </div>
            )}

            {/* Resolution */}
            {['quality_meeting','completed'].includes(ticket.status) && (
              <div className="card">
                <SectionHeader icon="ti-tool" title={t('ticket.resolution')} />
                <div className="px-4 py-3 flex flex-col gap-3">
                  <div>
                    <label className="label">{t('ticket.root_cause')}</label>
                    <textarea rows={3} value={rootCause} onChange={e => setRootCause(e.target.value)}
                      placeholder={t('ticket.root_cause_placeholder')} className="input resize-y text-xs" />
                  </div>
                  <div>
                    <label className="label">{t('ticket.corrective_action')}</label>
                    <textarea rows={3} value={corrective} onChange={e => setCorrective(e.target.value)}
                      placeholder={t('ticket.corrective_placeholder')} className="input resize-y text-xs" />
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
                  { dot:'#9ca3af', time: formatDate(ticket.issue_reception_date), text: `${t('ticket.created')} · SC# ${ticket.sc_number || '—'}` },
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

            {/* Lines */}
            <div className="card">
              <SectionHeader icon="ti-list-details" title={`${t('ticket.lines')} (${(lines || []).length})`}
                right={
                  <button onClick={() => setAddingLine(!addingLine)} className="btn-ghost text-xs py-1 px-2">
                    <i className={`ti ${addingLine ? 'ti-x' : 'ti-plus'} text-xs`} aria-hidden="true" /> {t('ticket.add_line')}
                  </button>
                }
              />
              <div className="px-4 py-3">
                {addingLine && (
                  <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3 bg-blue-50/30 dark:bg-blue-900/10">
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">{t('ticket.line_n')} {(lines || []).length + 1} — Nouvelle</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="label">{t('ticket.issue')} *</label>
                        <input className="input text-xs" value={newLine.quality_issue} onChange={e => setNewLine(f => ({...f, quality_issue: e.target.value}))} placeholder="Description..." />
                      </div>
                      <div>
                        <label className="label">{t('ticket.categories')}</label>
                        <select className="input text-xs" value={newLine.categories} onChange={e => setNewLine(f => ({...f, categories: e.target.value}))}>
                          <option value="">—</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">{t('ticket.department')}</label>
                        <select className="input text-xs" value={newLine.department} onChange={e => setNewLine(f => ({...f, department: e.target.value}))}>
                          <option value="">—</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                        </select>
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
                        <label className="label">{t('ticket.cost')}</label>
                        <input className="input text-xs" value={newLine.cost_approx} onChange={e => setNewLine(f => ({...f, cost_approx: e.target.value}))} placeholder="$0.00" />
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
                    plants={plants} status={ticket.status} t={t} />
                ))}
                {(lines || []).length === 0 && !addingLine && (
                  <div className="text-center py-6 text-xs text-gray-400">{t('common.no_results')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 flex items-center justify-center z-[2000] cursor-zoom-out p-5" style={{ background:'rgba(0,0,0,0.92)' }}>
          <img src={lightbox} className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-white text-lg border-none cursor-pointer" style={{ background:'rgba(255,255,255,0.15)' }}>✕</button>
        </div>
      )}
    </>
  )
}
