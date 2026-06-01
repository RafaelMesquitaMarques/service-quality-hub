import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { Spinner } from '../../components/ui'
import toast from 'react-hot-toast'

const DEPARTMENTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]
const CATEGORIES = ['Damage','Missing parts','Wrong item','Assembly issue','Finish defect','Packaging','Measurement','Other']
const BRANDS     = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']
const COLORS     = ['#E24B4A','#185FA5','#1D9E75','#BA7517','#888780','#ffffff']
const TOOLS      = [
  { id:'select',    icon:'ti-cursor-text',  label:'Sélection' },
  { id:'pen',       icon:'ti-pencil',       label:'Stylo' },
  { id:'arrow',     icon:'ti-arrow-up-right', label:'Flèche' },
  { id:'rect',      icon:'ti-square',       label:'Rectangle' },
  { id:'circle',    icon:'ti-circle',       label:'Cercle' },
  { id:'text',      icon:'ti-letter-t',     label:'Texte' },
  { id:'measure',   icon:'ti-ruler',        label:'Mesure' },
]

// ── Photo Annotator Component ──────────────────────────────────────────────
function PhotoAnnotator({ photo, onSave, onClose }) {
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const [tool,      setTool]      = useState('select')
  const [color,     setColor]     = useState('#E24B4A')
  const [thickness, setThickness] = useState(3)
  const [measuring, setMeasuring] = useState(false)
  const [measurePts, setMeasurePts] = useState([])
  const [measureVal, setMeasureVal] = useState('')
  const [measureLine, setMeasureLine] = useState(null)

  useEffect(() => {
    if (!window.fabric) return
    const canvas = new window.fabric.Canvas(canvasRef.current, { width: 560, height: 340 })
    fabricRef.current = canvas
    window.fabric.Image.fromURL(photo.url, img => {
      img.scaleToWidth(560)
      canvas.setHeight(img.getScaledHeight())
      canvas.add(img)
      img.selectable = false
      canvas.sendToBack(img)
      canvas.renderAll()
    }, { crossOrigin: 'anonymous' })
    return () => canvas.dispose()
  }, [photo.url])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.isDrawingMode = false
    canvas.off('mouse:down')
    canvas.off('mouse:move')
    canvas.off('mouse:up')

    if (tool === 'pen') {
      canvas.isDrawingMode = true
      canvas.freeDrawingBrush.color = color
      canvas.freeDrawingBrush.width = thickness
    } else if (tool === 'select') {
      canvas.selection = true
    } else if (tool === 'measure') {
      canvas.selection = false
      let pts = []
      let tempLine = null
      canvas.on('mouse:down', o => {
        const p = canvas.getPointer(o.e)
        if (pts.length === 0) {
          pts = [p]
          setMeasurePts([p])
        } else if (pts.length === 1) {
          pts.push(p)
          setMeasurePts([...pts])
          if (tempLine) canvas.remove(tempLine)
          const line = new window.fabric.Line(
            [pts[0].x, pts[0].y, pts[1].x, pts[1].y],
            { stroke: color, strokeWidth: 2, selectable: false, evented: false }
          )
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
          const dot1 = new window.fabric.Circle({ left: pts[0].x - 4, top: pts[0].y - 4, radius: 4, fill: color, selectable: false, evented: false })
          const dot2 = new window.fabric.Circle({ left: pts[1].x - 4, top: pts[1].y - 4, radius: 4, fill: color, selectable: false, evented: false })
          const grp = new window.fabric.Group([line, dot1, dot2], { selectable: true, id: 'measure_group' })
          canvas.add(grp)
          setMeasureLine(grp)
          canvas.renderAll()
          pts = []
          setMeasuring(true)
        }
      })
      canvas.on('mouse:move', o => {
        if (pts.length === 1) {
          if (tempLine) canvas.remove(tempLine)
          const p = canvas.getPointer(o.e)
          tempLine = new window.fabric.Line(
            [pts[0].x, pts[0].y, p.x, p.y],
            { stroke: color, strokeWidth: 2, selectable: false, evented: false, strokeDashArray: [4, 4] }
          )
          canvas.add(tempLine)
          canvas.renderAll()
        }
      })
    } else if (['arrow','rect','circle','text'].includes(tool)) {
      canvas.selection = false
      let origin = null
      let shape  = null
      canvas.on('mouse:down', o => {
        origin = canvas.getPointer(o.e)
        if (tool === 'text') {
          const txt = new window.fabric.IText('Text', {
            left: origin.x, top: origin.y,
            fontSize: 16, fill: color,
            fontFamily: 'sans-serif', editable: true,
          })
          canvas.add(txt)
          canvas.setActiveObject(txt)
          txt.enterEditing()
          canvas.renderAll()
          origin = null
        }
      })
      canvas.on('mouse:move', o => {
        if (!origin) return
        const p = canvas.getPointer(o.e)
        if (shape) canvas.remove(shape)
        if (tool === 'rect') {
          shape = new window.fabric.Rect({
            left: Math.min(origin.x, p.x), top: Math.min(origin.y, p.y),
            width: Math.abs(p.x - origin.x), height: Math.abs(p.y - origin.y),
            stroke: color, strokeWidth: thickness, fill: 'transparent',
          })
        } else if (tool === 'circle') {
          const r = Math.sqrt(Math.pow(p.x - origin.x, 2) + Math.pow(p.y - origin.y, 2)) / 2
          shape = new window.fabric.Circle({
            left: Math.min(origin.x, p.x), top: Math.min(origin.y, p.y),
            radius: r, stroke: color, strokeWidth: thickness, fill: 'transparent',
          })
        } else if (tool === 'arrow') {
          const angle = Math.atan2(p.y - origin.y, p.x - origin.x) * 180 / Math.PI
          const len   = Math.sqrt(Math.pow(p.x - origin.x, 2) + Math.pow(p.y - origin.y, 2))
          const line  = new window.fabric.Line([0, 0, len, 0], { stroke: color, strokeWidth: thickness })
          const head  = new window.fabric.Triangle({ width: 12, height: 14, fill: color, left: len - 6, top: -7 })
          shape = new window.fabric.Group([line, head], {
            left: origin.x, top: origin.y, angle,
            originX: 'left', originY: 'center',
          })
        }
        if (shape) { canvas.add(shape); canvas.renderAll() }
      })
      canvas.on('mouse:up', () => { shape = null; origin = null })
    }
  }, [tool, color, thickness])

  const handleUndo = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const objects = canvas.getObjects()
    if (objects.length > 1) { canvas.remove(objects[objects.length - 1]); canvas.renderAll() }
  }

  const handleSaveMeasure = () => {
    if (!measureVal || !measureLine || !fabricRef.current) return
    const canvas = fabricRef.current
    const bounds = measureLine.getBoundingRect()
    const label  = new window.fabric.Rect({
      left: bounds.left + bounds.width / 2 - 30,
      top:  bounds.top - 22,
      width: 60, height: 20,
      fill: '#BA7517', rx: 4, ry: 4, selectable: false,
    })
    const txt = new window.fabric.Text(`${measureVal} cm`, {
      left: bounds.left + bounds.width / 2,
      top:  bounds.top - 20,
      fontSize: 11, fill: 'white', fontFamily: 'sans-serif',
      originX: 'center', selectable: false,
    })
    canvas.add(label, txt)
    canvas.renderAll()
    setMeasuring(false)
    setMeasureVal('')
    setMeasureLine(null)
    setTool('select')
  }

  const handleSave = () => {
    const canvas = fabricRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.85 })
    onSave(dataUrl)
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ maxWidth: 620 }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Annotation</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer text-lg">✕</button>
        </div>
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1.5 flex-wrap bg-gray-50 dark:bg-[#0D1117]">
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.label} aria-label={t.label}
              className="w-7 h-7 rounded flex items-center justify-center border cursor-pointer transition-all"
              style={{
                border: tool === t.id ? `1.5px solid ${color}` : '0.5px solid var(--color-border-tertiary)',
                background: tool === t.id ? color + '22' : 'var(--color-background-primary)',
                color: tool === t.id ? color : 'var(--color-text-secondary)',
              }}>
              <i className={`ti ${t.icon}`} style={{ fontSize: 13 }} aria-hidden="true" />
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--color-border-tertiary)', margin: '0 4px' }} />
          {COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)}
              style={{ width: 14, height: 14, borderRadius: '50%', background: c, cursor: 'pointer',
                border: color === c ? '2px solid #185FA5' : '1px solid var(--color-border-tertiary)', flexShrink: 0 }} />
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--color-border-tertiary)', margin: '0 4px' }} />
          <input type="range" min="1" max="8" value={thickness} onChange={e => setThickness(Number(e.target.value))}
            style={{ width: 60 }} />
          <div style={{ width: 1, height: 20, background: 'var(--color-border-tertiary)', margin: '0 4px' }} />
          <button onClick={handleUndo} title="Undo" aria-label="Undo"
            className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 dark:border-gray-700 cursor-pointer bg-transparent">
            <i className="ti ti-arrow-back-up" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }} aria-hidden="true" />
          </button>
        </div>
        {measuring && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3">
            <i className="ti ti-ruler text-amber-600 text-sm" aria-hidden="true" />
            <span className="text-xs text-amber-700 dark:text-amber-300">Mesure tracée — entrez la valeur:</span>
            <input type="text" value={measureVal} onChange={e => setMeasureVal(e.target.value)}
              className="border border-amber-300 rounded px-2 py-1 text-xs w-20 outline-none dark:bg-[#161B22] dark:text-gray-100"
              placeholder="ex: 35" autoFocus />
            <span className="text-xs text-amber-600">cm</span>
            <button onClick={handleSaveMeasure}
              className="btn-primary text-xs py-1 px-3">OK</button>
          </div>
        )}
        <div style={{ overflow: 'auto', maxHeight: 400 }}>
          <canvas ref={canvasRef} />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="btn-ghost text-xs">Annuler</button>
          <button onClick={handleSave} className="btn-primary text-xs">Sauvegarder annotation</button>
        </div>
      </div>
    </div>
  )
}

