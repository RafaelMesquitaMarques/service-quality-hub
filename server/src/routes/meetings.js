const router = require('express').Router()
const supabase = require('../db/client')
const { requireAuth, requireRole } = require('../middleware/auth')

// GET /api/meetings
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .order('meeting_date', { ascending: false })
    .limit(52) // last year of weekly meetings

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/meetings/:date — tickets for that week
router.get('/:date', requireAuth, async (req, res) => {
  const { data: tickets, error } = await supabase
    .from('tickets_with_users')
    .select('*')
    .eq('meeting_date', req.params.date)
    .order('department')

  if (error) return res.status(500).json({ error: error.message })

  // Also fetch or create the meeting record
  const { data: meeting } = await supabase
    .from('meetings')
    .select('*')
    .eq('meeting_date', req.params.date)
    .maybeSingle()

  res.json({ meeting, tickets: tickets || [] })
})

// POST /api/meetings
router.post('/', requireAuth, requireRole('admin', 'manager', 'service_desk'), async (req, res) => {
  const { meeting_date, type, notes } = req.body
  if (!meeting_date) return res.status(400).json({ error: 'meeting_date is required' })

  const { data, error } = await supabase
    .from('meetings')
    .upsert({ meeting_date, type, notes, created_by: req.user.id }, { onConflict: 'meeting_date' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PATCH /api/meetings/:date/notes
router.patch('/:date/notes', requireAuth, requireRole('admin', 'manager', 'service_desk'), async (req, res) => {
  const { notes } = req.body
  const { data, error } = await supabase
    .from('meetings')
    .update({ notes })
    .eq('meeting_date', req.params.date)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
