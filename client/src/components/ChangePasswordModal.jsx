import { useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

export default function ChangePasswordModal() {
  const { user } = useAuthStore()
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState(null)

  if (!user?.must_change_password) return null

  const handleSubmit = async () => {
    setError(null)
    if (form.password.length < 8) {
      setError('Mot de passe minimum 8 caracteres')
      return
    }
    if (form.password !== form.confirm) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    setSaving(true)
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: form.password })
      if (authError) throw authError

      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ must_change_password: false, updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (profileError) throw profileError

      useAuthStore.setState(s => ({ user: { ...s.user, must_change_password: false } }))
      toast.success('Mot de passe mis a jour !')
    } catch (err) {
      setError(err.message || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    width: '100%', fontSize: 13, padding: '9px 12px',
    border: '1px solid #d1d5db', borderRadius: 8,
    background: '#fff', color: '#111827',
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:16 }}>
      <div style={{ background:'#fff', borderRadius:14, border:'1px solid #e5e7eb', width:'100%', maxWidth:420, boxShadow:'0 32px 64px rgba(0,0,0,0.25)', overflow:'hidden' }}>
        <div style={{ background:'#1e40af', padding:'20px 24px' }}>
          <div style={{ fontSize:18, fontWeight:600, color:'#fff', marginBottom:4 }}>
            🔐 {user?.language === 'en' ? 'Change your password' : 'Modifier votre mot de passe'}
          </div>
          <div style={{ fontSize:13, color:'#bfdbfe' }}>
            {user?.language === 'en'
              ? 'You must set a new password before continuing.'
              : 'Vous devez definir un nouveau mot de passe avant de continuer.'}
          </div>
        </div>

        <div style={{ padding:'20px 24px' }}>
          {error && (
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 12px', marginBottom:14, fontSize:12, color:'#991b1b', display:'flex', gap:8 }}>
              <span>⚠️</span><span>{error}</span>
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:6, fontWeight:500 }}>
              {user?.language === 'en' ? 'New password' : 'Nouveau mot de passe'}
            </label>
            <div style={{ position:'relative' }}>
              <input style={{ ...inp, paddingRight:40 }}
                type={showPwd ? 'text' : 'password'}
                placeholder={user?.language === 'en' ? 'Minimum 8 characters' : 'Minimum 8 caracteres'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <button onClick={() => setShowPwd(s => !s)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:16, color:'#9ca3af' }}>
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
            {form.password && (
              <div style={{ marginTop:6, display:'flex', gap:4 }}>
                {[1,2,3,4].map(i => (
                  <div key={i} style={{ flex:1, height:3, borderRadius:2, background: form.password.length >= i*3 ? (form.password.length >= 10 ? '#16a34a' : form.password.length >= 7 ? '#d97706' : '#ef4444') : '#e5e7eb' }} />
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:12, color:'#6b7280', display:'block', marginBottom:6, fontWeight:500 }}>
              {user?.language === 'en' ? 'Confirm password' : 'Confirmer le mot de passe'}
            </label>
            <input style={{ ...inp, borderColor: form.confirm && form.confirm !== form.password ? '#fca5a5' : '#d1d5db' }}
              type={showPwd ? 'text' : 'password'}
              placeholder={user?.language === 'en' ? 'Repeat password' : 'Repeter le mot de passe'}
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} />
            {form.confirm && form.confirm !== form.password && (
              <div style={{ fontSize:11, color:'#ef4444', marginTop:4 }}>
                {user?.language === 'en' ? 'Passwords do not match' : 'Les mots de passe ne correspondent pas'}
              </div>
            )}
          </div>

          <button onClick={handleSubmit} disabled={saving || !form.password || !form.confirm}
            style={{ width:'100%', padding:'11px', borderRadius:8, fontSize:14, fontWeight:600, background: saving || !form.password || !form.confirm ? '#9ca3af' : '#1e40af', color:'#fff', border:'none', cursor: saving ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {saving ? (user?.language === 'en' ? 'Saving...' : 'Enregistrement...') : (user?.language === 'en' ? 'Set new password' : 'Definir nouveau mot de passe')}
          </button>
        </div>
      </div>
    </div>
  )
}
