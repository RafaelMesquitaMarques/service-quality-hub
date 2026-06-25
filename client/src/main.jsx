import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import i18n from './i18n'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary'
import { useAuthStore } from './store/authStore'
import { useThemeStore } from './store/themeStore'
import { usePermissions } from './hooks/usePermissions'
import Layout from './components/layout/Layout'
import LoginPage from './pages/Login'
import Dashboard from './pages/Dashboard'
import TicketsPage from './pages/Tickets'
import TicketDetail from './pages/Tickets/TicketDetail'
import MeetingsPage from './pages/Meetings'
import ImportPage from './pages/Import'
import AdminPage from './pages/Admin'
import PlantsPage from './pages/Plants'
import ReferentialsPage from './pages/Referentials'
import MobileLayout from './pages/Mobile/MobileLayout'
import MobileLogin from './pages/Mobile/MobileLogin'
import MobileNewOccurrence from './pages/Mobile/MobileNewOccurrence'

if (!window.fabric) {
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js'
  document.head.appendChild(s)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
    },
    mutations: { retry: 0 }
  }
})

function ProtectedRoute({ children, perm }) {
  const { user } = useAuthStore()
  const permissions = usePermissions()

  if (!user) return <Navigate to="/login" replace />
  if (perm && !permissions[perm]) return <Navigate to="/" replace />
  return children
}

function App() {
  const { init } = useAuthStore()
  const { init: initTheme } = useThemeStore()
  const userLanguage = useAuthStore(s => s.user?.language)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    initTheme()
    setReady(true)
    init()
  }, [])

  // Appliquer la langue enregistrée dans le profil (sinon tout le monde
  // démarre en français, ce qui pousse les anglophones à utiliser la
  // traduction auto du navigateur — qui fait planter l'app).
  React.useEffect(() => {
    if (userLanguage && userLanguage !== i18n.language) {
      i18n.changeLanguage(userLanguage)
    }
  }, [userLanguage])

  if (!ready) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#1B2A4A', color: '#fff', fontSize: 16,
      fontFamily: 'sans-serif'
    }}>
      Loading...
    </div>
  )

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/mobile/login" element={<MobileLogin />} />
          <Route path="/mobile" element={<MobileLayout />}>
            <Route index element={<Navigate to="/mobile/new" replace />} />
            <Route path="new" element={<MobileNewOccurrence />} />
          </Route>

          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/new" element={<Navigate to="/tickets" replace />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="meetings" element={
              <ProtectedRoute perm="canMeetings"><MeetingsPage /></ProtectedRoute>
            } />
            <Route path="import" element={
              <ProtectedRoute perm="canImportExcel"><ImportPage /></ProtectedRoute>
            } />
            <Route path="admin" element={
              <ProtectedRoute perm="canAdmin"><AdminPage /></ProtectedRoute>
            } />
            <Route path="plants" element={
              <ProtectedRoute perm="canManagePlants"><PlantsPage /></ProtectedRoute>
            } />
            <Route path="referentials" element={
              <ProtectedRoute perm="canAdmin"><ReferentialsPage /></ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
