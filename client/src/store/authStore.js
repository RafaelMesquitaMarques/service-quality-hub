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
      _subscription: null,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw error
          const profile = await fetchProfile(data.user.id)
          set({
            user: { ...profile, email: data.user.email, id: data.user.id },
            session: data.session,
            isLoading: false,
          })
          return { success: true }
        } catch (err) {
          set({ isLoading: false })
          return { success: false, error: err.message || 'Login failed' }
        }
      },

      logout: async () => {
        // Unsubscribe before signing out to avoid channel closed error
        const { _subscription } = get()
        if (_subscription) {
          _subscription.unsubscribe()
          set({ _subscription: null })
        }
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
        // Don't re-init if already subscribed
        if (get()._subscription) return

        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const profile = await fetchProfile(session.user.id)
          if (profile) {
            set({
              user: { ...profile, email: session.user.email, id: session.user.id },
              session,
            })
          }
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_OUT') {
            set({ user: null, session: null })
          } else if (event === 'SIGNED_IN' && session) {
            const profile = await fetchProfile(session.user.id)
            if (profile) {
              set({
                user: { ...profile, email: session.user.email, id: session.user.id },
                session,
              })
            }
          }
        })

        set({ _subscription: subscription })
      },
    }),
    {
      name: 'sqh-auth',
      partialize: (s) => ({ user: s.user }),
    }
  )
)
