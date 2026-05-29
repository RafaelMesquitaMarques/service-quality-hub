const router = require('express').Router()
const supabase = require('../db/client')
const { requireAuth } = require('../middleware/auth')

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ error: error.message })

  // Fetch profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()

  res.json({
    access_token: data.session.access_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      ...profile
    }
  })
})

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  await supabase.auth.signOut()
  res.json({ message: 'Logged out' })
})

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// PATCH /api/auth/me/language
router.patch('/me/language', requireAuth, async (req, res) => {
  const { language } = req.body
  if (!['fr', 'en'].includes(language)) {
    return res.status(400).json({ error: 'Language must be fr or en' })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ language })
    .eq('id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ language })
})

// PATCH /api/auth/me/password
router.patch('/me/password', requireAuth, async (req, res) => {
  const { password } = req.body
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Password updated' })
})

module.exports = router
