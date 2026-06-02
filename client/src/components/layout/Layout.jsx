import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import ChangePasswordModal from '../ChangePasswordModal'
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
            <button
              onClick={toggle}
              title={dark ? 'Light mode' : 'Dark mode'}
              className="text-xs text-white/50 hover:text-white transition-colors px-2 py-1 border border-white/20 rounded"
            >
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

      {/* Modal de mudança de senha obrigatória — aparece automaticamente */}
      <ChangePasswordModal />
    </div>
  )
}
