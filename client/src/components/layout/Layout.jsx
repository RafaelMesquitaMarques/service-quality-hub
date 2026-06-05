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
    { to: '/tickets', icon: 'ti-clipboard-list', label: t('nav.tickets') },
    ...(canMeetings ? [{ to: '/meetings', icon: 'ti-calendar-event', label: t('nav.weekly_review') }] : []),
  ]

  const bottomItems = [
    ...(canImportExcel    ? [{ to: '/import',  icon: 'ti-file-import',       label: t('nav.import') }] : []),
    ...(canManagePlants   ? [{ to: '/plants',  icon: 'ti-building-factory',  label: 'Usines' }]        : []),
    ...(canAdmin          ? [{ to: '/admin',   icon: 'ti-users',             label: t('nav.admin') }]  : []),
  ]

  const navBg = dark ? '#0D1117' : '#1A3A5C'

  return (
    <>
      <style>{`
        @media (max-width: 767px) {
          .desktop-sidebar { display: none !important; }
          .desktop-main { overflow-y: auto !important; padding-bottom: 80px; }
          .mobile-topbar { display: flex !important; }
          .mobile-bottomnav { display: flex !important; }
          .desktop-layout { height: auto !important; min-height: 100vh; }
        }
        @media (min-width: 768px) {
          .mobile-topbar { display: none !important; }
          .mobile-bottomnav { display: none !important; }
          .desktop-layout { height: 100vh; overflow: hidden; }
          .desktop-main { overflow: hidden !important; }
        }
      `}</style>

      <div className="flex desktop-layout">
        <nav className="desktop-sidebar w-52 flex-shrink-0 flex flex-col transition-colors" style={{ background: navBg }}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-center">
            <img
              src="https://kbunsdmpesivntujvuzi.supabase.co/storage/v1/object/public/ticket-photos/tickets/ChatGPT%20Image%2031%20mai%202026,%2020_46_28.png"
              alt="Quality Hub"
              style={{ height: 36, width: 'auto', mixBlendMode: 'lighten' }}
            />
          </div>

          <div className="flex-1 py-2">
            {navItems.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 ${
                    isActive ? 'text-white bg-white/10 border-amber-400' : 'text-white/60 border-transparent hover:text-white hover:bg-white/5'
                  }`}>
                <i className={`ti ${item.icon} text-base`} />
                {item.label}
              </NavLink>
            ))}

            <button
              onClick={() => window.open('https://rafaelmesquitamarques.github.io/supplierq/', '_blank', 'noopener,noreferrer')}
              className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 text-white/60 border-transparent hover:text-white hover:bg-white/5 w-full text-left"
              style={{ background: 'none', border: 'none', borderLeft: '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <i className="ti ti-external-link text-base" />
              SupplierQ
            </button>

            <MobileQRButton />

            {bottomItems.length > 0 && (
              <>
                <div className="px-4 pt-4 pb-1 text-white/30 text-xs uppercase tracking-widest">Management</div>
                {bottomItems.map(item => (
                  <NavLink key={item.to} to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 ${
                        isActive ? 'text-white bg-white/10 border-amber-400' : 'text-white/60 border-transparent hover:text-white hover:bg-white/5'
                      }`}>
                    <i className={`ti ${item.icon} text-base`} />
                    {item.label}
                  </NavLink>
                ))}
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                {user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-medium truncate">{user?.full_name}</div>
                <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_COLORS[user?.role] || 'bg-gray-100'}`}>
                  {user?.role ? t(`roles.${user.role}`) : ''}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <button onClick={toggleLang} className="flex-1 text-xs text-white/50 hover:text-white transition-colors text-left">
                {i18n.language === 'fr' ? 'EN →' : 'FR →'}
              </button>
              <button onClick={toggle} className="text-xs text-white/50 hover:text-white px-2 py-1 border border-white/20 rounded">
                <i className={`ti ${dark ? 'ti-sun' : 'ti-moon'} text-sm`} />
              </button>
              <button onClick={handleLogout} className="text-xs text-white/50 hover:text-white px-2 py-1 border border-white/20 rounded">
                Logout
              </button>
            </div>
          </div>
        </nav>

        <div className="flex-1 flex flex-col desktop-main bg-gray-50 dark:bg-[#0D1117] transition-colors" style={{ minWidth: 0 }}>
          <div className="mobile-topbar items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0" style={{ background: navBg }}>
            <img
              src="https://kbunsdmpesivntujvuzi.supabase.co/storage/v1/object/public/ticket-photos/tickets/ChatGPT%20Image%2031%20mai%202026,%2020_46_28.png"
              alt="Quality Hub"
              style={{ height: 26, mixBlendMode: 'lighten' }}
            />
            <div className="flex items-center gap-2">
              <button onClick={toggleLang} className="text-xs text-white/70 px-2 py-1">
                {i18n.language === 'fr' ? 'EN' : 'FR'}
              </button>
              <button onClick={toggle} className="text-white/70 px-2 py-1">
                <i className={`ti ${dark ? 'ti-sun' : 'ti-moon'} text-sm`} />
              </button>
              <button onClick={handleLogout} className="text-white/70 px-2 py-1">
                <i className="ti ti-logout text-sm" />
              </button>
            </div>
          </div>

          <Outlet />
        </div>
      </div>

      <div className="mobile-bottomnav fixed bottom-0 left-0 right-0 bg-white dark:bg-[#161B22] border-t border-gray-200 dark:border-gray-700 items-center justify-around px-2 py-2 z-50">
        <NavLink to="/" end className={({ isActive }) => `flex flex-col items-center gap-0.5 px-4 py-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
          <i className="ti ti-chart-bar text-xl" />
          <span className="text-xs">{t('nav.dashboard')}</span>
        </NavLink>

        <button
          onClick={() => window.open(MOBILE_URL, '_blank', 'noopener,noreferrer')}
          className="flex flex-col items-center justify-center w-14 h-14 rounded-full text-white shadow-lg -mt-5"
          style={{ background: '#1A3A5C', border: 'none', cursor: 'pointer' }}
        >
          <i className="ti ti-device-mobile text-2xl" />
        </button>

        <NavLink to="/tickets" className={({ isActive }) => `flex flex-col items-center gap-0.5 px-4 py-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
          <i className="ti ti-clipboard-list text-xl" />
          <span className="text-xs">{t('nav.tickets')}</span>
        </NavLink>
      </div>

      <ChangePasswordModal />
    </>
  )
}
