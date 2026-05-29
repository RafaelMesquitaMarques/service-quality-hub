import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import './i18n'
import './index.css'

import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
import LoginPage from './pages/Login'
import Dashboard from './pages/Dashboard'
import TicketsPage from './pages/Tickets'
import TicketDetail from './pages/Tickets/TicketDetail'
import NewTicket from './pages/Tickets/NewTicket'
import MeetingsPage from './pages/Meetings'
import ImportPage from './pages/Import'
import AdminPage from './pages/Admin'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } }
})

function ProtectedRoute({ children, roles }) {
  const { user, token } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

function App() {
  const { init } = useAuthStore()
  React.useEffect(() => { init() }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/new" element={<NewTicket />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="import" element={
              <ProtectedRoute roles={['admin','manager']}>
                <ImportPage />
              </ProtectedRoute>
            } />
            <Route path="admin" element={
              <ProtectedRoute roles={['admin']}>
                <AdminPage />
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
