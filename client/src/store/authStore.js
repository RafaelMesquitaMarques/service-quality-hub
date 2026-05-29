import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../services/supabase'

const fetchProfile = async (userId) => {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw error
          // Session is now active — safe to fetch profile
          const profile = await fetchProfile(data.user.id)
          set({
            user: { ...profile, email: data.user.email, id: data.user.id },
            session: data.session,
            isLoading: false
          })
          return { success: true }
        } catch (err) {
          set({ isLoading: false })
          return { success: false, error: err.message || 'Login failed' }
        }
      },

      logout: async () => {
        await supabase.auth.signOut()
        set({ user: null, session: null })
      },

      setLanguage: async (language) => {
        const { user } = get()
        if (!user) return
        await supabase.from('user_profiles').update({ language }).eq('id', user.id)
        set(s => ({ user: { ...s.user, language } }))
      },

      init: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const profile = await fetchProfile(session.user.id)
          if (profile) {
            set({
              user: { ...profile, email: session.user.email, id: session.user.id },
              session
            })
          }
        }
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_OUT') {
            set({ user: null, session: null })
          } else if (event === 'SIGNED_IN' && session) {
            const profile = await fetchProfile(session.user.id)
            if (profile) {
              set({
                user: { ...profile, email: session.user.email, id: session.user.id },
                session
              })
            }
          }
        })
      }
    }),
    {
      name: 'sqh-auth',
      partialize: (s) => ({ user: s.user })
    }
  )
)
