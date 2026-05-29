import { supabase } from './supabase'

export const ticketApi = {
  list: async (params = {}) => {
    let query = supabase.from('tickets').select('*').order('created_at', { ascending: false })
    if (params.status) query = query.eq('status', params.status)
    if (params.plant) query = query.eq('plant', params.plant)
    if (params.brand) query = query.eq('brand', params.brand)
    if (params.department) query = query.eq('department', params.department)
    if (params.search) query = query.ilike('quality_issue', '%' + params.search + '%')
    if (params.limit) query = query.limit(params.limit)
    if (params.date_from) query = query.gte('issue_reception_date', params.date_from)
    if (params.date_to) query = query.lte('issue_reception_date', params.date_to)
    const { data, error } = await query
    if (error) throw error
    return { data: { tickets: data, total: data.length } }
  },
  get: async (id) => {
    const { data, error } = await supabase.from('tickets').select('*').eq('id', id).single()
    if (error) throw error
    return { data }
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('tickets').insert(payload).select().single()
    if (error) throw error
    return { data }
  },
  update: async (id, payload) => {
    const { data, error } = await supabase.from('tickets').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) throw error
    return { data }
  },
  remove: async (id) => {
    const { error } = await supabase.from('tickets').delete().eq('id', id)
    if (error) throw error
    return { data: { success: true } }
  },
}

export const photoApi = {
  upload: async (ticketId, files) => {
    const uploaded = []
    for (const file of files) {
      const ext = file.name.split('.').pop()
      const path = 'tickets/' + ticketId + '/' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('ticket-photos').upload(path, file)
      if (error) throw error
      uploaded.push({ path, name: file.name })
    }
    return { data: uploaded }
  },
  getUrl: async (ticketId, path) => {
    const { data } = supabase.storage.from('ticket-photos').getPublicUrl(path)
    return { data: { url: data.publicUrl } }
  },
  remove: async (ticketId, path) => {
    const { error } = await supabase.storage.from('ticket-photos').remove([path])
    if (error) throw error
    return { data: { success: true } }
  },
}

export const meetingApi = {
  list: async () => {
    const { data, error } = await supabase.from('meetings').select('*').order('meeting_date', { ascending: false })
    if (error) throw error
    return { data }
  },
  getByDate: async (date) => {
    const { data, error } = await supabase.from('meetings').select('*').eq('meeting_date', date).single()
    if (error && error.code !== 'PGRST116') throw error
    return { data: data || null }
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('meetings').insert(payload).select().single()
    if (error) throw error
    return { data }
  },
  updateNotes: async (date, notes) => {
    const { data, error } = await supabase.from('meetings').update({ notes, updated_at: new Date().toISOString() }).eq('meeting_date', date).select().single()
    if (error) throw error
    return { data }
  },
}

export const adminApi = {
  users: async () => {
    const { data, error } = await supabase.from('user_profiles').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return { data }
  },
  updateUser: async (id, payload) => {
    const { data, error } = await supabase.from('user_profiles').update(payload).eq('id', id).select().single()
    if (error) throw error
    return { data }
  },
  deactivate: async (id) => {
    const { data, error } = await supabase.from('user_profiles').update({ active: false }).eq('id', id).select().single()
    if (error) throw error
    return { data }
  },
  stats: async () => {
    const t = await supabase.from('tickets').select('*', { count: 'exact', head: true })
    const u = await supabase.from('user_profiles').select('*', { count: 'exact', head: true })
    return { data: { totalTickets: t.count, totalUsers: u.count } }
  },
}

export const importApi = {
  preview: async () => ({ data: {} }),
  run: async () => ({ data: {} }),
}

export default {
  get: async () => ({}),
  post: async () => ({}),
  patch: async () => ({}),
  delete: async () => ({})
}
