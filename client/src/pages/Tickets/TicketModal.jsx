import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const DEPARTMENTS = ['Client','Shipping','Supplier','Production','Logistics','Install','Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC','Project Mgnt','EOI','Vietnam','Planning']
const CATEGORIES  = ['Damage','Missing parts','Wrong item','Assembly issue','Finish defect','Packaging','Measurement','Other']
const BRANDS      = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']
const COLORS      = ['#E24B4A','#185FA5','#1D9E75','#BA7517','#888780','#ffffff']
const TOOLS       = [
  { id:'select',  icon:'ti-cursor-text',    label:'Sélection' },
  { id:'pen',     icon:'ti-pencil',         label:'Stylo' },
  { id:'arrow',   icon:'ti-arrow-up-right', label:'Flèche' },
  { id:'rect',    icon:'ti-square',         label:'Rectangle' },
  { id:'circle',  icon:'ti-circle',         label:'Cercle' },
  { id:'text',    icon:'ti-letter-t',       label:'Texte' },
  { id:'measure', icon:'ti-ruler',          label:'Mesure' },
]

// ── Photo Annotator ────────────────────────────────────────────────────────
function PhotoAnnotator({ photoUrl, onSave, onClose }) {
  const canvasRef   = useRef(null)
  const fabricRef   = useRef(null)
  const ptsRef      = useRef([])
  const tempLineRef = useRef(null)
  const [tool,       setTool]       = useState('select')
  const [color,      setColor]      = useState('#E24B4A')
  const [thick,      setThick]      = useState(3)
  const [measuring,  setMeasuring]  = useState(false)
  const [measureVal, setMeasureVal] = useState('')
  const [measureGrp, setMeasureGrp] = useState(null)
  const [ready,      setReady]      = useState(false)

  // Load fabric + init canvas
  useEffect(() => {
    const init = () => {
      if (!canvasRef.current || !window.fabric) return
      const canvas = new window.fabric.Canvas(canvasRef.current, { width: 560, height: 380 })
      fabricRef.current = canvas

      const imgEl = new Image()
      imgEl.crossOrigin = 'anonymous'
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
        setReady(true)
      }
      imgEl.onerror = () => {
        // If crossOrigin fails, try without it
        const imgEl2 = new Image()
        imgEl2.onload = () => {
          const fabricImg = new window.fabric.Image(imgEl2)
          const scale = Math.min(560 / imgEl2.width, 380 / imgEl2.height, 1)
          fabricImg.scale(scale)
          canvas.setWidth(Math.round(imgEl2.width * scale))
          canvas.setHeight(Math.round(imgEl2.height * scale))
          canvas.add(fabricImg)
          fabricImg.selectable = false
          fabricImg.evented = false
          canvas.sendToBack(fabricImg)
          canvas.renderAll()
          setReady(true)
        }
        imgEl2.src = photoUrl
      }
      imgEl.src = photoUrl
    }
    if (window.fabric) {
      init()
    } else {
      // Try cdnjs first, fallback to jsdelivr
      const urls = [
        'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js',
        'https://cdn.jsdelivr.net/npm/fabric@5.3.1/dist/fabric.min.js',
      ]
      let tried = 0
      const tryLoad = () => {
        if (tried >= urls.length) { setReady(false); return }
        const s = document.createElement('script')
        s.src = urls[tried++]
        s.onload = init
        s.onerror = tryLoad
        document.head.appendChild(s)
      }
      tryLoad()
    }
    return () => { if (fabricRef.current) fabricRef.current.dispose() }
  }, [photoUrl])

  // Tool handlers
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !ready) return
    canvas.isDrawingMode = false
    canvas.off('mouse:down'); canvas.off('mouse:move'); canvas.off('mouse:up')
    ptsRef.current = []
    if (tempLineRef.current) { canvas.remove(tempLineRef.current); tempLineRef.current = null }

    if (tool === 'pen') {
      canvas.isDrawingMode = true
      canvas.freeDrawingBrush.color = color
      canvas.freeDrawingBrush.width = thick
      return
    }
    canvas.selection = tool === 'select'

    if (tool === 'measure') {
      canvas.on('mouse:down', o => {
        const p = canvas.getPointer(o.e)
        if (ptsRef.current.length === 0) {
          ptsRef.current = [p]
        } else {
          const p0 = ptsRef.current[0]
          if (tempLineRef.current) canvas.remove(tempLineRef.current)
          const line = new window.fabric.Line([p0.x,p0.y,p.x,p.y], { stroke:color, strokeWidth:2, selectable:false, evented:false })
          const d1   = new window.fabric.Circle({ left:p0.x-4, top:p0.y-4, radius:4, fill:color, selectable:false, evented:false })
          const d2   = new window.fabric.Circle({ left:p.x-4,  top:p.y-4,  radius:4, fill:color, selectable:false, evented:false })
          const grp  = new window.fabric.Group([line,d1,d2], { selectable:true })
          canvas.add(grp)
          canvas.renderAll()
          setMeasureGrp(grp)
          setMeasuring(true)
          ptsRef.current = []
          tempLineRef.current = null
        }
      })
      canvas.on('mouse:move', o => {
        if (ptsRef.current.length !== 1) return
        if (tempLineRef.current) canvas.remove(tempLineRef.current)
        const p0 = ptsRef.current[0]
        const p  = canvas.getPointer(o.e)
        tempLineRef.current = new window.fabric.Line([p0.x,p0.y,p.x,p.y], { stroke:color, strokeWidth:2, selectable:false, evented:false, strokeDashArray:[4,4] })
        canvas.add(tempLineRef.current)
        canvas.renderAll()
      })
      return
    }

    if (['arrow','rect','circle','text'].includes(tool)) {
      let origin = null; let shape = null
      canvas.on('mouse:down', o => {
        origin = canvas.getPointer(o.e)
        if (tool === 'text') {
          const txt = new window.fabric.IText('Text', { left:origin.x, top:origin.y, fontSize:16, fill:color, fontFamily:'sans-serif', editable:true })
          canvas.add(txt); canvas.setActiveObject(txt); txt.enterEditing(); canvas.renderAll(); origin = null
        }
      })
      canvas.on('mouse:move', o => {
        if (!origin) return
        const p = canvas.getPointer(o.e)
        if (shape) canvas.remove(shape)
        if (tool === 'rect') {
          shape = new window.fabric.Rect({ left:Math.min(origin.x,p.x), top:Math.min(origin.y,p.y), width:Math.abs(p.x-origin.x), height:Math.abs(p.y-origin.y), stroke:color, strokeWidth:thick, fill:'transparent' })
        } else if (tool === 'circle') {
          const r = Math.sqrt(Math.pow(p.x-origin.x,2)+Math.pow(p.y-origin.y,2))/2
          shape = new window.fabric.Circle({ left:Math.min(origin.x,p.x), top:Math.min(origin.y,p.y), radius:r, stroke:color, strokeWidth:thick, fill:'transparent' })
        } else if (tool === 'arrow') {
          const angle = Math.atan2(p.y-origin.y, p.x-origin.x)*180/Math.PI
          const len   = Math.sqrt(Math.pow(p.x-origin.x,2)+Math.pow(p.y-origin.y,2))
          shape = new window.fabric.Group([
            new window.fabric.Line([0,0,len,0], { stroke:color, strokeWidth:thick }),
            new window.fabric.Triangle({ width:12, height:14, fill:color, left:len-6, top:-7 })
          ], { left:origin.x, top:origin.y, angle, originX:'left', originY:'center' })
        }
        if (shape) { canvas.add(shape); canvas.renderAll() }
      })
      canvas.on('mouse:up', () => { shape=null; origin=null })
    }
  }, [tool, color, thick, ready])

  const handleSaveMeasure = () => {
    if (!measureVal || !measureGrp || !fabricRef.current) return
    const b  = measureGrp.getBoundingRect()
    const bg = new window.fabric.Rect({ left:b.left+b.width/2-30, top:b.top-22, width:60, height:20, fill:color, rx:4, ry:4, selectable:false, evented:false })
    const tx = new window.fabric.Text(`${measureVal} cm`, { left:b.left+b.width/2, top:b.top-20, fontSize:11, fill:'white', fontFamily:'sans-serif', originX:'center', selectable:false, evented:false })
    fabricRef.current.add(bg, tx)
    fabricRef.current.renderAll()
    setMeasuring(false); setMeasureVal(''); setMeasureGrp(null); setTool('select')
  }

  const handleUndo = () => {
    const c = fabricRef.current; if (!c) return
    const objs = c.getObjects()
    if (objs.length > 1) { c.remove(objs[objs.length-1]); c.renderAll() }
  }

  const handleSave = () => {
    const c = fabricRef.current; if (!c) return
    const dataUrl = c.toDataURL({ format:'jpeg', quality:0.9 })
    onSave(dataUrl)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ maxWidth:620, width:'100%' }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Annotation</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer text-xl leading-none">✕</button>
        </div>
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1 flex-wrap bg-gray-50 dark:bg-[#0D1117]">
          {TOOLS.map(tk => (
            <button key={tk.id} onClick={() => setTool(tk.id)} title={tk.label} aria-label={tk.label}
              className="w-7 h-7 rounded flex items-center justify-center cursor-pointer transition-all border-0"
              style={{ background: tool===tk.id ? color+'33' : 'transparent', outline: tool===tk.id ? `2px solid ${color}` : '1px solid var(--color-border-tertiary)', color: tool===tk.id ? color : 'var(--color-text-secondary)' }}>
              <i className={`ti ${tk.icon}`} style={{ fontSize:13 }} aria-hidden="true" />
            </button>
          ))}
          <div style={{ width:1, height:20, background:'var(--color-border-tertiary)', margin:'0 3px' }} />
          {COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)} style={{ width:14, height:14, borderRadius:'50%', background:c, cursor:'pointer', flexShrink:0, outline: color===c ? '2px solid #185FA5' : '1px solid rgba(0,0,0,0.2)', outlineOffset:1 }} />
          ))}
          <div style={{ width:1, height:20, background:'var(--color-border-tertiary)', margin:'0 3px' }} />
          <input type="range" min="1" max="8" value={thick} step="1" onChange={e => setThick(Number(e.target.value))} style={{ width:55 }} />
          <div style={{ width:1, height:20, background:'var(--color-border-tertiary)', margin:'0 3px' }} />
          <button onClick={handleUndo} title="Undo" aria-label="Undo" className="w-7 h-7 rounded flex items-center justify-center cursor-pointer bg-transparent border-0" style={{ outline:'1px solid var(--color-border-tertiary)', color:'var(--color-text-secondary)' }}>
            <i className="ti ti-arrow-back-up" style={{ fontSize:13 }} aria-hidden="true" />
          </button>
        </div>
        {measuring && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3">
            <i className="ti ti-ruler text-amber-600 text-sm" aria-hidden="true" />
            <span className="text-xs text-amber-700 dark:text-amber-300">Mesure tracée — entrez la valeur:</span>
            <input type="text" value={measureVal} onChange={e => setMeasureVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveMeasure()}
              className="border border-amber-300 rounded px-2 py-1 text-xs w-20 outline-none dark:bg-[#161B22] dark:text-gray-100"
              placeholder="ex: 35" autoFocus />
            <span className="text-xs text-amber-600">cm</span>
            <button onClick={handleSaveMeasure} className="btn-primary text-xs py-1 px-3">OK</button>
          </div>
        )}
        {!ready && (
          <div className="flex items-center justify-center" style={{ height:200 }}>
            <Spinner />
          </div>
        )}
        <div style={{ overflow:'auto', maxHeight:420, display: ready ? 'block' : 'none' }}>
          <canvas ref={canvasRef} />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="btn-ghost text-xs">Annuler</button>
          <button onClick={handleSave} className="btn-primary text-xs" disabled={!ready}>Sauvegarder</button>
        </div>
      </div>
    </div>
  )
}

