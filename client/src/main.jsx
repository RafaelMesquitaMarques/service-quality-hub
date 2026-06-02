import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import './i18n'
import './index.css'
import { useAuthStore } from './store/authStore'
import { useThemeStore } from './store/themeStore'
import Layout from './components/layout/Layout'
import LoginPage from './pages/Login'
import Dashboard from './pages/Dashboard'
import TicketsPage from './pages/Tickets'
import TicketDetail from './pages/Tickets/TicketDetail'
import NewTicket from './pages/Tickets/NewTicket'
import MeetingsPage from './pages/Meetings'
import ImportPage from './pages/Import'
import AdminPage from './pages/Admin'
import PlantsPage from './pages/Plants'
import MobileTicketForm from './pages/Tickets/MobileTicketForm'

// Preload Fabric.js for photo annotation
if (!window.fabric) {
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js'
  document.head.appendChild(s)
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } }
})

function ProtectedRoute({ children, roles }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

function App() {
  const { init } = useAuthStore()
  const { init: initTheme } = useThemeStore()
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    initTheme()
    init().finally(() => setReady(true))
  }, [])

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
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Rota mobile — sem Layout, sem sidebar */}
          <Route path="/mobile" element={
            <ProtectedRoute>
              <MobileTicketForm onSubmitted={() => {}} />
            </ProtectedRoute>
          } />

          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/new" element={<NewTicket />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="import" element={
              <ProtectedRoute roles={['admin', 'manager']}>
                <ImportPage />
              </ProtectedRoute>
            } />
            <Route path="admin" element={
              <ProtectedRoute roles={['admin']}>
                <AdminPage />
              </ProtectedRoute>
            } />
            <Route path="plants" element={
              <ProtectedRoute roles={['admin']}>
                <PlantsPage />
              </ProtectedRoute>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
