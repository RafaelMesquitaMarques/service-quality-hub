const router = require('express').Router()
const supabase = require('../db/client')
const { requireAuth, requireRole } = require('../middleware/auth')

const adminOnly = [requireAuth, requireRole('admin')]

// GET /api/admin/users
router.get('/users', ...adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('full_name')

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/admin/users — create user in Supabase Auth + profile
router.post('/users', ...adminOnly, async (req, res) => {
  const { email, password, full_name, role, language = 'fr' } = req.body
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name, role are required' })
  }

  // Create auth user
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  })
  if (authErr) return res.status(500).json({ error: authErr.message })

  // Create profile
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .insert({ id: authUser.user.id, full_name, role, language })
    .select()
    .single()

  if (profileErr) return res.status(500).json({ error: profileErr.message })
  res.status(201).json({ id: authUser.user.id, email, ...profile })
})

// PATCH /api/admin/users/:id
router.patch('/users/:id', ...adminOnly, async (req, res) => {
  const { full_name, role, language, active } = req.body
  const updates = {}
  if (full_name !== undefined) updates.full_name = full_name
  if (role !== undefined)      updates.role = role
  if (language !== undefined)  updates.language = language
  if (active !== undefined)    updates.active = active

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/admin/users/:id — deactivate (soft delete)
router.delete('/users/:id', ...adminOnly, async (req, res) => {
  // Prevent self-deletion
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' })
  }
  const { error } = await supabase
    .from('user_profiles')
    .update({ active: false })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'User deactivated' })
})

// GET /api/admin/stats
router.get('/stats', ...adminOnly, async (req, res) => {
  const [tickets, users, storage] = await Promise.all([
    supabase.from('tickets').select('id', { count: 'exact', head: true }),
    supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
    supabase.from('ticket_photos').select('size_bytes')
  ])

  const totalStorageBytes = (storage.data || []).reduce((a, p) => a + (p.size_bytes || 0), 0)

  res.json({
    total_tickets: tickets.count,
    total_users: users.count,
    total_photos: (storage.data || []).length,
    storage_used_mb: Math.round(totalStorageBytes / 1024 / 1024 * 10) / 10
  })
})

module.exports = router