// ── Step Indicator ─────────────────────────────────────────────────────────
function StepIndicator({ current, t }) {
  return (
    <div className="flex items-center px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#161B22]">
      {[
        { n:1, label:t('ticket.step1'), desc:t('ticket.step1_desc') },
        { n:2, label:'Confirmation',   desc:'Vérifier et soumettre' },
      ].map((s, i, arr) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
              style={{ background: current===s.n ? '#185FA5' : current>s.n ? '#1D9E75' : 'var(--color-background-secondary)', color: current>=s.n ? 'white' : 'var(--color-text-secondary)', border: current<s.n ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
              {current > s.n ? <i className="ti ti-check" style={{ fontSize:10 }} /> : s.n}
            </div>
            <div>
              <div className="text-xs font-medium" style={{ color: current===s.n ? '#185FA5' : current>s.n ? '#1D9E75' : 'var(--color-text-secondary)' }}>{s.label}</div>
              <div style={{ fontSize:9, color:'var(--color-text-secondary)' }}>{s.desc}</div>
            </div>
          </div>
          {i < arr.length-1 && <div className="flex-1 mx-3" style={{ height:1, background: current>s.n ? '#1D9E75' : 'var(--color-border-tertiary)' }} />}
        </div>
      ))}
    </div>
  )
}

// ── Line Row ───────────────────────────────────────────────────────────────
function LineRow({ line, idx, onChange, onDelete, plants, t }) {
  const fileInputRef = useRef(null)
  const [annotating, setAnnotating] = useState(null) // photo index being annotated

  const handleFiles = async (files) => {
    const newPhotos = await Promise.all(Array.from(files).map(async f => ({
      file: f,
      buffer: await f.arrayBuffer(),
      type: f.type || 'image/jpeg',
      name: f.name,
      preview: URL.createObjectURL(f),
      dataUrl: null,
      annotated: false,
    })))
    onChange(idx, '_addPhotos', newPhotos)
  }

  const handleAnnotationSave = (dataUrl) => {
    onChange(idx, '_saveAnnotation', { photoIdx: annotating, dataUrl })
    setAnnotating(null)
  }

  const photoBeingAnnotated = annotating !== null ? line.photos?.[annotating] : null

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-2 bg-gray-50 dark:bg-[#0D1117]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('ticket.line_n')} {idx+1}</span>
        {idx > 0 && (
          <button onClick={() => onDelete(idx)} className="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer p-0">
            <i className="ti ti-trash text-sm" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="col-span-2">
          <label className="label">{t('ticket.issue')} *</label>
          <input className="input text-xs" value={line.quality_issue||''} onChange={e => onChange(idx,'quality_issue',e.target.value)} placeholder="Description du problème..." />
        </div>
        <div>
          <label className="label">{t('ticket.categories')}</label>
          <select className="input text-xs" value={line.categories||''} onChange={e => onChange(idx,'categories',e.target.value)}>
            <option value="">—</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.department')}</label>
          <select className="input text-xs" value={line.department||''} onChange={e => onChange(idx,'department',e.target.value)}>
            <option value="">—</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.line_item')}</label>
          <input className="input text-xs" value={line.line_item||''} onChange={e => onChange(idx,'line_item',e.target.value)} placeholder="Line item..." />
        </div>
        <div>
          <label className="label">{t('ticket.foliot_id')}</label>
          <input className="input text-xs" value={line.foliot_id||''} onChange={e => onChange(idx,'foliot_id',e.target.value)} placeholder="Foliot ID..." />
        </div>
        <div>
          <label className="label">{t('ticket.plant')}</label>
          <select className="input text-xs" value={line.plant||''} onChange={e => onChange(idx,'plant',e.target.value)}>
            <option value="">—</option>{(plants||[]).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.affected_qty')}</label>
          <input className="input text-xs" type="number" min="0" value={line.affected_qty||''} onChange={e => onChange(idx,'affected_qty',e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">{t('ticket.cost')}</label>
          <input className="input text-xs" value={line.cost_approx||''} onChange={e => onChange(idx,'cost_approx',e.target.value)} placeholder="$0.00" />
        </div>
      </div>

      {/* Photos */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Photos</div>
        {(line.photos||[]).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {(line.photos||[]).map((p, pi) => (
              <div key={pi} className="relative group" style={{ cursor:'pointer' }} onClick={() => setAnnotating(pi)}>
                <img src={p.dataUrl || p.preview} alt="" className="w-16 h-16 object-cover rounded border border-gray-200 dark:border-gray-700" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded transition-all flex items-center justify-center">
                  <i className="ti ti-pencil text-white opacity-0 group-hover:opacity-100 text-sm" aria-hidden="true" />
                </div>
                <button onClick={e => { e.stopPropagation(); onChange(idx,'_removePhoto',pi) }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ fontSize:8 }}>✕</button>
                {p.annotated && (
                  <div className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-center rounded-b" style={{ fontSize:8, padding:'1px 0' }}>annoté</div>
                )}
              </div>
            ))}
          </div>
        )}
        <label className="btn-ghost text-xs py-1 px-2 cursor-pointer inline-flex items-center gap-1">
          <i className="ti ti-upload text-xs" aria-hidden="true" /> Importer
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
        </label>
      </div>

      {photoBeingAnnotated && (
        <PhotoAnnotator
          photoUrl={photoBeingAnnotated.dataUrl || photoBeingAnnotated.preview}
          onSave={handleAnnotationSave}
          onClose={() => setAnnotating(null)}
        />
      )}
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export default function TicketModal({ onClose }) {
  const { t }       = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)

  const [form, setForm] = useState({
    issue_reception_date: new Date().toISOString().slice(0,10),
    brand:'', ship_to:'', sold_to:'', ref_so:'', sc_number:'',
  })

  const emptyLine = () => ({
    quality_issue:'', categories:'', department:'', line_item:'',
    foliot_id:'', plant:'', affected_qty:'', cost_approx:'', photos:[],
  })
  const [lines, setLines] = useState([emptyLine()])

  const setField = (k,v) => setForm(f => ({...f,[k]:v}))

  const updateLine = (idx, key, val) => {
    setLines(ls => ls.map((l,i) => {
      if (i !== idx) return l
      if (key === '_addPhotos')    return { ...l, photos: [...(l.photos||[]), ...val] }
      if (key === '_removePhoto')  return { ...l, photos: (l.photos||[]).filter((_,pi) => pi !== val) }
      if (key === '_saveAnnotation') {
        const newPhotos = [...(l.photos||[])]
        newPhotos[val.photoIdx] = { ...newPhotos[val.photoIdx], dataUrl: val.dataUrl, annotated: true }
        return { ...l, photos: newPhotos }
      }
      return { ...l, [key]: val }
    }))
  }

  const addLine    = () => setLines(ls => [...ls, emptyLine()])
  const deleteLine = (idx) => { if (lines.length > 1) setLines(ls => ls.filter((_,i) => i !== idx)) }

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').eq('active',true).order('name')
      return data || []
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const dateYYYYMM = form.issue_reception_date?.slice(0,7)

      // 1. Create ticket
      const { data: occ, error: occErr } = await supabase.from('tickets').insert({
        issue_reception_date: form.issue_reception_date,
        date_yyyy_mm:  dateYYYYMM,
        fiscal_year:   getFiscalYear(dateYYYYMM),
        fiscal_month:  getFiscalMonth(dateYYYYMM),
        brand:         form.brand      || null,
        ship_to:       form.ship_to    || null,
        sold_to:       form.sold_to    || null,
        ref_so:        form.ref_so     || null,
        sc_number:     form.sc_number  || null,
        status:        'service_desk',
        quality_issue: lines[0]?.quality_issue || null,
        plant:         lines[0]?.plant         || null,
        categories:    lines[0]?.categories    || null,
        affected_qty:  lines[0]?.affected_qty  ? Number(lines[0].affected_qty) : null,
        department:    lines[0]?.department    || null,
        cost_approx:   lines[0]?.cost_approx   ? Number(lines[0].cost_approx)  : null,
      }).select().single()
      if (occErr) throw occErr

      // 2. Create lines
      const { data: createdLines, error: linesErr } = await supabase
        .from('occurrence_lines')
        .insert(lines.map((l,i) => ({
          occurrence_id: occ.id,
          quality_issue: l.quality_issue || null,
          categories:    l.categories    || null,
          department:    l.department    || null,
          line_item:     l.line_item     || null,
          foliot_id:     l.foliot_id     || null,
          plant:         l.plant         || null,
          affected_qty:  l.affected_qty  ? Number(l.affected_qty) : null,
          cost_approx:   l.cost_approx   ? Number(l.cost_approx)  : null,
          sort_order:    i,
        })))
        .select()
      if (linesErr) throw linesErr

      // 3. Upload photos for each line
      for (let li = 0; li < lines.length; li++) {
        const linePhotos = lines[li].photos || []
        if (linePhotos.length === 0) continue
        const lineId = createdLines?.[li]?.id || null
        for (const photo of linePhotos) {
          try {
            // Get blob: annotated uses dataUrl, otherwise use stored buffer
            let blob
            if (photo.annotated && photo.dataUrl) {
              // Convert dataUrl to blob without fetch
              const arr = photo.dataUrl.split(',')
              const mime = arr[0].match(/:(.*?);/)[1]
              const bstr = atob(arr[1])
              let n = bstr.length
              const u8arr = new Uint8Array(n)
              while (n--) u8arr[n] = bstr.charCodeAt(n)
              blob = new Blob([u8arr], { type: mime })
            } else if (photo.buffer) {
              blob = new Blob([photo.buffer], { type: photo.type || 'image/jpeg' })
            } else if (photo.file) {
              blob = photo.file
            } else continue

            const ext  = (photo.name || 'photo.jpg').split('.').pop().replace(/[^a-z0-9]/gi,'') || 'jpg'
            const path = `tickets/${occ.id}/${Date.now()}_${li}_${Math.random().toString(36).slice(2,5)}.${ext}`
            const { error: upErr } = await supabase.storage.from('ticket-photos').upload(path, blob, { contentType: blob.type || 'image/jpeg' })
            if (upErr) { console.warn('Photo upload failed:', upErr.message); continue }
            const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
            await supabase.from('ticket_photos').insert({
              ticket_id: occ.id, url: urlData.publicUrl, name: photo.name || 'photo.jpg', path, line_id: lineId,
            })
          } catch (photoErr) {
            console.warn('Photo error (non-fatal):', photoErr)
          }
        }
      }

      return occ
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tickets'])
      toast.success('Occurrence créée et soumise au Service Desk')
      onClose()
    },
    onError: (e) => {
      console.error('CREATE ERROR:', e)
      toast.error(e.message || t('common.error'))
    },
  })

  const canSubmit    = form.issue_reception_date && lines.some(l => l.quality_issue)
  const totalPhotos  = lines.reduce((s,l) => s + (l.photos?.length||0), 0)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 w-full shadow-2xl flex flex-col" style={{ maxWidth:660, maxHeight:'92vh' }}>

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('ticket.new')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-transparent border-0 cursor-pointer text-xl leading-none">✕</button>
        </div>

        <StepIndicator current={step} t={t} />

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('ticket.reception_date')} *</label><input type="date" className="input" value={form.issue_reception_date} onChange={e => setField('issue_reception_date',e.target.value)} /></div>
                <div><label className="label">{t('ticket.brand')}</label><select className="input" value={form.brand} onChange={e => setField('brand',e.target.value)}><option value="">—</option>{BRANDS.map(b => <option key={b}>{b}</option>)}</select></div>
                <div><label className="label">{t('ticket.sc_number')}</label><input className="input" value={form.sc_number} onChange={e => setField('sc_number',e.target.value)} placeholder="SC#..." /></div>
                <div><label className="label">{t('ticket.ship_to')}</label><input className="input" value={form.ship_to} onChange={e => setField('ship_to',e.target.value)} placeholder="Ship To..." /></div>
                <div><label className="label">{t('ticket.sold_to')}</label><input className="input" value={form.sold_to} onChange={e => setField('sold_to',e.target.value)} placeholder="Sold To..." /></div>
                <div><label className="label">{t('ticket.ref_so')}</label><input className="input" value={form.ref_so} onChange={e => setField('ref_so',e.target.value)} placeholder="REF SO..." /></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">{t('ticket.lines')} *</label>
                  <button onClick={addLine} className="btn-ghost text-xs py-1 px-2.5"><i className="ti ti-plus text-xs" aria-hidden="true" /> {t('ticket.add_line')}</button>
                </div>
                {lines.map((line,idx) => (
                  <LineRow key={idx} line={line} idx={idx} onChange={updateLine} onDelete={deleteLine} plants={plants} t={t} />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Informations générales</div>
                <div className="grid grid-cols-2 gap-1">
                  {[[t('ticket.reception_date'),form.issue_reception_date],[t('ticket.brand'),form.brand],[t('ticket.ship_to'),form.ship_to],[t('ticket.sold_to'),form.sold_to],[t('ticket.ref_so'),form.ref_so],[t('ticket.sc_number'),form.sc_number]].filter(([,v])=>v).map(([l,v]) => (
                    <div key={l} className="flex justify-between text-xs py-1 border-b border-gray-50 dark:border-gray-800">
                      <span className="text-gray-400">{l}</span>
                      <span className="text-gray-900 dark:text-gray-100 font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{lines.length} {t('ticket.lines').toLowerCase()} · {totalPhotos} photo{totalPhotos!==1?'s':''}</div>
                {lines.map((l,i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#0D1117] rounded-lg mb-1.5 text-xs">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-medium" style={{ background:'#E6F1FB', color:'#185FA5', fontSize:9 }}>{i+1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.quality_issue||'—'}</div>
                      <div className="text-gray-400">{[l.department,l.plant,l.line_item,l.affected_qty?`Qté: ${l.affected_qty}`:'',l.cost_approx?`$${l.cost_approx}`:''].filter(Boolean).join(' · ')}</div>
                    </div>
                    {(l.photos?.length||0) > 0 && <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded text-xs">{l.photos.length} photo{l.photos.length>1?'s':''}</span>}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                <i className="ti ti-send text-sm" aria-hidden="true" />
                {t('ticket.submit_to_sd')} — le statut passera à Service Desk
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-800">
          <button onClick={step===1 ? onClose : () => setStep(1)} className="btn-ghost text-xs">
            {step===1 ? t('common.cancel') : <><i className="ti ti-arrow-left text-xs" aria-hidden="true" /> {t('common.previous')}</>}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{t('common.step')} {step}/2</span>
            {step===1 ? (
              <button onClick={() => setStep(2)} disabled={!canSubmit} className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                {t('common.next')} <i className="ti ti-arrow-right text-xs" aria-hidden="true" />
              </button>
            ) : (
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="btn-primary text-xs">
                {createMut.isPending ? <Spinner size="sm" /> : <><i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_sd')}</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
