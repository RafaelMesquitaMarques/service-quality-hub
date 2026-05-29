const router = require('express').Router()
const supabase = require('../db/client')
const { requireAuth, requireRole } = require('../middleware/auth')
const XLSX = require('xlsx')

// Helper: record history entry
async function addHistory(ticketId, userId, field, oldVal, newVal, note = null) {
  await supabase.from('ticket_history').insert({
    ticket_id: ticketId,
    changed_by: userId,
    field,
    old_value: oldVal ? String(oldVal) : null,
    new_value: newVal ? String(newVal) : null,
    note
  })
}

// GET /api/tickets
// Query params: status, brand, department, plant, search, meeting_date,
//               date_from, date_to, fiscal_year, page, limit
router.get('/', requireAuth, async (req, res) => {
  const {
    status, brand, department, plant, search,
    meeting_date, date_from, date_to, fiscal_year,
    page = 1, limit = 50
  } = req.query

  let query = supabase
    .from('tickets_with_users')
    .select('*', { count: 'exact' })
    .order('issue_reception_date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status)       query = query.eq('status', status)
  if (brand)        query = query.eq('brand', brand)
  if (department)   query = query.eq('department', department)
  if (plant)        query = query.eq('plant', plant)
  if (fiscal_year)  query = query.eq('fiscal_year', fiscal_year)
  if (meeting_date) query = query.eq('meeting_date', meeting_date)
  if (date_from)    query = query.gte('issue_reception_date', date_from)
  if (date_to)      query = query.lte('issue_reception_date', date_to)

  if (search) {
    query = query.textSearch(
      'quality_issue, ship_to, sold_to, brand, sc_number',
      search,
      { type: 'websearch' }
    )
  }

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })

  res.json({
    data,
    meta: { total: count, page: Number(page), limit: Number(limit) }
  })
})

// GET /api/tickets/export/xlsx
router.get('/export/xlsx', requireAuth, async (req, res) => {
  const { status, brand, department, date_from, date_to } = req.query

  let query = supabase.from('tickets').select('*').order('issue_reception_date', { ascending: false })
  if (status)     query = query.eq('status', status)
  if (brand)      query = query.eq('brand', brand)
  if (department) query = query.eq('department', department)
  if (date_from)  query = query.gte('issue_reception_date', date_from)
  if (date_to)    query = query.lte('issue_reception_date', date_to)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Disposition', 'attachment; filename="sqh-export.xlsx"')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buf)
})

// GET /api/tickets/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { data: ticket, error } = await supabase
    .from('tickets_with_users')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: 'Ticket not found' })

  const { data: photos } = await supabase
    .from('ticket_photos')
    .select('*')
    .eq('ticket_id', req.params.id)
    .order('uploaded_at', { ascending: true })

  const { data: history } = await supabase
    .from('ticket_history')
    .select('*, changed_by_profile:user_profiles(full_name)')
    .eq('ticket_id', req.params.id)
    .order('changed_at', { ascending: false })

  res.json({ ...ticket, photos: photos || [], history: history || [] })
})

// POST /api/tickets
router.post('/', requireAuth, async (req, res) => {
  const {
    issue_reception_date, quality_issue, ship_to, sold_to,
    department, brand, plant, categories, status,
    dd, ref_so, sc_number, item, material_number,
    affected_qty, total_qty, cost_approx, supplier_credit,
    root_cause, corrective_action, corrective_action_no,
    meeting_date, fiscal_year, fiscal_month, date_yyyy_mm,
    cortex_data, assigned_to
  } = req.body

  if (!issue_reception_date || !quality_issue) {
    return res.status(400).json({ error: 'issue_reception_date and quality_issue are required' })
  }

  const affected_pct = (affected_qty && total_qty && total_qty > 0)
    ? affected_qty / total_qty
    : null

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      issue_reception_date, quality_issue, ship_to, sold_to,
      department, brand, plant, categories,
      status: status || 'not_started',
      dd, ref_so, sc_number, item, material_number,
      affected_qty, total_qty, affected_pct,
      cost_approx, supplier_credit,
      root_cause, corrective_action, corrective_action_no,
      meeting_date, fiscal_year, fiscal_month, date_yyyy_mm,
      cortex_data, assigned_to,
      created_by: req.user.id
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  await addHistory(data.id, req.user.id, 'status', null, data.status, 'Ticket created')
  res.status(201).json(data)
})

// PATCH /api/tickets/:id
router.patch('/:id', requireAuth, async (req, res) => {
  // Fetch current ticket to compare and check ownership
  const { data: current, error: fetchErr } = await supabase
    .from('tickets').select('*').eq('id', req.params.id).single()

  if (fetchErr) return res.status(404).json({ error: 'Ticket not found' })

  // CPMs can only edit their own tickets
  if (req.user.role === 'cpm' && current.created_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own tickets' })
  }

  // Service desk fields (sc_number, cortex_data) restricted to service_desk/admin/manager
  const sdFields = ['sc_number', 'cortex_data', 'corrective_action', 'corrective_action_no']
  if (req.user.role === 'cpm') {
    sdFields.forEach(f => delete req.body[f])
  }

  // Viewers cannot edit
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Viewers cannot edit tickets' })
  }

  // Recalculate affected_pct if quantities changed
  const affected_qty = req.body.affected_qty ?? current.affected_qty
  const total_qty    = req.body.total_qty    ?? current.total_qty
  if (req.body.affected_qty !== undefined || req.body.total_qty !== undefined) {
    req.body.affected_pct = (affected_qty && total_qty && total_qty > 0)
      ? affected_qty / total_qty : null
  }

  const { data, error } = await supabase
    .from('tickets')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Record history for status change
  if (req.body.status && req.body.status !== current.status) {
    await addHistory(req.params.id, req.user.id, 'status', current.status, req.body.status)
  }

  res.json(data)
})

// DELETE /api/tickets/:id — admin only
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { error } = await supabase.from('tickets').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Ticket deleted' })
})

module.exports = router
