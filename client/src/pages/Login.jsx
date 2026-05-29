import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, isLoading } = useAuthStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const result = await login(email, password)
    if (result.success) navigate('/')
    else setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4" style={{ background: '#1A3A5C' }}>
            <i className="ti ti-clipboard-check text-xl text-white" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Service Quality Hub</h1>
          <p className="text-sm text-gray-400 mt-1">Foliot Furniture</p>
        </div>

        {/* Form */}
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">{t('auth.email')}</label>
              <input
                type="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                className="input" placeholder="vous@foliot.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">{t('auth.password')}</label>
              <input
                type="password" required
                value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}
            <button
              type="submit" disabled={isLoading}
              className="btn-primary w-full justify-center py-2.5"
            >
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
