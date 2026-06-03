import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import ChangePasswordModal from '../ChangePasswordModal'
import MobileNewOccurrence from '../../pages/Tickets/MobileTicketForm'
import i18n from '../../i18n'

const ROLE_COLORS = {
  admin:        'bg-purple-100 text-purple-800',
  manager:      'bg-blue-100 text-blue-800',
  cpm:          'bg-green-100 text-green-800',
  service_desk: 'bg-amber-100 text-amber-800',
  viewer:       'bg-gray-100 text-gray-600',
}

export default function Layout() {
  const { t } = useTranslation()
  const { user, logout, setLanguage } = useAuthStore()
  const { dark, toggle } = useThemeStore()
  const navigate = useNavigate()
  const [isMobile, setIsMobile] = useState(false)
  const [showMobileForm, setShowMobileForm] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const handleLogout = async () => { await logout(); window.location.href = '/login' }
  const toggleLang = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr'
    i18n.changeLanguage(next)
    setLanguage(next)
  }

  const navItems = [
    { to: '/',         icon: 'ti-chart-bar',     label: t('nav.dashboard'), end: true },
    { to: '/tickets',  icon: 'ti-clipboard-list', label: t('nav.tickets') },
    { to: '/meetings', icon: 'ti-calendar-event', label: t('nav.weekly_review') },
  ]
  const bottomItems = [
    ...((['admin', 'manager'].includes(user?.role))
      ? [{ to: '/import', icon: 'ti-file-import', label: t('nav.import') }] : []),
    ...(user?.role === 'admin'
      ? [
          { to: '/plants', icon: 'ti-building-factory', label: 'Usines' },
          { to: '/admin',  icon: 'ti-users',            label: t('nav.admin') },
        ] : []),
  ]

  const navBg = dark ? '#0D1117' : '#1A3A5C'

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-[#0D1117]">
        {/* Top bar mobile */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700" style={{ background: navBg }}>
          <img
            src="https://kbunsdmpesivntujvuzi.supabase.co/storage/v1/object/public/ticket-photos/tickets/ChatGPT%20Image%2031%20mai%202026,%2020_46_28.png"
            alt="Quality Hub"
            style={{ height: 28, mixBlendMode: 'lighten' }}
          />
          <div className="flex items-center gap-2">
            <button onClick={toggleLang} className="text-xs text-white/60 hover:text-white px-2 py-1">
              {i18n.language === 'fr' ? 'EN' : 'FR'}
            </button>
            <button onClick={toggle} className="text-white/60 hover:text-white px-2 py-1">
              <i className={`ti ${dark ? 'ti-sun' : 'ti-moon'} text-sm`} />
            </button>
            <button onClick={handleLogout} className="text-white/60 hover:text-white px-2 py-1 text-xs">
              <i className="ti ti-logout text-sm" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto pb-20">
          <Outlet />
        </div>

        {/* Bottom navbar mobile */}
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#161B22] border-t border-gray-200 dark:border-gray-700 flex items-center justify-around px-2 py-2 z-50">
          <NavLink to="/" end className={({ isActive }) => `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
            <i className="ti ti-chart-bar text-xl" />
            <span className="text-xs">{t('nav.dashboard')}</span>
          </NavLink>
          
          {/* Botão central — Nova occurrence */}
          <button
            onClick={() => setShowMobileForm(true)}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-full text-white shadow-lg -mt-5"
            style={{ background: '#1A3A5C' }}
          >
            <i className="ti ti-plus text-2xl" />
          </button>

          <NavLink to="/tickets" className={({ isActive }) => `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
            <i className="ti ti-clipboard-list text-xl" />
            <span className="text-xs">{t('nav.tickets')}</span>
          </NavLink>
        </div>

        {/* Modal formulaire mobile */}
        {showMobileForm && (
          <MobileNewOccurrence
            onSubmitted={() => setShowMobileForm(false)}
            onClose={() => setShowMobileForm(false)}
            asModal
          />
        )}

        <ChangePasswordModal />
      </div>
    )
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden">
      <nav className="w-52 flex-shrink-0 flex flex-col transition-colors" style={{ background: navBg }}>
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-center">
          <img
            src="https://kbunsdmpesivntujvuzi.supabase.co/storage/v1/object/public/ticket-photos/tickets/ChatGPT%20Image%2031%20mai%202026,%2020_46_28.png"
            alt="Quality Hub"
            style={{ height: 36, width: 'auto', mixBlendMode: 'lighten' }}
          />
        </div>

        <div className="flex-1 py-2">
          {navItems.map(item => (
            <NavLink
              key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 ${
                  isActive
                    ? 'text-white bg-white/10 border-amber-400'
                    : 'text-white/60 border-transparent hover:text-white hover:bg-white/5'
                }`
              }
            >
              <i className={`ti ${item.icon} text-base`} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}

          {bottomItems.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1 text-white/30 text-xs uppercase tracking-widest">
                Management
              </div>
              {bottomItems.map(item => (
                <NavLink
                  key={item.to} to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-all border-l-2 ${
                      isActive
                        ? 'text-white bg-white/10 border-amber-400'
                        : 'text-white/60 border-transparent hover:text-white hover:bg-white/5'
                    }`
                  }
                >
                  <i className={`ti ${item.icon} text-base`} aria-hidden="true" />
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
            <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'}
              className="text-xs text-white/50 hover:text-white transition-colors px-2 py-1 border border-white/20 rounded">
              <i className={`ti ${dark ? 'ti-sun' : 'ti-moon'} text-sm`} aria-hidden="true" />
            </button>
            <button onClick={handleLogout} className="text-xs text-white/50 hover:text-white transition-colors px-2 py-1 border border-white/20 rounded">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-[#0D1117] transition-colors">
        <Outlet />
      </main>

      <ChangePasswordModal />
    </div>
  )
}
