import { supabase } from './supabase'

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },
  logout: async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },
  getSession: () => supabase.auth.getSession(),
  getUser: () => supabase.auth.getUser(),
  onAuthStateChange: (cb) => supabase.auth.onAuthStateChange(cb),
}

// ─── TICKETS ──────────────────────────────────────────────────────────────────
export const ticketApi = {
  list: async (params = {}) => {
    let query = supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })

    if (params.status)     query = query.eq('status', params.status)
    if (params.plant)      query = query.eq('plant', params.plant)
    if (params.brand)      query = query.eq('brand', params.brand)
    if (params.department) query = query.eq('department', params.department)
    if (params.search)     query = query.ilike('quality_issue', `%${params.search}%`)
    if (params.limit)      query = query.limit(params.limit)
    if (params.date_from)  query = query.gte('issue_reception_date', params.date_from)
    if (params.date_to)    query = query.lte('issue_reception_date', params.date_to)

    const { data, error } = await query
    if (error) throw error
    return { data: { tickets: data, total: data.length } }
  },

  get: async (id) => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    return { data: data }
  },

  create: async (payload) => {
    const { data, error } = await supabase
      .from('tickets')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('tickets')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  remove: async (id) => {
    const { error } = await supabase
      .from('tickets')
      .delete()
      .eq('id', id)
    if (error) throw error
    return { data: { success: true } }
  },

  export: async (params = {}) => {
    // Returns raw data for client-side Excel export
    let query = supabase.from('tickets').select('*').order('created_at', { ascending: false })
    if (params.status)     query = query.eq('status', params.status)
    if (params.plant)      query = query.eq('plant', params.plant)
    const { data, error } = await query
    if (error) throw error
    return { data: data }
  },
}

// ─── PHOTOS ───────────────────────────────────────────────────────────────────
export const photoApi = {
  upload: async (ticketId, files) => {
    const uploaded = []
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = `tickets/${ticketId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('ticket-photos')
        .upload(path, file)
      if (upErr) throw upErr
      uploaded.push({ path, name: file.name })
    }
    return { data: uploaded }
  },

  getUrl: async (ticketId, path) => {
    const { data } = supabase.storage
      .from('ticket-photos')
      .getPublicUrl(path)
    return { data: { url: data.publicUrl } }
  },

  remove: async (ticketId, path) => {
    const { error } = await supabase.storage
      .from('ticket-photos')
      .remove([path])
    if (error) throw error
    return { data: { success: true } }
  },
}

// ─── MEETINGS ─────────────────────────────────────────────────────────────────
export const meetingApi = {
  list: async () => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .order('meeting_date', { ascending: false })
    if (error) throw error
    return { data: data }
  },

  getByDate: async (date) => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('meeting_date', date)
      .single()
    if (error && error.code !== 'PGRST116') throw error
    return { data: data || null }
  },

  create: async (payload) => {
    const { data, error } = await supabase
      .from('meetings')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  updateNotes: async (date, notes) => {
    const { data, error } = await supabase
      .from('meetings')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('meeting_date', date)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export const adminApi = {
  users: async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return { data: data }
  },

  createUser: async (payload) => {
    // Create auth user + profile via Supabase Admin (needs service role on backend)
    // For now, insert directly into user_profiles
    const { data, error } = await supabase
      .from('user_profiles')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  updateUser: async (id, payload) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  deactivate: async (id) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ active: false })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data: data }
  },

  stats: async () => {
    const [tickets, users] = await Promise.all([
      supabase.from('tickets').select('*', { count: 'exact', head: true }),
      supabase.from('user_profiles').select('*', { count: 'exact', head: true }),
    ])
    return { data: { totalTickets: tickets.count, totalUsers: users.count } }
  },
}

// ─── IMPORT ───────────────────────────────────────────────────────────────────
export const importApi = {
  // Import is now handled client-side — parse Excel and insert directly
  preview: async (file) => {
    return { data: { message: 'Use the import page to upload Excel files.' } }
  },
  run: async (file, skipDuplicates = false) => {
    return { data: { message: 'Use the import page to upload Excel files.' } }
  },
}

// ─── DEFAULT EXPORT (backward compat) ─────────────────────────────────────────
// Some pages may import `api` directly — provide a minimal axios-like shim
const api = {
  get: async (url, config = {}) => {
    console.warn(`[api] Legacy GET ${url} — migrate to supabase direct`)
    return { data: {} }
  },
  post: async (url, data, config = {}) => {
    console.warn(`[api] Legacy POST ${url} — migrate to supabase direct`)
    return { data: {} }
  },
  patch: async (url, data) => {
    console.warn(`[api] Legacy PATCH ${url} — migrate to supabase direct`)
    return { data: {} }
  },
  delete: async (url) => {
    console.warn(`[api] Legacy DELETE ${url} — migrate to supabase direct`)
    return { data: {} }
  },
}

export default api
