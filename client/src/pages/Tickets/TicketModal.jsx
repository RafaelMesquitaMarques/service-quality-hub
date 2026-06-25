import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { Spinner } from '../../components/ui'
import { buildMediaItem, isVideoFile, MAX_VIDEO_BYTES, MAX_VIDEO_MB } from '../../utils/media'
import toast from 'react-hot-toast'

const BRANDS      = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']
const URGENCIES   = [
  { value:'overnight', label:'Overnight' },
  { value:'urgent',    label:'Urgent' },
  { value:'normal',    label:'Normal' },
]
const COLORS      = ['#E24B4A','#185FA5','#1D9E75','#BA7517','#888780','#ffffff']
const TOOLS       = [
  { id:'select',  icon:'ti-cursor-text',    key:'ticket.annot_select' },
  { id:'pen',     icon:'ti-pencil',         key:'ticket.annot_pen' },
  { id:'arrow',   icon:'ti-arrow-up-right', key:'ticket.annot_arrow' },
  { id:'rect',    icon:'ti-square',         key:'ticket.annot_rect' },
  { id:'circle',  icon:'ti-circle',         key:'ticket.annot_circle' },
  { id:'text',    icon:'ti-letter-t',       key:'ticket.annot_text' },
  { id:'measure', icon:'ti-ruler',          key:'ticket.annot_measure' },
]

