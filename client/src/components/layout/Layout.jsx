import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { usePermissions } from '../../hooks/usePermissions'
import ChangePasswordModal from '../ChangePasswordModal'
import i18n from '../../i18n'

const ROLE_COLORS = {
  admin:        'bg-purple-100 text-purple-800',
  manager:      'bg-blue-100 text-blue-800',
  cpm:          'bg-green-100 text-green-800',
  service_desk: 'bg-amber-100 text-amber-800',
  viewer:       'bg-gray-100 text-gray-600',
}

const MOBILE_URL = 'https://service-quality-hub.vercel.app/mobile/login'

function MobileQRButton() {
  const [showQR, setShowQR] = useState(false)
  const openMobile = () => window.open(MOBILE_URL, '_blank', 'noopener,noreferrer')

  return (
    <div style={{ position: 'relative' }}>
      <div className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 text-white/60 border-transparent hover:text-white hover:bg-white/5">
        <button
          onClick={openMobile}
          className="flex items-center gap-2.5 flex-1 text-white/60 hover:text-white"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit' }}
        >
          <i className="ti ti-device-mobile text-base" />
          Version mobile
        </button>
        <button
          onClick={() => setShowQR(v => !v)}
          title="Afficher le QR code"
          className="text-white/40 hover:text-white transition-colors"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
        >
          <i className="ti ti-qrcode text-sm" />
        </button>
      </div>

      {showQR && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowQR(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 20, padding: 32,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              boxShadow: '0 8px 40px rgba(0,0,0,0.25)', maxWidth: 300, width: '90%',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
              📱 Version mobile
            </div>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(MOBILE_URL)}&color=185FA5`}
              alt="QR Code"
              width={200}
              height={200}
              style={{ borderRadius: 8 }}
            />
            <div style={{ fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 1.5 }}>
              Scannez avec votre téléphone pour accéder à l'interface mobile
            </div>
            <button
              onClick={openMobile}
              style={{
                fontSize: 11, color: '#185FA5', textDecoration: 'none',
                background: '#E6F1FB', borderRadius: 8, padding: '6px 12px',
                wordBreak: 'break-all', textAlign: 'center', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {MOBILE_URL}
            </button>
            <button
              onClick={() => setShowQR(false)}
              style={{
                background: '#F3F4F6', border: 'none', borderRadius: 10,
                padding: '10px 24px', fontSize: 14, fontWeight: 600,
                color: '#374151', cursor: 'pointer', width: '100%',
              }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { t } = useTranslation()
  const { user, logout, setLanguage } = useAuthStore()
  const { dark, toggle } = useThemeStore()
  const navigate = useNavigate()
  const {
    canViewDashboard,
    canMeetings,
    canImportExcel,
    canAdmin,
    canManagePlants,
  } = usePermissions()

  const handleLogout = async () => { await logout(); window.location.href = '/login' }
  const toggleLang = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(next)
    setLanguage(next)
  }

  const navItems = [
    ...(canViewDashboard ? [{ to: '/', icon: 'ti-chart-bar', label: t('nav.dashboard'), end: true }] : []),
    { to: '/tickets', icon
