import { useState, useRef } from 'react'
import { adminApi } from '../../services/api'
import { supabase } from '../../services/supabase'
import toast from 'react-hot-toast'

const DEPARTMENTS = [
  'Client','Shipping','Supplier','Production','Logistics','Install',
  'Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC',
  'Project Mgnt','EOI','Vietnam','Planning',
]
const ROLES = [
  { value:'admin',        label:'Administrateur' },
  { value:'manager',      label:'Manager' },
  { value:'cpm',          label:'CPM' },
  { value:'service_desk', label:'Service Desk' },
  { value:'viewer',       label:'Utilisateur' },
]

export default function UserModal({ user, plants, onClose }) {
  const isEdit = !!user
  const fileRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('invite')
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url || null)
  const [avatarFile, setAvatarFile] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    first_name: user?.full_name?.split(' ')[0] || '',
    last_name:  user?.full_name?.split(' ').slice(1).join(' ') || '',
    email:      user?.email      || '',
    password:   '',
    role:       user?.role       || 'viewer',
    department: user?.department || '',
    plant_id:   user?.plant_id   || '',
    language:   user?.language   || 'fr',
  })

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleAvatarChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Photo max 2 MB'); return }
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const getInitials = () => {
    const f = form.first_name?.[0] || ''
    const l = form.last_name?.[0]  || ''
    return (f + l).toUpperCase() || '?'
  }

  const handleSubmit = async () => {
    setError(null)

    if (!form.first_name || !form.email || !form.role) {
      setError('Prenom, email et role sont obligatoires')
      return
    }
    if (mode === 'password' && !isEdit && form.password.length < 6) {
      setError('Mot de passe minimum 6 caracteres')
      return
    }

    setSaving(true)
    try {
      const full_name = (form.first_name + ' ' + form.last_name).trim()
      let avatar_url = user?.avatar_url || null

      if (avatarFile) {
        try {
          const { data: uploaded } = await adminApi.uploadAvatar(user?.id || 'new', avatarFile)
          avatar_url = uploaded?.url || null
        } catch (avatarErr) {
          console.warn('Avatar upload failed, continuing without avatar:', avatarErr)
        }
      }

      if (isEdit) {
        // ── Edit existing user ──────────────────────────────────────────
        await adminApi.updateUser(user.id, {
          full_name,
          role:       form.role,
          department: form.department || null,
          plant_id:   form.plant_id   || null,
          language:   form.language,
          avatar_url,
        })
        toast.success('Utilisateur mis a jour')
        onClose()

      } else if (mode === 'password') {
        // ── Create with password via Edge Function ──────────────────────
        const payload = {
          full_name,
          email:      form.email,
          password:   form.password,
          role:       form.role,
          department: form.department || null,
          plant_id:   form.plant_id   || null,
          language:   form.language,
          avatar_url,
          mode:       'password',
        }

        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

        const res = await fetch(supabaseUrl + '/functions/v1/invite-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            'apikey': anonKey,
          },
          body: JSON.stringify(payload),
        })

        let result
        try {
          result = await res.json()
        } catch {
          result = {}
        }

        if (!res.ok) {
          throw new Error(result?.error || `Erreur serveur (${res.status})`)
        }

        toast.success('Utilisateur cree avec succes')
        onClose()

      } else {
        // ── Invite by email ─────────────────────────────────────────────
        const payload = {
          full_name,
          email:      form.email,
          role:       form.role,
          department: form.department || null,
          plant_id:   form.plant_id   || null,
          language:   form.language,
          avatar_url,
          mode:       'invite',
        }
        await adminApi.inviteUser(payload)
        toast.success('Invitation envoyee avec succes')
        onClose()
      }

    } catch (err) {
      console.error('UserModal error:', err)
      const msg = err?.message || 'Erreur inconnue'
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    width:'100%', fontSize:13, padding:'7px 10px',
    border:'1px solid #d1d5db', borderRadius:7,
    background:'#fff', color:'#111827', outline:'none', boxSizing:'border-box',
  }

  const TITLE = isEdit ? 'Modifier utilisateur' : 'Ajouter un utilisateur'
  const BTN   = saving ? 'Envoi...' : isEdit ? 'Enregistrer' : mode === 'invite' ? 'Envoyer invitation' : 'Creer utilisateur'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'32px 16px', zIndex:1000, overflowY:'auto' }}>
      <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', width:'100%', maxWidth:480, boxShadow:'0 24px 48px rgba(0,0,0,0.18)', position:'relative' }}>

        {/* Header */}
        <div style={{ padding:'16px 44px 12px 20px', borderBottom:'1px solid #e5e7eb' }}>
          <div style={{ fontSize:15, fontWeight:500, color:'#111827' }}>{TITLE}</div>
          <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
            {isEdit ? 'Modifier les informations du compte' : 'Choisir le mode de creation'}
          </div>
          <button onClick={onClose} style={{ position:'absolute', top:14, right:16, background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        {/* Mode toggle — only for new users */}
        {!isEdit && (
          <div style={{ display:'flex', margin:'12px 20px 0', background:'#f3f4f6', borderRadius:8, padding:3, gap:3 }}>
            {[
              { id:'invite',   label:'Convite por email', icon:'✉' },
              { id:'password', label:'Criar com senha',   icon:'🔒' },
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                flex:1, padding:'7px 8px', borderRadius:6, border:'none', cursor:'pointer',
                fontSize:12, fontWeight:500,
                background: mode === m.id ? '#fff' : 'transparent',
                color: mode === m.id ? '#111827' : '#6b7280',
                boxShadow: mode === m.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display:'flex', alignItems:'center', justifyContent:'center', gap:5,
              }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ padding:'16px 20px' }}>

          {/* Error banner */}
          {error && (
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#991b1b', display:'flex', alignItems:'flex-start', gap:8 }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Avatar */}
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16, paddingBottom:16, borderBottom:'1px solid #f3f4f6' }}>
            <div onClick={() => fileRef.current?.click()} style={{ width:60, height:60, borderRadius:'50%', cursor:'pointer', overflow:'hidden', flexShrink:0, border:'1.5px dashed #93c5fd', display:'flex', alignItems:'center', justifyContent:'center', background: avatarPreview ? 'transparent' : '#eff6ff' }}>
              {avatarPreview ? (
                <img src={avatarPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              ) : (
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:20, color:'#3b82f6' }}>+</div>
                  <div style={{ fontSize:10, color:'#3b82f6', marginTop:2 }}>{getInitials()}</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display:'none' }} />
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:'#111827', marginBottom:3 }}>Photo de profil</div>
              <div style={{ fontSize:12, color:'#9ca3af' }}>JPG ou PNG · max 2 MB</div>
            </div>
          </div>

          {/* Prenom / Nom */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Prenom *</label>
              <input style={inp} placeholder="Marie" value={form.first_name} onChange={e => sf('first_name', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Nom *</label>
              <input style={inp} placeholder="Leblanc" value={form.last_name} onChange={e => sf('last_name', e.target.value)} />
            </div>
          </div>

          {/* Email */}
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Email *</label>
            <input style={{ ...inp, background: isEdit ? '#f9fafb' : '#fff' }} type="email"
              placeholder="marie.leblanc@foliot.com"
              value={form.email} onChange={e => sf('email', e.target.value)}
              disabled={isEdit} />
          </div>

          {/* Password */}
          {!isEdit && mode === 'password' && (
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Mot de passe *</label>
              <div style={{ position:'relative' }}>
                <input
                  style={{ ...inp, paddingRight:36 }}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Minimum 6 caracteres"
                  value={form.password}
                  onChange={e => sf('password', e.target.value)}
                />
                <button onClick={() => setShowPassword(s => !s)} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:14 }}>
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          )}

          {/* Role */}
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Role *</label>
            <select style={inp} value={form.role} onChange={e => sf('role', e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* Dept / Plant */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Departement</label>
              <select style={inp} value={form.department} onChange={e => sf('department', e.target.value)}>
                <option value="">Selectionner...</option>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Usine (Plant)</label>
              <select style={inp} value={form.plant_id} onChange={e => sf('plant_id', e.target.value)}>
                <option value="">Selectionner...</option>
                {plants.length > 0
                  ? plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                  : ['Vietnam','China','Canada','USA'].map(p => <option key={p} value={p}>{p}</option>)
                }
              </select>
            </div>
          </div>

          {/* Langue */}
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:4 }}>Langue</label>
            <select style={inp} value={form.language} onChange={e => sf('language', e.target.value)}>
              <option value="fr">Francais</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Info box */}
          {!isEdit && (
            <div style={{ background: mode === 'invite' ? '#f0fdf4' : '#eff6ff', border: '1px solid ' + (mode === 'invite' ? '#bbf7d0' : '#bfdbfe'), borderRadius:8, padding:'10px 12px', display:'flex', alignItems:'flex-start', gap:8 }}>
              <span style={{ fontSize:15, flexShrink:0 }}>{mode === 'invite' ? '✉' : '🔒'}</span>
              <div style={{ fontSize:12, color: mode === 'invite' ? '#166534' : '#1e40af', lineHeight:1.6 }}>
                {mode === 'invite'
                  ? 'Um email sera envoye avec un lien para definir o mot de passe. O link expira apres 24h.'
                  : 'O utilizador sera criado imediatamente e pode fazer login com a senha definida.'
                }
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <button onClick={onClose} style={{ padding:'8px 14px', borderRadius:7, fontSize:13, cursor:'pointer', background:'none', border:'none', color:'#6b7280' }}>
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding:'8px 18px', borderRadius:7, fontSize:13, cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#9ca3af' : (mode === 'invite' ? '#2563eb' : '#059669'), color:'#fff', border:'none', display:'inline-flex', alignItems:'center', gap:6, fontWeight:500 }}>
            {saving && <span style={{ display:'inline-block', width:12, height:12, border:'2px solid #fff', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />}
            {BTN}
          </button>
        </div>
      </div>
    </div>
  )
}
