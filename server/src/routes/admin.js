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
  const {
    email, password, full_name, role, language = 'fr',
    department, plant_id, avatar_url,
    perm_create_occurrence, perm_edit_occurrence, perm_delete_occurrence,
    perm_view_dashboard, perm_admin, perm_manage_plants,
    perm_import_excel, perm_create_mobile, perm_meetings
  } = req.body
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name, role are required' })
  }

  // Create auth user
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true
  })
  if (authErr) return res.status(500).json({ error: authErr.message })

  // Create profile
  const profileData = {
    id: authUser.user.id, full_name, role, language,
    ...(department !== undefined && { department }),
    ...(plant_id !== undefined && { plant_id }),
    ...(avatar_url !== undefined && { avatar_url }),
    ...(perm_create_occurrence !== undefined && { perm_create_occurrence }),
    ...(perm_edit_occurrence !== undefined && { perm_edit_occurrence }),
    ...(perm_delete_occurrence !== undefined && { perm_delete_occurrence }),
    ...(perm_view_dashboard !== undefined && { perm_view_dashboard }),
    ...(perm_admin !== undefined && { perm_admin }),
    ...(perm_manage_plants !== undefined && { perm_manage_plants }),
    ...(perm_import_excel !== undefined && { perm_import_excel }),
    ...(perm_create_mobile !== undefined && { perm_create_mobile }),
    ...(perm_meetings !== undefined && { perm_meetings })
  }
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .insert(profileData)
    .select()
    .single()

  if (profileErr) return res.status(500).json({ error: profileErr.message })
  res.status(201).json({ id: authUser.user.id, email, ...profile })
})

// PATCH /api/admin/users/:id
router.patch('/users/:id', ...adminOnly, async (req, res) => {
  const {
    full_name, role, language, active,
    department, plant_id, avatar_url,
    perm_create_occurrence, perm_edit_occurrence, perm_delete_occurrence,
    perm_view_dashboard, perm_admin, perm_manage_plants,
    perm_import_excel, perm_create_mobile, perm_meetings
  } = req.body
  const updates = {}
  if (full_name !== undefined) updates.full_name = full_name
  if (role !== undefined)      updates.role = role
  if (language !== undefined)  updates.language = language
  if (active !== undefined)    updates.active = active
  if (department !== undefined) updates.department = department
  if (plant_id !== undefined)   updates.plant_id = plant_id
  if (avatar_url !== undefined) updates.avatar_url = avatar_url
  if (perm_create_occurrence !== undefined) updates.perm_create_occurrence = perm_create_occurrence
  if (perm_edit_occurrence !== undefined)   updates.perm_edit_occurrence = perm_edit_occurrence
  if (perm_delete_occurrence !== undefined) updates.perm_delete_occurrence = perm_delete_occurrence
  if (perm_view_dashboard !== undefined)    updates.perm_view_dashboard = perm_view_dashboard
  if (perm_admin !== undefined)             updates.perm_admin = perm_admin
  if (perm_manage_plants !== undefined)     updates.perm_manage_plants = perm_manage_plants
  if (perm_import_excel !== undefined)      updates.perm_import_excel = perm_import_excel
  if (perm_create_mobile !== undefined)     updates.perm_create_mobile = perm_create_mobile
  if (perm_meetings !== undefined)          updates.perm_meetings = perm_meetings

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
