import { supabase } from './supabase'
import { useAuthStore } from '../store/authStore'

// ─── Fiscal Year helpers ────────────────────────────────────────────────────
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
    // PostgREST plafonne à 1000 lignes par requête : on pagine avec .range()
    // jusqu'à tout récupérer (sinon la liste s'arrête à 1000). Tri secondaire
    // sur id pour une pagination déterministe (issue_reception_date n'est pas unique).
    const buildQuery = () => {
      let query = supabase
        .from('tickets_with_cost')
        .select('*')
        .order('issue_reception_date', { ascending: false })
        .order('id', { ascending: true })

      const fy = params.fiscal_year !== undefined ? params.fiscal_year : CURRENT_FISCAL_YEAR
      if (fy !== 'all' && fy !== null) query = query.eq('fiscal_year', fy)

      if (params.status)     query = query.eq('status', params.status)
      if (params.plant)      query = query.eq('plant', params.plant)
      if (params.brand)      query = query.eq('brand', params.brand)
      if (params.department) query = query.eq('department', params.department)
      if (params.search)     query = query.ilike('quality_issue', '%' + params.search + '%')
      if (params.date_from)  query = query.gte('issue_reception_date', params.date_from)
      if (params.date_to)    query = query.lte('issue_reception_date', params.date_to)
      return query
    }

    const PAGE = 1000
    const tickets = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await buildQuery().range(from, from + PAGE - 1)
      if (error) throw error
      tickets.push(...(data || []))
      if (!data || data.length < PAGE) break
    }
    return { data: { tickets, total: tickets.length } }
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
    const { data, error } = await supabase.from('tickets').insert(enriched).select().single()
    if (error) throw error
    return { data }
  },

  update: async (id, payload) => {
    // Snapshot avant écriture — pour tracer chaque champ modifié (piste d'audit).
    let before = null
    try {
      const { data } = await supabase.from('tickets').select('*').eq('id', id).single()
      before = data
    } catch { /* pas de snapshot → sauvegarde quand même, sans trace */ }

    const { data, error } = await supabase
      .from('tickets')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    await logTicketHistory(id, before, payload)
    return { data }
  },

}

// ─── Piste d'audit (ticket_history) ──────────────────────────────────────────
// Journal append-only : une ligne par champ modifié. On garde la trace même
// si une valeur est ensuite annulée — chaque modification crée une ligne.
function sameHistoryValue(a, b) {
  const na = a === null || a === undefined ? '' : a
  const nb = b === null || b === undefined ? '' : b
  if (na === '' && nb === '') return true
  const fa = Number(na), fb = Number(nb)
  const bothNumeric = String(na).trim() !== '' && String(nb).trim() !== ''
    && !Number.isNaN(fa) && !Number.isNaN(fb)
  if (bothNumeric) return fa === fb           // 3000 === 3000.00 (le NUMERIC revient en texte)
  return String(na) === String(nb)
}

export async function logTicketHistory(ticketId, before, payload) {
  if (!before || !payload) return
  const userId = useAuthStore.getState().user?.id || null
  const rows = []
  for (const field of Object.keys(payload)) {
    if (field === 'updated_at') continue
    if (sameHistoryValue(before[field], payload[field])) continue
    rows.push({
      ticket_id:  ticketId,
      changed_by: userId,
      field:      String(field).slice(0, 50),
      old_value:  before[field] === null || before[field] === undefined ? null : String(before[field]),
      new_value:  payload[field] === null || payload[field] === undefined ? null : String(payload[field]),
    })
  }
  if (!rows.length) return
  try {
    await supabase.from('ticket_history').insert(rows)
  } catch (e) {
    console.warn('ticket_history insert failed:', e?.message)
  }
}

// Diff d'une ligne (occurrence_lines). Les champs sont préfixés « line: » et
// la ligne concernée est notée dans `note` (intitulé du problème).
export async function logLineHistory(ticketId, before, after, note = null) {
  if (!before || !after) return
  const userId = useAuthStore.getState().user?.id || null
  const rows = []
  for (const field of Object.keys(after)) {
    if (field === 'updated_at') continue
    if (sameHistoryValue(before[field], after[field])) continue
    rows.push({
      ticket_id:  ticketId,
      changed_by: userId,
      field:      ('line:' + field).slice(0, 50),
      old_value:  before[field] === null || before[field] === undefined ? null : String(before[field]),
      new_value:  after[field]  === null || after[field]  === undefined ? null : String(after[field]),
      note:       note || null,
    })
  }
  if (!rows.length) return
  try {
    await supabase.from('ticket_history').insert(rows)
  } catch (e) {
    console.warn('ticket_history (line) insert failed:', e?.message)
  }
}

// Événement de ligne : ajout / suppression (l'intitulé va dans old/new_value).
export async function logLineEvent(ticketId, kind, label = null) {
  const userId = useAuthStore.getState().user?.id || null
  const val = label === null || label === undefined ? null : String(label)
  try {
    await supabase.from('ticket_history').insert({
      ticket_id:  ticketId,
      changed_by: userId,
      field:      kind,   // 'line_added' | 'line_removed'
      old_value:  kind === 'line_removed' ? val : null,
      new_value:  kind === 'line_added'   ? val : null,
    })
  } catch (e) {
    console.warn('ticket_history (event) insert failed:', e?.message)
  }
}

