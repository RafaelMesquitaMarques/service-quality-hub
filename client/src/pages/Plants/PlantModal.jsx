import { useState } from 'react'
import { supabase } from '../../services/supabase'
import toast from 'react-hot-toast'

const COUNTRIES = ['Vietnam','China','Canada','USA','France','Other']

export default function PlantModal({ plant, onClose }) {
  const isEdit = !!plant
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:          plant?.name          || '',
    country:       plant?.country       || '',
    city:          plant?.city          || '',
    contact_email: plant?.contact_email || '',
    contact_phone: plant?.contact_phone || '',
    notes:         plant?.notes         || '',
    active:        plant?.active !== undefined ? plant.active : true,
  })

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name || !form.country) {
      toast.error('Nom et pays sont obligatoires')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const { error } = await supabase
          .from('plants')
          .update({ ...form, updated_at: new Date().toISOString() })
          .eq('id', plant.id)
        if (error) throw error
        toast.success('Usine mise a jour')
      } else {
        const { error } = await supabase
          .from('plants')
          .insert({ ...form })
        if (error) throw error
        toast.success('Usine creee')
      }
      onClose()
    } catch (err) {
      toast.error(err.message || 'Erreur')
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'32px 16px', zIndex:1000, overflowY:'auto' }}>
      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', width:'100%', maxWidth:460, boxShadow:'0 24px 48px rgba(0,0,0,0.18)', position:'relative' }}>

        <div style={{ padding:'16px 44px 12px 20px', borderBottom:'1px solid #e5e7eb' }}>
          <div style={{ fontSize:15, fontWeight:500, color:'#111827' }}>
            {isEdit ? 'Modifier usine' : 'Nouvelle usine'}
          </div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            Remplir les informations de l'usine
          </div>
          <button onClick={onClose} style={{ position:'absolute', top:14, right:16, background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18, lineHeight:1 }}>X</button>
        </div>

        <div style={{ padding:'16px 20px' }}>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Nom *</label>
            <input style={inp} placeholder="Ex: Vietnam Plant" value={form.name} onChange={e => sf('name', e.target.value)} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Pays *</label>
              <select style={inp} value={form.country} onChange={e => sf('country', e.target.value)}>
                <option value="">Selectionner...</option>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Ville</label>
              <input style={inp} placeholder="Ex: Ho Chi Minh" value={form.city} onChange={e => sf('city', e.target.value)} />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Email de contact</label>
              <input style={inp} type="email" placeholder="contact@foliot.com" value={form.contact_email} onChange={e => sf('contact_email', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Telephone</label>
              <input style={inp} placeholder="+84 000 000 000" value={form.contact_phone} onChange={e => sf('contact_phone', e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Notes</label>
            <textarea style={{ ...inp, resize:'vertical', height:64 }} placeholder="Additional information..." value={form.notes} onChange={e => sf('notes', e.target.value)} />
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'#f9fafb', borderRadius:8, border:'1px solid #e5e7eb' }}>
            <input type="checkbox" id="active" checked={form.active} onChange={e => sf('active', e.target.checked)} style={{ width:14, height:14, cursor:'pointer' }} />
            <label htmlFor="active" style={{ fontSize:13, color:'#374151', cursor:'pointer' }}>Usine active</label>
          </div>
        </div>

        <div style={{ padding:'12px 20px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <button onClick={onClose} style={{ padding:'8px 14px', borderRadius:7, fontSize:13, cursor:'pointer', background:'none', border:'none', color:'#6b7280' }}>
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding:'8px 18px', borderRadius:7, fontSize:13, cursor:'pointer', background:'#2563eb', color:'#fff', border:'none', fontWeight:500, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
