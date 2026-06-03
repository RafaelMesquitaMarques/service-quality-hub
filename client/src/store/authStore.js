import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../services/supabase'

const fetchProfile = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) throw error
    return data
  } catch (e) {
    console.warn('fetchProfile error:', e.message)
    return null
  }
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      isLoading: false,
      _initialized: false,
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
        // Limpar subscription antes de fazer signOut
        const { _subscription } = get()
        if (_subscription) {
          try { _subscription.unsubscribe() } catch (e) {}
          set({ _subscription: null })
        }
        try { await supabase.auth.signOut() } catch (e) {}
        set({ user: null, session: null, _initialized: false })
      },

      setLanguage: async (language) => {
        const { user } = get()
        if (!user) return
        try {
          await supabase.from('user_profiles').update({ language }).eq('id', user.id)
          set(s => ({ user: { ...s.user, language } }))
        } catch (e) {}
      },

      init: async () => {
        // Evitar dupla inicialização
        if (get()._initialized) return
        set({ _initialized: true })

        try {
          // 1. Verificar sessão existente
          const { data: { session }, error } = await supabase.auth.getSession()

          if (error) {
            console.warn('getSession error:', error.message)
          }

          if (session?.user) {
            // Já temos user no persist — não precisa de fazer fetch do perfil de novo
            const cachedUser = get().user
            if (cachedUser?.id === session.user.id) {
              // Sessão válida, user já em cache — só actualizar session
              set({ session })
            } else {
              // Novo utilizador ou cache inválido
              const profile = await fetchProfile(session.user.id)
              if (profile) {
                set({
                  user: { ...profile, email: session.user.email, id: session.user.id },
                  session,
                })
              }
            }
          } else {
            // Sem sessão — limpar user
            set({ user: null, session: null })
          }
        } catch (e) {
          console.warn('init error:', e.message)
          set({ user: null, session: null })
        }

        // 2. Listener para mudanças de auth
        // Limpar subscription anterior se existir
        const existingSub = get()._subscription
        if (existingSub) {
          try { existingSub.unsubscribe() } catch (e) {}
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            // Ignorar TOKEN_REFRESHED para não causar re-renders desnecessários
            if (event === 'TOKEN_REFRESHED') return

            if (event === 'SIGNED_OUT') {
              set({ user: null, session: null })
              return
            }

           if (event === 'SIGNED_IN' && session?.user) {
  const cachedUser = get().user
  if (!cachedUser || cachedUser?.id !== session.user.id) {
    const profile = await fetchProfile(session.user.id)
    if (profile) {
      set({
        user: { ...profile, email: session.user.email, id: session.user.id },
        session,
      })
    }
  }
}
          }
        )

        set({ _subscription: subscription })
      },
    }),
    {
      name: 'sqh-auth',
      // Persistir apenas user — não session nem subscription
      partialize: (s) => ({ user: s.user }),
    }
  )
)
