import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../services/api'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const { data } = await api.post('/auth/login', { email, password })
          set({ user: data.user, token: data.access_token, isLoading: false })
          api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
          return { success: true }
        } catch (err) {
          set({ isLoading: false })
          return { success: false, error: err.response?.data?.error || 'Login failed' }
        }
      },

      logout: async () => {
        try { await api.post('/auth/logout') } catch {}
        delete api.defaults.headers.common['Authorization']
        set({ user: null, token: null })
      },

      setLanguage: async (language) => {
        await api.patch('/auth/me/language', { language })
        set(s => ({ user: { ...s.user, language } }))
      },

      // Rehydrate auth header on app load
      init: () => {
        const { token } = get()
        if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      }
    }),
    {
      name: 'sqh-auth',
      partialize: (s) => ({ user: s.user, token: s.token })
    }
  )
)
