const jwt = require('jsonwebtoken')
const supabase = require('../db/client')

// Verify Supabase JWT and attach user + profile to req
async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }

  const token = header.split(' ')[1]

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Fetch user profile (role, language, etc.)
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', decoded.sub)
    .single()

  if (error || !profile) {
    return res.status(401).json({ error: 'User profile not found' })
  }

  if (!profile.active) {
    return res.status(403).json({ error: 'Account is deactivated' })
  }

  req.user = { id: decoded.sub, ...profile }
  next()
}

// Role-based access control factory
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`
      })
    }
    next()
  }
}

module.exports = { requireAuth, requireRole }