// ── Photo Annotator ────────────────────────────────────────────────────────
function PhotoAnnotator({ photoUrl, onSave, onClose }) {
  const { t }       = useTranslation()
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

  useEffect(() => {
    const init = () => {
      if (!canvasRef.current || !window.fabric) return
      const canvas = new window.fabric.Canvas(canvasRef.current, { width: 700, height: 500 })
      fabricRef.current = canvas

      const imgEl = new Image()
      imgEl.crossOrigin = 'anonymous'
      imgEl.onload = () => {
        const fabricImg = new window.fabric.Image(imgEl)
        const scale = Math.min(700 / imgEl.width, 500 / imgEl.height, 1)
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
      let origin = null
      let shape  = null
      let drawing = false
      canvas.on('mouse:down', o => {
        if (o.target && o.target !== canvas.getObjects()[0]) return
        origin = canvas.getPointer(o.e)
        drawing = true
        if (tool === 'text') {
          const txt = new window.fabric.IText('Text', { left:origin.x, top:origin.y, fontSize:16, fill:color, fontFamily:'sans-serif', editable:true })
          canvas.add(txt); canvas.setActiveObject(txt); txt.enterEditing(); canvas.renderAll()
          origin = null; drawing = false
        }
      })
      canvas.on('mouse:move', o => {
        if (!drawing || !origin) return
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
      canvas.on('mouse:up', () => { shape = null; origin = null; drawing = false })
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
    const dataUrl = c.toDataURL({ format:'jpeg', quality:0.9 })
    onSave(dataUrl)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div className="bg-white dark:bg-[#161B22] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ maxWidth:620, width:'100%' }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('ticket.annotation')}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer text-xl leading-none">✕</button>
        </div>
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1 flex-wrap bg-gray-50 dark:bg-[#0D1117]">
          {TOOLS.map(tk => (
            <button key={tk.id} onClick={() => setTool(tk.id)} title={t(tk.key)} aria-label={t(tk.key)}
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
          <button onClick={handleUndo} title={t('ticket.annot_undo')} aria-label={t('ticket.annot_undo')} className="w-7 h-7 rounded flex items-center justify-center cursor-pointer bg-transparent border-0" style={{ outline:'1px solid var(--color-border-tertiary)', color:'var(--color-text-secondary)' }}>
            <i className="ti ti-arrow-back-up" style={{ fontSize:13 }} aria-hidden="true" />
          </button>
          <button onClick={handleDeleteSelected} title={t('ticket.annot_delete')} aria-label={t('ticket.annot_delete')} className="w-7 h-7 rounded flex items-center justify-center cursor-pointer bg-transparent border-0" style={{ outline:'1px solid var(--color-border-tertiary)', color:'#ef4444' }}>
            <i className="ti ti-trash" style={{ fontSize:13 }} aria-hidden="true" />
          </button>
        </div>
        {measuring && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3">
            <i className="ti ti-ruler text-amber-600 text-sm" aria-hidden="true" />
            <span className="text-xs text-amber-700 dark:text-amber-300">{t('ticket.annot_measure_prompt')}</span>
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
          <button onClick={onClose} className="btn-ghost text-xs">{t('common.cancel')}</button>
          <button onClick={handleSave} className="btn-primary text-xs" disabled={!ready}>{t('common.save')}</button>
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
        { n:2, label:t('ticket.confirmation'), desc:t('ticket.confirm_desc') },
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
  const [annotating, setAnnotating] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = async (files) => {
    const items = []
    for (const f of Array.from(files)) {
      if (isVideoFile(f) && f.size > MAX_VIDEO_BYTES) {
        toast.error(`${f.name} — ${t('ticket.video_too_large', { mb: MAX_VIDEO_MB })}`)
        continue
      }
      items.push(await buildMediaItem(f))
    }
    if (items.length) onChange(idx, '_addPhotos', items)
  }

  // Glisser-déposer : fichiers locaux (dont SharePoint synchronisé via OneDrive)
  // ou, à défaut, un lien glissé (tentative best-effort).
  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length) { handleFiles(files); return }
    const uri = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim()
    if (!/^https?:\/\//i.test(uri)) return
    const url = uri.split('\n').find(l => /^https?:\/\//i.test(l)) || uri
    try {
      const res  = await fetch(url)
      const blob = await res.blob()
      if (!/^(image|video)\//.test(blob.type)) throw new Error('not-media')
      const name = decodeURIComponent((url.split('/').pop() || 'photo.jpg').split('?')[0])
      handleFiles([new File([blob], name || 'photo.jpg', { type: blob.type })])
    } catch {
      toast.error(t('ticket.sharepoint_drop_hint'))
    }
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
          <input className="input text-xs" value={line.quality_issue||''} onChange={e => onChange(idx,'quality_issue',e.target.value)} placeholder={t('ticket.issue_placeholder')} />
        </div>
        <div className="col-span-2">
          <label className="label">{t('ticket.description')}</label>
          <textarea className="input text-xs" rows={2} value={line.description||''} onChange={e => onChange(idx,'description',e.target.value)} placeholder={t('ticket.description_placeholder')} />
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
          <label className="label">{t('ticket.ref_so')}</label>
          <input className="input text-xs" value={line.ref_so||''} onChange={e => onChange(idx,'ref_so',e.target.value)} placeholder="REF SO..." />
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
          <label className="label">{t('ticket.total_qty')}</label>
          <input className="input text-xs" type="number" min="0" value={line.total_qty||''} onChange={e => onChange(idx,'total_qty',e.target.value)} placeholder="0" />
        </div>
        <div className="col-span-2">
          <label className="label">{t('ticket.completion_type')}</label>
          <select className="input text-xs" value={line.completion_type||''} onChange={e => onChange(idx,'completion_type',e.target.value)}>
            <option value="">—</option>
            <option value="complete">{t('ticket.complete_product')}</option>
            <option value="parts">{t('ticket.parts_only')}</option>
          </select>
        </div>
      </div>

      <div
        className={`border-t border-gray-200 dark:border-gray-700 pt-2 rounded-b transition-colors ${isDragging ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setIsDragging(false) }}
        onDrop={handleDrop}
      >
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{t('ticket.photos')}</div>
        {(line.photos||[]).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {(line.photos||[]).map((p, pi) => (
              <div key={pi} className="relative group" style={{ cursor: p.isVideo ? 'default' : 'pointer' }} onClick={() => { if (!p.isVideo) setAnnotating(pi) }}>
                {p.isVideo ? (
                  <div className="w-16 h-16 rounded border border-gray-200 dark:border-gray-700 bg-black flex items-center justify-center overflow-hidden relative">
                    <video src={p.preview} className="w-full h-full object-cover" muted playsInline />
                    <i className="ti ti-player-play-filled text-white absolute" style={{ fontSize:18, filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }} aria-hidden="true" />
                  </div>
                ) : (
                  <>
                    <img src={p.dataUrl || p.preview} alt="" className="w-16 h-16 object-cover rounded border border-gray-200 dark:border-gray-700" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded transition-all flex items-center justify-center">
                      <i className="ti ti-pencil text-white opacity-0 group-hover:opacity-100 text-sm" aria-hidden="true" />
                    </div>
                  </>
                )}
                <button onClick={e => { e.stopPropagation(); onChange(idx,'_removePhoto',pi) }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ fontSize:8 }}>✕</button>
                {p.annotated && (
                  <div className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-white text-center rounded-b" style={{ fontSize:8, padding:'1px 0' }}>{t('ticket.annotated')}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="btn-ghost text-xs py-1 px-2 cursor-pointer inline-flex items-center gap-1">
            <i className="ti ti-upload text-xs" aria-hidden="true" /> {t('ticket.add_media')}
            <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif,video/*" multiple className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
          </label>
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
            <i className="ti ti-drag-drop text-xs" aria-hidden="true" /> {t('ticket.or_drag_drop')}
          </span>
        </div>
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
  const { user }    = useAuthStore()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    issue_reception_date: new Date().toISOString().slice(0,10),
    brand:'', project_name:'',
    delivery_date:'', wish_delivery_date:'', installer_needed:'', urgency:'', comment:'',
  })

  const emptyLine = () => ({
    quality_issue:'', description:'', line_item:'',
    foliot_id:'', ref_so:'', plant:'', affected_qty:'', total_qty:'', completion_type:'', photos:[],
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

  // Marques depuis le référentiel (fallback sur la liste codée en dur si vide)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data } = await supabase.from('brands').select('name').eq('active',true).order('name')
      return data || []
    },
  })
  const brandOptions = brands?.length ? brands.map(b => b.name) : BRANDS

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const dateYYYYMM = form.issue_reception_date?.slice(0,7)

      // 1. Create ticket
      const { data: occ, error: occErr } = await supabase.from('tickets').insert({
        issue_reception_date: form.issue_reception_date,
        date_yyyy_mm:  dateYYYYMM,
        fiscal_year:   getFiscalYear(dateYYYYMM),
        fiscal_month:  getFiscalMonth(dateYYYYMM),
        brand:            form.brand         || null,
        project_name:     form.project_name  || null,
        created_by:       user?.id           || null,
        delivery_date:    form.delivery_date || null,
        wish_delivery_date: form.wish_delivery_date || null,
        installer_needed: form.installer_needed === '' ? null : form.installer_needed === 'yes',
        urgency:          form.urgency       || null,
        comment:          form.comment       || null,
        status:        'service_desk',
        quality_issue: lines[0]?.quality_issue || null,
        plant:         lines[0]?.plant         || null,
        affected_qty:  lines[0]?.affected_qty  ? Number(lines[0].affected_qty) : null,
        total_qty:     lines[0]?.total_qty     ? Number(lines[0].total_qty)    : null,
      }).select().single()
      if (occErr) throw occErr

      // 2. Create lines
      const { data: createdLines, error: linesErr } = await supabase
        .from('occurrence_lines')
        .insert(lines.map((l,i) => ({
          occurrence_id: occ.id,
          quality_issue: l.quality_issue || null,
          description:   l.description   || null,
          line_item:     l.line_item     || null,
          foliot_id:     l.foliot_id     || null,
          ref_so:        l.ref_so        || null,
          plant:         l.plant         || null,
          affected_qty:  l.affected_qty  ? Number(l.affected_qty) : null,
          total_qty:     l.total_qty     ? Number(l.total_qty)    : null,
          completion_type: l.completion_type || null,
          sort_order:    i,
        })))
        .select()
      if (linesErr) throw linesErr

      // 3. Upload photos
      let failedPhotos = 0
      for (let li = 0; li < lines.length; li++) {
        const linePhotos = lines[li].photos || []
        if (linePhotos.length === 0) continue
        const lineId = createdLines?.[li]?.id || null
        for (const photo of linePhotos) {
          try {
            let blob
            if (photo.annotated && photo.dataUrl) {
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
            if (upErr) { console.warn('Photo upload failed:', upErr.message); failedPhotos++; continue }
            const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
            await supabase.from('ticket_photos').insert({
              ticket_id: occ.id, url: urlData.publicUrl, name: photo.name || 'photo.jpg', path, line_id: lineId, media_type: photo.mediaType || 'image',
            })
          } catch (photoErr) {
            console.warn('Photo error (non-fatal):', photoErr)
            failedPhotos++
          }
        }
      }

      queryClient.invalidateQueries(['tickets'])
      toast.success(t('ticket.created_sd_toast'))
      if (failedPhotos > 0) {
        toast(t('ticket.photos_upload_failed', { count: failedPhotos }), { icon: '⚠️', duration: 6000 })
      }
      onClose()
    } catch (e) {
      console.error('CREATE ERROR:', e)
      toast.error(e.message || t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit   = form.issue_reception_date && lines.some(l => l.quality_issue)
  const totalPhotos = lines.reduce((s,l) => s + (l.photos?.length||0), 0)

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
              <div>
                <label className="label">{t('ticket.project_name')}</label>
                <input className="input" value={form.project_name} onChange={e => setField('project_name',e.target.value)} placeholder={t('ticket.project_name')} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('ticket.reception_date')} *</label><input type="date" className="input" value={form.issue_reception_date} onChange={e => setField('issue_reception_date',e.target.value)} /></div>
                <div><label className="label">{t('ticket.delivery_date')}</label><input type="date" className="input" value={form.delivery_date} onChange={e => setField('delivery_date',e.target.value)} /></div>
                <div><label className="label">{t('ticket.wish_delivery_date')}</label><input type="date" className="input" value={form.wish_delivery_date} onChange={e => setField('wish_delivery_date',e.target.value)} /></div>
                <div><label className="label">{t('ticket.brand')}</label><select className="input" value={form.brand} onChange={e => setField('brand',e.target.value)}><option value="">—</option>{form.brand && !brandOptions.includes(form.brand) && <option value={form.brand}>{form.brand}</option>}{brandOptions.map(b => <option key={b}>{b}</option>)}</select></div>
                <div><label className="label">{t('ticket.installer_needed')}</label><select className="input" value={form.installer_needed} onChange={e => setField('installer_needed',e.target.value)}><option value="">—</option><option value="yes">{t('common.yes')}</option><option value="no">{t('common.no')}</option></select></div>
                <div><label className="label">{t('ticket.urgency')}</label><select className="input" value={form.urgency} onChange={e => setField('urgency',e.target.value)}><option value="">—</option>{URGENCIES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></div>
              </div>
              <div>
                <label className="label">{t('ticket.comment')}</label>
                <textarea className="input" rows={2} value={form.comment} onChange={e => setField('comment',e.target.value)} placeholder={t('ticket.comment_placeholder')} />
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
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{t('ticket.general_info')}</div>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    [t('ticket.project_name'),   form.project_name],
                    [t('ticket.reception_date'), form.issue_reception_date],
                    [t('ticket.delivery_date'),  form.delivery_date],
                    [t('ticket.wish_delivery_date'), form.wish_delivery_date],
                    [t('ticket.brand'),          form.brand],
                    [t('ticket.installer_needed'), form.installer_needed ? (form.installer_needed === 'yes' ? t('common.yes') : t('common.no')) : ''],
                    [t('ticket.urgency'),        URGENCIES.find(u => u.value === form.urgency)?.label],
                    [t('ticket.comment'),        form.comment],
                  ].filter(([,v])=>v).map(([l,v]) => (
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
                      <div className="text-gray-400">{[l.plant,l.line_item,l.completion_type?(l.completion_type==='complete'?t('ticket.complete_product'):t('ticket.parts_only')):'',l.affected_qty?`Qté: ${l.affected_qty}${l.total_qty?` / ${l.total_qty}`:''}`:''].filter(Boolean).join(' · ')}</div>
                    </div>
                    {(l.photos?.length||0) > 0 && <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded text-xs">{l.photos.length} photo{l.photos.length>1?'s':''}</span>}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                <i className="ti ti-send text-sm" aria-hidden="true" />
                {t('ticket.submit_to_sd')} — {t('ticket.will_move_to_sd')}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-800">
          <button onClick={step===1 ? onClose : () => setStep(1)} className="btn-ghost text-xs" disabled={submitting}>
            {step===1 ? t('common.cancel') : <><i className="ti ti-arrow-left text-xs" aria-hidden="true" /> {t('common.previous')}</>}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{t('common.step')} {step}/2</span>
            {step===1 ? (
              <button onClick={() => setStep(2)} disabled={!canSubmit} className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                {t('common.next')} <i className="ti ti-arrow-right text-xs" aria-hidden="true" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed">
                {submitting ? <Spinner size="sm" /> : <><i className="ti ti-send text-xs" aria-hidden="true" /> {t('ticket.submit_to_sd')}</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
