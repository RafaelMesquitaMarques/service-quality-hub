// src/pages/Tickets/MobileTicketForm.jsx
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'

const DEPARTMENTS = ['Client','Shipping','Supplier','Production','Logistics','Install','Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC','Project Mgnt','EOI','Vietnam','Planning']
const CATEGORIES  = ['Damage','Missing parts','Wrong item','Assembly issue','Finish defect','Packaging','Measurement','Other']
const BRANDS      = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']

export default function MobileTicketForm({ onSubmitted }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en'
  const fileRef = useRef(null)

  const [submitting, setSubmitting] = useState(false)
  const [photos, setPhotos] = useState([])
  const [form, setForm] = useState({
    issue_reception_date: new Date().toISOString().slice(0, 10),
    sc_number: '',
    brand: '',
    ship_to: '',
    department: '',
    categories: '',
    quality_issue: '',
    plant: '',
    affected_qty: '',
    cost_approx: '',
  })

  const { data: plants } = useQuery({
    queryKey: ['plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').eq('active', true).order('name')
      return data || []
    },
  })

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files)
    const newPhotos = files.map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
      name: f.name,
    }))
    setPhotos(p => [...p, ...newPhotos])
  }

  const removePhoto = (idx) => {
    setPhotos(p => p.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    if (submitting) return
    if (!form.quality_issue) {
      toast.error(lang === 'fr' ? 'Description obligatoire' : 'Description required')
      return
    }
    setSubmitting(true)
    try {
      const dateYYYYMM = form.issue_reception_date?.slice(0, 7)

      // 1. Créer le ticket
      const { data: occ, error: occErr } = await supabase.from('tickets').insert({
        issue_reception_date: form.issue_reception_date,
        date_yyyy_mm:  dateYYYYMM,
        fiscal_year:   getFiscalYear(dateYYYYMM),
        fiscal_month:  getFiscalMonth(dateYYYYMM),
        brand:         form.brand      || null,
        ship_to:       form.ship_to    || null,
        sc_number:     form.sc_number  || null,
        status:        'service_desk',
        quality_issue: form.quality_issue,
        department:    form.department || null,
        categories:    form.categories || null,
        cost_approx:   form.cost_approx ? Number(form.cost_approx) : null,
      }).select().single()
      if (occErr) throw occErr

      // 2. Créer une ligne
      const { data: line, error: lineErr } = await supabase.from('occurrence_lines').insert({
        occurrence_id: occ.id,
        quality_issue: form.quality_issue,
        department:    form.department || null,
        categories:    form.categories || null,
        plant:         form.plant      || null,
        affected_qty:  form.affected_qty ? Number(form.affected_qty) : null,
        cost_approx:   form.cost_approx  ? Number(form.cost_approx)  : null,
        sort_order:    0,
      }).select().single()
      if (lineErr) throw lineErr

      // 3. Upload photos
      for (const photo of photos) {
        try {
          // Determinar extensão — câmera iOS pode gerar 'image.jpg' ou sem extensão
          let ext = 'jpg'
          if (photo.file.type === 'image/png') ext = 'png'
          else if (photo.file.type === 'image/heic') ext = 'jpg' // converter HEIC para jpg
          else if (photo.file.type === 'image/jpeg') ext = 'jpg'
          else {
            const nameParts = photo.name.split('.')
            if (nameParts.length > 1) ext = nameParts.pop().replace(/[^a-z0-9]/gi, '') || 'jpg'
          }

          const path = `tickets/${occ.id}/${Date.now()}_${Math.random().toString(36).slice(2,5)}.${ext}`

          // Upload com contentType explícito
          const { error: upErr } = await supabase.storage
            .from('ticket-photos')
            .upload(path, photo.file, {
              contentType: photo.file.type || 'image/jpeg',
              upsert: false,
            })
          if (upErr) {
            console.warn('Photo upload failed:', upErr.message)
            continue // não bloqueia o submit
          }
          const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)
          await supabase.from('ticket_photos').insert({
            ticket_id: occ.id,
            url: urlData.publicUrl,
            name: photo.name || `photo.${ext}`,
            path,
            line_id: line.id,
          })
        } catch (e) {
          console.warn('Photo error (non-fatal):', e)
          // Não bloqueia — occurrence criada mesmo sem foto
        }
      }

      toast.success(lang === 'fr' ? 'Occurrence créée ✓' : 'Occurrence created ✓')
      onSubmitted?.()

      // Reset form
      setForm({
        issue_reception_date: new Date().toISOString().slice(0, 10),
        sc_number: '', brand: '', ship_to: '', department: '',
        categories: '', quality_issue: '', plant: '', affected_qty: '', cost_approx: '',
      })
      setPhotos([])
    } catch (e) {
      console.error(e)
      toast.error(e.message || 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <div className="bg-[#1A3A5C] px-4 py-4 flex items-center gap-3">
        <img
          src="https://kbunsdmpesivntujvuzi.supabase.co/storage/v1/object/public/ticket-photos/tickets/ChatGPT%20Image%2031%20mai%202026,%2020_46_28.png"
          alt="Quality Hub"
          style={{ height: 28, mixBlendMode: 'lighten' }}
        />
        <span className="text-white text-sm font-semibold">
          {lang === 'fr' ? 'Nouvelle occurrence' : 'New occurrence'}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Photos — en premier pour les installateurs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            📷 {lang === 'fr' ? 'Photos' : 'Photos'}
          </div>

          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.preview} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center border-0 cursor-pointer"
                    style={{ fontSize: 10 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {/* Caméra directe */}
            <label className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium cursor-pointer">
              <i className="ti ti-camera text-base" />
              {lang === 'fr' ? 'Prendre photo' : 'Take photo'}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={handlePhotos} />
            </label>
            {/* Galerie */}
            <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium cursor-pointer">
              <i className="ti ti-photo text-base" />
              {lang === 'fr' ? 'Galerie' : 'Gallery'}
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={handlePhotos} />
            </label>
          </div>
        </div>

        {/* Infos principales */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            📋 {lang === 'fr' ? 'Informations' : 'Information'}
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
              {lang === 'fr' ? 'Description du problème *' : 'Problem description *'}
            </label>
            <textarea
              value={form.quality_issue}
              onChange={e => sf('quality_issue', e.target.value)}
              placeholder={lang === 'fr' ? 'Décrivez le problème...' : 'Describe the problem...'}
              rows={3}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">SC#</label>
              <input
                value={form.sc_number}
                onChange={e => sf('sc_number', e.target.value)}
                placeholder="SC#..."
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                {lang === 'fr' ? 'Date' : 'Date'}
              </label>
              <input
                type="date"
                value={form.issue_reception_date}
                onChange={e => sf('issue_reception_date', e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
              {lang === 'fr' ? 'Marque' : 'Brand'}
            </label>
            <select value={form.brand} onChange={e => sf('brand', e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">—</option>
              {BRANDS.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
              {lang === 'fr' ? 'Destination (Ship To)' : 'Ship To'}
            </label>
            <input
              value={form.ship_to}
              onChange={e => sf('ship_to', e.target.value)}
              placeholder="Hotel / Client..."
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Détails */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm space-y-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            🔧 {lang === 'fr' ? 'Détails' : 'Details'}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                {lang === 'fr' ? 'Catégorie' : 'Category'}
              </label>
              <select value={form.categories} onChange={e => sf('categories', e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">—</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                {lang === 'fr' ? 'Département' : 'Department'}
              </label>
              <select value={form.department} onChange={e => sf('department', e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">—</option>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                {lang === 'fr' ? 'Usine' : 'Plant'}
              </label>
              <select value={form.plant} onChange={e => sf('plant', e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">—</option>
                {(plants || []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                {lang === 'fr' ? 'Qté affectée' : 'Affected qty'}
              </label>
              <input
                type="number"
                value={form.affected_qty}
                onChange={e => sf('affected_qty', e.target.value)}
                placeholder="0"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bouton submit fixe en bas */}
      <div className="fixed bottom-0 left-0 right-0 px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <button
          onClick={handleSubmit}
          disabled={submitting || !form.quality_issue}
          className="w-full py-4 rounded-xl text-white font-semibold text-base transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: submitting || !form.quality_issue ? '#9ca3af' : '#1A3A5C' }}
        >
          {submitting ? (
            <>
              <div style={{ width: 18, height: 18, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              {lang === 'fr' ? 'Envoi...' : 'Submitting...'}
            </>
          ) : (
            <>
              <i className="ti ti-send text-lg" />
              {lang === 'fr' ? 'Soumettre au Service Desk' : 'Submit to Service Desk'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
