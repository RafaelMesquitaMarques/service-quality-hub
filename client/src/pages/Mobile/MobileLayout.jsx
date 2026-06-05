import { useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export default function MobileLayout() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) navigate('/mobile/login', { replace: true })
  }, [user])

  if (!user) return null
  return <Outlet />
}
