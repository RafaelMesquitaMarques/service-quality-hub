import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../services/supabase'

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

          // Fetch user profile
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', data.user.id)
            .single()

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
        await supabase
          .from('user_profiles')
          .update({ language })
          .eq('id', user.id)
        set(s => ({ user: { ...s.user, language } }))
      },

      // Rehydrate session on app load
      init: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          set({
            user: { ...session.user, ...profile },
            session
          })
        }

        // Listen for auth changes
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_OUT') {
            set({ user: null, session: null })
          } else if (session) {
            const { data: profile } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('id', session.user.id)
              .single()
            set({
              user: { ...session.user, ...profile },
              session
            })
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