// ─── Line costs ──────────────────────────────────────────────────────────────
// Somme des coûts (cost_approx) des lignes par occurrence.
// Par lots: un .in() avec des centaines d'UUID dépasse la limite d'URL de
// PostgREST et la requête échoue.
export async function fetchLineCostTotals(occurrenceIds) {
  const ids = [...new Set((occurrenceIds || []).filter(Boolean))]
  const totals = {}
  const CHUNK = 150
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('occurrence_lines')
      .select('occurrence_id, cost_approx')
      .in('occurrence_id', ids.slice(i, i + CHUNK))
    if (error) throw error
    for (const l of data || []) {
      totals[l.occurrence_id] = (totals[l.occurrence_id] || 0) + Number(l.cost_approx || 0)
    }
  }
  return totals
}

// Lignes d'occurrence avec leurs attributs par ligne (coût, département, usine,
// catégorie) pour l'agrégation des coûts du tableau de bord. Batché comme
// fetchLineCostTotals pour ne pas dépasser la limite d'URL de PostgREST.
export async function fetchOccurrenceLines(occurrenceIds) {
  const ids = [...new Set((occurrenceIds || []).filter(Boolean))]
  const rows = []
  const CHUNK = 150
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('occurrence_lines')
      .select('occurrence_id, cost_approx, department, plant, categories')
      .in('occurrence_id', ids.slice(i, i + CHUNK))
    if (error) throw error
    rows.push(...(data || []))
  }
  return rows
}

// ─── Revenus mensuels (par année fiscale, ventilés par usine) ────────────────
export const revenueApi = {
  // Toutes les lignes. plant NULL = montant « non ventilé » (anciennes saisies
  // globales, d'avant la ventilation par usine).
  all: async () => {
    const { data, error } = await supabase
      .from('monthly_revenue')
      .select('fiscal_year, fiscal_month, plant, revenue')
    if (error) { console.warn('monthly_revenue indisponible:', error.message); return [] }
    return data || []
  },
  // Remplace toutes les lignes d'une année fiscale.
  // entries: [{ fiscal_month, plant|null, revenue }] — seules les valeurs > 0
  // sont écrites (un mois sans revenu n'apparaît pas sur le graphique SC Cost %).
  saveYear: async (fiscalYear, entries) => {
    const { error: delError } = await supabase
      .from('monthly_revenue')
      .delete()
      .eq('fiscal_year', fiscalYear)
    if (delError) throw delError
    const rows = entries
      .filter(e => Number(e.revenue) > 0)
      .map(e => ({
        fiscal_year: fiscalYear, fiscal_month: e.fiscal_month,
        plant: e.plant || null, revenue: Number(e.revenue),
        updated_at: new Date().toISOString(),
      }))
    if (rows.length === 0) return true
    const { error } = await supabase.from('monthly_revenue').insert(rows)
    if (error) throw error
    return true
  },
}

// ─── Admin API ───────────────────────────────────────────────────────────────
export const adminApi = {
  users: async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, plants(name)')
      .order('created_at', { ascending: false })
    if (error) throw error
    const users = (data || []).map(u => ({
      ...u,
      plant_name: u.plants?.name || null,
    }))
    return { data: users }
  },

  plants: async () => {
    const { data, error } = await supabase
      .from('plants')
      .select('id, name, country, active')
      .eq('active', true)
      .order('name')
    if (error) {
      console.warn('plants table not found, returning empty')
      return { data: [] }
    }
    return { data }
  },

  inviteUser: async (payload) => {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const res = await fetch(
      supabaseUrl + '/functions/v1/invite-user',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey': anonKey,
        },
        body: JSON.stringify(payload),
      }
    )
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Erreur invitation')
    return { data: result }
  },

  updateUser: async (id, payload) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
    if (error) throw error
    return { data: data?.[0] || null }
  },

  uploadAvatar: async (userId, file) => {
    const ext  = file.name.split('.').pop()
    const path = 'avatars/' + (userId || 'new') + '-' + Date.now() + '.' + ext
    const { error } = await supabase.storage
      .from('user-avatars')
      .upload(path, file, { upsert: true })
    if (error) throw error
    const { data } = supabase.storage.from('user-avatars').getPublicUrl(path)
    return { data: { url: data.publicUrl } }
  },

  // Suppression réelle via RPC SECURITY DEFINER (migration 2026-07-24).
  // Retourne 'deleted', ou 'deactivated' si l'utilisateur a des
  // enregistrements liés (occurrences, photos, réunions…).
  removeUser: async (id) => {
    const { data, error } = await supabase.rpc('admin_remove_user', { target_id: id })
    if (error) throw error
    return { data }
  },

  stats: async () => {
    const t = await supabase.from('tickets').select('*', { count: 'exact', head: true })
    const u = await supabase.from('user_profiles').select('*', { count: 'exact', head: true })
    return { data: { totalTickets: t.count, totalUsers: u.count } }
  },
}

