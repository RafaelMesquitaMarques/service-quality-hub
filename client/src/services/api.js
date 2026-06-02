// Substituir apenas o ticketApi no services/api.js

export const ticketApi = {
  list: async (params = {}) => {
    let query = supabase
      .from('tickets_with_cost')  // ← view com real_cost calculado
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
      .from('tickets_with_cost')
      .select('fiscal_year, fiscal_month, department, real_cost, categories, month_name')
      .in('fiscal_year', fiscalYears)
    if (error) throw error
    return { data }
  },

  get: async (id) => {
    const { data, error } = await supabase
      .from('tickets_with_cost')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    return { data }
  },

  create: async (payload) => {
    const enriched = { ...payload }
    if (payload.date_yyyy_mm) {
      enriched.fiscal_year  = getFiscalYear(payload.date_yyyy_mm)
      enriched.fiscal_month = getFiscalMonth(payload.date_yyyy_mm)
    }
    // INSERT ainda vai para a tabela original
    const { data, error } = await supabase.from('tickets').insert(enriched).select().single()
    if (error) throw error
    return { data }
  },

  update: async (id, payload) => {
    const { data, error } = await supabase
      .from('tickets')  // UPDATE na tabela original
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
