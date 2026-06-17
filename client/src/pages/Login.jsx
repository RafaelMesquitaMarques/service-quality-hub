import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../store/authStore'
import Logo from '../components/Logo'

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')

const handleSubmit = async (e) => {
  e.preventDefault()
  setError('')
  const result = await login(email, password)
  if (result.success) {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
if (isMobile) {
  setTimeout(() => { window.location.href = '/mobile' }, 500)
} else {
      navigate('/')
    }
  } else {
    setError(result.error)
  }
}
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0D1117] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo withTagline className="text-gray-900 dark:text-white" style={{ height: 64, margin: '0 auto 12px', display: 'block' }} />
          <p className="text-sm text-gray-400 mt-1">Foliot Furniture</p>
        </div>
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">{t('auth.email')}</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="input" placeholder="vous@foliot.com" autoComplete="email" />
            </div>
            <div>
              <label className="label">{t('auth.password')}</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="••••••••" autoComplete="current-password" />
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
            <button type="submit" disabled={isLoading} className="btn-primary w-full justify-center py-2.5">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connexion...
                </span>
              ) : t('auth.login_btn')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
