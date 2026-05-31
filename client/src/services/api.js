import { supabase } from './supabase'

// ─── Fiscal Year helpers ────────────────────────────────────────────────────
// FY starts in December: FY2026 = Dec 2025 → Nov 2026
export const CURRENT_FISCAL_YEAR = 2026

export function getFiscalYear(dateYYYYMM) {
  if (!dateYYYYMM) return null
  const [year, month] = dateYYYYMM.split('-').map(Number)
  return month === 12 ? year + 1 : year
}

export function getFiscalMonth(dateYYYYMM) {
  if (!dateYYYYMM) return null
  const [, month] = dateYYYYMM.split('-').map(Number)
  return month === 12 ? 1 : month + 1
}

// Fiscal month order for charts (Dec=1, Jan=2, ..., Nov=12)
export const FISCAL_MONTH_ORDER = [
  { fiscal: 1,  name: 'December',  nameShort: 'Dec' },
  { fiscal: 2,  name: 'January',   nameShort: 'Jan' },
  { fiscal: 3,  name: 'February',  nameShort: 'Feb' },
  { fiscal: 4,  name: 'March',     nameShort: 'Mar' },
  { fiscal: 5,  name: 'April',     nameShort: 'Apr' },
  { fiscal: 6,  name: 'May',       nameShort: 'May' },
  { fiscal: 7,  name: 'June',      nameShort: 'Jun' },
  { fiscal: 8,  name: 'July',      nameShort: 'Jul' },
  { fiscal: 9,  name: 'August',    nameShort: 'Aug' },
  { fiscal: 10, name: 'September', nameShort: 'Sep' },
  { fiscal: 11, name: 'October',   nameShort: 'Oct' },
  { fiscal: 12, name: 'November',  nameShort: 'Nov' },
]

// ─── Ticket API ─────────────────────────────────────────────────────────────
export const ticketApi = {
  list: async (params = {}) => {
    let query = supabase
      .from('tickets')
      .select('*')
      .order('issue_reception_date', { ascending: false })

    const fy = params.fiscal_year !== undefined ? params.fiscal_year : CURRENT_FISCAL_YEAR
    if (fy !== 'all' && fy !== null) {
      query = query.eq('fiscal_year', fy)
    }

    if (params.status)     query = query.eq('status', params.status)
    if (params.plant)      query = query.eq('plant', params.plant)
    if (params.brand)      query = query.eq('brand', params.brand)
    if (params.department) query = query.eq('department', params.department)
    if (params.search)     query = query.ilike('quality_issue', '%' + params.search + '%')
    if (params.date_from)  query = query.gte('issue_reception_date', params.date_from)
    if (params.date_to)    query = query.lte('issue_reception_date', params.date_to)

    const { data, error } = await query
    if (error) throw error
    return { data: { tickets: data, total: data.length } }
  },

  listMultiYear: async (fiscalYears = [2025, 2026]) => {
    const { data, error } = await supabase
      .from('tickets')
      .select('fiscal_year, fiscal_month, department, cost_approx, categories, month_name')
      .in('fiscal_year', fiscalYears)
    if (error) throw error
    return { data }
  },

  get: async (id) => {
    const { data, error } = await supabase.from('tickets').select('*').eq('id', id).single()
    if (error) throw error
    return { data }
  },

  create: async (payload) => {
    const enriched = { ...payload }
    if (payload.date_yyyy_mm) {
      enriched.fiscal_year  = getFiscalYear(payload.date_yyyy_mm)
      enriched.fiscal_month = getFiscalMonth(payload.date_yyyy_mm)
    }
    const { data, error } = await supabase.from('tickets').insert(enriched).select().single()
    if (error) throw error
    return { data }
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('tickets')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data }
  },

  remove: async (id) => {
    const { error } = await supabase.from('tickets').delete().eq('id', id)
    if (error) throw error
    return { data: { success: true } }
  },

  export: async (params = {}) => {
    return { data: '' }
  },
}

// ─── KPI Calculations ────────────────────────────────────────────────────────
export function calcKpis(tickets) {
  const scCost = tickets
    .filter(t => t.department !== 'Client' && t.cost_approx > 0)
    .reduce((sum, t) => sum + Number(t.cost_approx || 0), 0)

  const totalCost = tickets
    .filter(t => t.cost_approx != null && t.cost_approx > 0)
    .reduce((sum, t) => sum + Number(t.cost_approx), 0)

  const clientCost = tickets
    .filter(t => t.department === 'Client' && t.cost_approx > 0)
    .reduce((sum, t) => sum + Number(t.cost_approx || 0), 0)

  const byDepartment = {}
  tickets.forEach(t => {
    byDepartment[t.department] = (byDepartment[t.department] || 0) + 1
  })

  const costByDepartment = {}
  tickets.filter(t => t.cost_approx > 0 && t.department).forEach(t => {
    costByDepartment[t.department] = (costByDepartment[t.department] || 0) + Number(t.cost_approx)
  })

  const byCategory = {}
  tickets.forEach(t => {
    const c = t.categories || 'Other'
    byCategory[c] = (byCategory[c] || 0) + 1
  })

  const byFiscalMonth = {}
  tickets.forEach(t => {
    const fm = t.fiscal_month
    if (fm) byFiscalMonth[fm] = (byFiscalMonth[fm] || 0) + 1
  })

  const completed = tickets.filter(t => t.status === 'completed').length
  const open      = tickets.filter(t => !['completed', 'cancelled'].includes(t.status)).length
  const total     = tickets.length

  return {
    total, open, completed,
    completionPct: total ? Math.round(completed / total * 100) : 0,
    totalCost, scCost, clientCost,
    byDepartment, costByDepartment, byCategory, byFiscalMonth,
  }
}

export function calcScCostPct(scCost, revenue) {
  if (!revenue || revenue === 0) return 0
  return scCost / revenue
}

// ─── Photo API ───────────────────────────────────────────────────────────────
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

// ─── Meeting API ─────────────────────────────────────────────────────────────
export const meetingApi = {
  list: async () => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .order('meeting_date', { ascending: false })
    if (error) throw error
    return { data }
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
    const { data, error } = await supabase.from('meetings').insert(payload).select().single()
    if (error) throw error
    return { data }
  },
  updateNotes: async (date, notes) => {
    const { data, error } = await supabase
      .from('meetings')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('meeting_date', date)
      .select()
      .single()
    if (error) throw error
    return { data }
  },
}

// ─── Admin API ───────────────────────────────────────────────────────────────
export const adminApi = {
  users: async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return { data }
  },
  updateUser: async (id, payload) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data }
  },
  deactivate: async (id) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ active: false })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return { data }
  },
  stats: async () => {
    const t = await supabase.from('tickets').select('*', { count: 'exact', head: true })
    const u = await supabase.from('user_profiles').select('*', { count: 'exact', head: true })
    return { data: { totalTickets: t.count, totalUsers: u.count } }
  },
}

// ─── Import API ───────────────────────────────────────────────────────────────
export const importApi = {
  preview: async () => ({ data: {} }),
  run: async () => ({ data: {} }),
}

export default {
  get: async () => ({}),
  post: async () => ({}),
  patch: async () => ({}),
  delete: async () => ({}),
}