// ── Line Row Component ─────────────────────────────────────────────────────
function LineRow({ line, idx, onChange, onDelete, onPhotoUpload, onAnnotate, plants, t }) {
  const fileRef = useRef(null)

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-2 bg-gray-50 dark:bg-[#0D1117]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('ticket.line_n')} {idx + 1}</span>
        <button onClick={() => onDelete(idx)} className="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer p-0">
          <i className="ti ti-trash text-sm" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="col-span-2">
          <label className="label">{t('ticket.issue')} *</label>
          <input className="input text-xs" value={line.quality_issue || ''} onChange={e => onChange(idx, 'quality_issue', e.target.value)} placeholder="Description du problème..." />
        </div>
        <div>
          <label className="label">{t('ticket.categories')}</label>
          <select className="input text-xs" value={line.categories || ''} onChange={e => onChange(idx, 'categories', e.target.value)}>
            <option value="">—</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.department')}</label>
          <select className="input text-xs" value={line.department || ''} onChange={e => onChange(idx, 'department', e.target.value)}>
            <option value="">—</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.line_item')}</label>
          <input className="input text-xs" value={line.line_item || ''} onChange={e => onChange(idx, 'line_item', e.target.value)} placeholder="Line item..." />
        </div>
        <div>
          <label className="label">{t('ticket.foliot_id')}</label>
          <input className="input text-xs" value={line.foliot_id || ''} onChange={e => onChange(idx, 'foliot_id', e.target.value)} placeholder="Foliot ID..." />
        </div>
        <div>
          <label className="label">{t('ticket.plant')}</label>
          <select className="input text-xs" value={line.plant || ''} onChange={e => onChange(idx, 'plant', e.target.value)}>
            <option value="">—</option>
            {(plants || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('ticket.affected_qty')}</label>
          <input className="input text-xs" type="number" min="0" value={line.affected_qty || ''} onChange={e => onChange(idx, 'affected_qty', e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">{t('ticket.cost')}</label>
          <input className="input text-xs" value={line.cost_approx || ''} onChange={e => onChange(idx, 'cost_approx', e.target.value)} placeholder="$0.00" />
        </div>
      </div>

      {/* Photos section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Photos</div>

        {/* Annotation toolbar */}
        {line.photos && line.photos.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mb-2">
            {TOOLS.map(tool => (
              <button key={tool.id}
                onClick={() => onChange(idx, '_activeTool', tool.id)}
                title={tool.label} aria-label={tool.label}
                className="w-6 h-6 rounded flex items-center justify-center border cursor-pointer"
                style={{
                  border: line._activeTool === tool.id ? '1.5px solid #185FA5' : '0.5px solid var(--color-border-tertiary)',
                  background: line._activeTool === tool.id ? '#E6F1FB' : 'var(--color-background-primary)',
                  color: line._activeTool === tool.id ? '#185FA5' : 'var(--color-text-secondary)',
                }}>
                <i className={`ti ${tool.icon}`} style={{ fontSize: 11 }} aria-hidden="true" />
              </button>
            ))}
            <div style={{ width: 1, height: 16, background: 'var(--color-border-tertiary)', margin: '0 2px' }} />
            {COLORS.map(c => (
              <div key={c} onClick={() => onChange(idx, '_color', c)}
                style={{ width: 12, height: 12, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: (line._color || '#E24B4A') === c ? '2px solid #185FA5' : '0.5px solid var(--color-border-tertiary)' }} />
            ))}
            <div style={{ width: 1, height: 16, background: 'var(--color-border-tertiary)', margin: '0 2px' }} />
            <button title="Undo" aria-label="Undo"
              className="w-6 h-6 rounded flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-transparent cursor-pointer">
              <i className="ti ti-arrow-back-up" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Photo thumbnails */}
        {line.photos && line.photos.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {line.photos.map((p, pi) => (
              <div key={pi} className="relative group cursor-pointer" onClick={() => onAnnotate(idx, pi)}>
                <img src={p.preview || p.url} alt="" className="w-14 h-14 object-cover rounded border border-gray-200 dark:border-gray-700" />
                <button
                  onClick={e => { e.stopPropagation(); onChange(idx, '_removePhoto', pi) }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs items-center justify-center hidden group-hover:flex border-0 cursor-pointer">
                  <i className="ti ti-x" style={{ fontSize: 8 }} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <label className="btn-ghost text-xs py-1 px-2 cursor-pointer">
            <i className="ti ti-upload text-xs" aria-hidden="true" /> Importer
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => onPhotoUpload(idx, Array.from(e.target.files))} />
          </label>
        </div>
      </div>
    </div>
  )
}

// ── Step Indicator ─────────────────────────────────────────────────────────
function StepIndicator({ current, t }) {
  const steps = [
    { n: 1, label: t('ticket.step1'), desc: t('ticket.step1_desc') },
    { n: 2, label: 'Confirmation', desc: 'Vérifier et soumettre' },
  ]
  return (
    <div className="flex items-center px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#161B22]">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 transition-all"
              style={{
                background: current === s.n ? '#185FA5' : current > s.n ? '#1D9E75' : 'var(--color-background-secondary)',
                color: current >= s.n ? 'white' : 'var(--color-text-secondary)',
                border: current < s.n ? '0.5px solid var(--color-border-tertiary)' : 'none',
              }}>
              {current > s.n ? <i className="ti ti-check" style={{ fontSize: 10 }} /> : s.n}
            </div>
            <div>
              <div className="text-xs font-medium" style={{ color: current === s.n ? '#185FA5' : current > s.n ? '#1D9E75' : 'var(--color-text-secondary)' }}>{s.label}</div>
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>{s.desc}</div>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 mx-3" style={{ height: 1, background: current > s.n ? '#1D9E75' : 'var(--color-border-tertiary)' }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export default function TicketModal({ onClose }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [annotating, setAnnotating] = useState(null) // { lineIdx, photoIdx }

  const [form, setForm] = useState({
    issue_reception_date: new Date().toISOString().slice(0, 10),
    brand: '', ship_to: '', sold_to: '', ref_so: '', sc_number: '',
  })
  const [lines, setLines] = useState([{
    quality_issue: '', categories: '', department: '', line_item: '',
    foliot_id: '', plant: '', affected_qty: '', cost_approx: '',
    photos: [], _activeTool: 'select', _color: '#E24B4A',
  }])

  // Load Fabric.js
  useEffect(() => {
    if (window.fabric) return
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js'
    document.head.appendChild(script)
  }, [])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateLine = (idx, key, val) => {
    if (key === '_removePhoto') {
      setLines(ls => ls.map((l, i) => i === idx ? { ...l, photos: l.photos.filter((_, pi) => pi !== val) } : l))
      return
    }
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, [key]: val } : l))
  }

  const addLine = () => setLines(ls => [...ls, {
    quality_issue: '', categories: '', department: '', line_item: '',
    foliot_id: '', plant: '', affected_qty: '', cost_approx: '',
    photos: [], _activeTool: 'select', _color: '#E24B4A',
  }])

  const deleteLine = (idx) => { if (lines.length > 1) setLines(ls => ls.filter((_, i) => i !== idx)) }

  const handlePhotoUpload = (lineIdx, files) => {
    const newPhotos = files.map(f => ({ file: f, preview: URL.createObjectURL(f), url: URL.createObjectURL(f), name: f.name }))
    setLines(ls => ls.map((l, i) => i === lineIdx ? { ...l, photos: [...l.photos, ...newPhotos] } : l))
  }

  const handleAnnotateSave = (dataUrl) => {
    if (!annotating) return
    const { lineIdx, photoIdx } = annotating
    setLines(ls => ls.map((l, i) => {
      if (i !== lineIdx) return l
      const newPhotos = [...l.photos]
      newPhotos[photoIdx] = { ...newPhotos[photoIdx], preview: dataUrl, annotated: true }
      return { ...l, photos: newPhotos }
    }))
    setAnnotating(null)
  }

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').eq('active', true).order('name')
      return data || []
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const dateYYYYMM = form.issue_reception_date?.slice(0, 7)
      const { data: occ, error: occErr } = await supabase.from('tickets').insert({
        issue_reception_date: form.issue_reception_date,
        date_yyyy_mm:  dateYYYYMM,
        fiscal_year:   getFiscalYear(dateYYYYMM),
        fiscal_month:  getFiscalMonth(dateYYYYMM),
        brand:         form.brand    || null,
        ship_to:       form.ship_to  || null,
        sold_to:       form.sold_to  || null,
        ref_so:        form.ref_so   || null,
        sc_number:     form.sc_number || null,
        status:        'service_desk',
        quality_issue: lines[0]?.quality_issue || null,
        plant:         lines[0]?.plant || null,
        categories:    lines[0]?.categories || null,
        affected_qty:  lines[0]?.affected_qty ? Number(lines[0].affected_qty) : null,
        department:    lines[0]?.department || null,
        cost_approx:   lines[0]?.cost_approx ? Number(lines[0].cost_approx) : null,
      }).select().single()
      if (occErr) throw occErr

      const linesData = lines.map((l, i) => ({
        occurrence_id: occ.id,
        quality_issue: l.quality_issue || null,
        categories:    l.categories    || null,
        department:    l.department    || null,
        line_item:     l.line_item     || null,
        foliot_id:     l.foliot_id     || null,
        plant:         l.plant         || null,
        affected_qty:  l.affected_qty  ? Number(l.affected_qty) : null,
        cost_approx:   l.cost_approx   ? Number(l.cost_approx) : null,
        sort_order:    i,
      }))
      const { error: linesErr } = await supabase.from('occurrence_lines').insert(linesData)
      if (linesErr) throw linesErr

      // Upload photos
      for (let li = 0; li < lines.length; li++) {
        const lineData = lines[li]
        if (!lineData.photos || lineData.photos.length === 0) continue
        const { data: lineRows } = await supabase.from('occurrence_lines')
          .select('id').eq('occurrence_id', occ.id).eq('sort_order', li).single()
        const lineId = lineRows?.id
        for (const photo of lineData.photos) {
          if (!photo.file && !photo.annotated) continue
          let blob
          if (photo.annotated && photo.preview) {
            const res = await fetch(photo.preview)
            blob = await res.blob()
          } else {
            blob = photo.file
          }
          const ext = photo.name?.split('.').pop() || 'jpg'
          const path = `tickets/${occ.id}/${Date.now()}_${li}.${ext}`
          const { error: upErr } = await supabase.storage.from('ticket-photos').upload(path, blob)
          if (upErr) continue
          const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
          await supabase.from('ticket_photos').insert({
            ticket_id: occ.id, url: urlData.publicUrl, name: photo.name, path, line_id: lineId || null,
          })
        }
      }
      return occ
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tickets'])
      toast.success('Occurrence soumise au Service Desk')
      onClose()
    },
    onError: (e) => {
      console.error('CREATE OCCURRENCE ERROR:', e)
      toast.error(e.message || t('common.error'))
    },
  })

  const canSubmit = form.issue_reception_date && lines.some(l => l.quality_issue)
  const totalPhotos = lines.reduce((s, l) => s + (l.photos?.length || 0), 0)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: '92vh' }}>

          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('ticket.new')}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-transparent border-0 cursor-pointer text-lg">✕</button>
          </div>

          <StepIndicator current={step} t={t} />

          <div className="flex-1 overflow-y-auto px-5 py-4">

            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">{t('ticket.reception_date')} *</label>
                    <input type="date" className="input" value={form.issue_reception_date} onChange={e => setField('issue_reception_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('ticket.brand')}</label>
                    <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
                      <option value="">—</option>
                      {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('ticket.sc_number')}</label>
                    <input className="input" value={form.sc_number} onChange={e => setField('sc_number', e.target.value)} placeholder="SC#..." />
                  </div>
                  <div>
                    <label className="label">{t('ticket.ship_to')}</label>
                    <input className="input" value={form.ship_to} onChange={e => setField('ship_to', e.target.value)} placeholder="Ship To..." />
                  </div>
                  <div>
                    <label className="label">{t('ticket.sold_to')}</label>
                    <input className="input" value={form.sold_to} onChange={e => setField('sold_to', e.target.value)} placeholder="Sold To..." />
                  </div>
                  <div>
                    <label className="label">{t('ticket.ref_so')}</label>
                    <input className="input" value={form.ref_so} onChange={e => setField('ref_so', e.target.value)} placeholder="REF SO..." />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">{t('ticket.lines')} *</label>
                    <button onClick={addLine} className="btn-ghost text-xs py-1 px-2.5">
                      <i className="ti ti-plus text-xs" aria-hidden="true" /> {t('ticket.add_line')}
                    </button>
                  </div>
                  {lines.map((line, idx) => (
                    <LineRow key={idx} line={line} idx={idx}
                      onChange={updateLine} onDelete={deleteLine}
                      onPhotoUpload={handlePhotoUpload}
                      onAnnotate={(li, pi) => setAnnotating({ lineIdx: li, photoIdx: pi })}
                      plants={plants} t={t} />
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Informations générales</div>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      [t('ticket.reception_date'), form.issue_reception_date],
                      [t('ticket.brand'), form.brand],
                      [t('ticket.ship_to'), form.ship_to],
                      [t('ticket.sold_to'), form.sold_to],
                      [t('ticket.ref_so'), form.ref_so],
                      [t('ticket.sc_number'), form.sc_number],
                    ].filter(([,v]) => v).map(([l, v]) => (
                      <div key={l} className="flex justify-between text-xs py-1 border-b border-gray-50 dark:border-gray-800">
                        <span className="text-gray-400">{l}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                    {lines.length} {t('ticket.lines').toLowerCase()} · {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''}
                  </div>
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#0D1117] rounded-lg mb-1.5 text-xs">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-medium"
                        style={{ background: '#E6F1FB', color: '#185FA5', fontSize: 9 }}>{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.quality_issue || '—'}</div>
                        <div className="text-gray-400">{[l.department, l.plant, l.line_item, l.affected_qty ? `Qté: ${l.affected_qty}` : '', l.cost_approx ? `$${l.cost_approx}` : ''].filter(Boolean).join(' · ')}</div>
                      </div>
                      {l.photos?.length > 0 && (
                        <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded text-xs">
                          {l.photos.length} photo{l.photos.length > 1 ? 's' : ''}
                        </span>
                      )}
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
            <button onClick={step === 1 ? onClose : () => setStep(1)} className="btn-ghost text-xs">
              {step === 1 ? t('common.cancel') : <><i className="ti ti-arrow-left text-xs" /> {t('common.previous')}</>}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{t('common.step')} {step}/2</span>
              {step === 1 ? (
                <button onClick={() => setStep(2)} disabled={!canSubmit}
                  className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                  {t('common.next')} <i className="ti ti-arrow-right text-xs" />
                </button>
              ) : (
                <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
                  className="btn-primary text-xs">
                  {createMut.isPending ? <Spinner size="sm" /> : <><i className="ti ti-send text-xs" /> {t('ticket.submit_to_sd')}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {annotating && lines[annotating.lineIdx]?.photos[annotating.photoIdx] && (
        <PhotoAnnotator
          photo={lines[annotating.lineIdx].photos[annotating.photoIdx]}
          onSave={handleAnnotateSave}
          onClose={() => setAnnotating(null)}
        />
      )}
    </>
  )
}
