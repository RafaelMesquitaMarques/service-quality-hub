import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Création d'un utilisateur (invitation par courriel ou mot de passe temporaire)
// depuis Administration.
// Sécurité (2026-09-15) : la version précédente ne contrôlait PAS l'appelant.
// La clé anon publique étant un JWT valide, n'importe qui pouvait créer un compte
// administrateur et recevoir son mot de passe temporaire. Désormais :
// administrateur actif uniquement, et chaque champ reçu est validé.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const ROLES = ['admin', 'manager', 'cpm', 'service_desk', 'viewer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mot de passe temporaire : aléa cryptographique, au moins une majuscule, une
// minuscule, un chiffre et un symbole (compatible avec une politique de mot de
// passe exigeant ces classes), mélange de Fisher-Yates aléatoire.
function randomIndex(max: number) {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return b[0] % max
}
function generatePassword(length = 14) {
  const classes = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789', '!@#']
  const all = classes.join('')
  const chars = classes.map((c) => c[randomIndex(c.length)])
  while (chars.length < length) chars.push(all[randomIndex(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

async function requireActiveAdmin(req: Request, supabaseAdmin: any) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { status: 401, error: 'Non autorisé' }
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  const user = data?.user
  if (error || !user) return { status: 401, error: 'Non autorisé' }
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'admin' || profile.active === false) {
    return { status: 403, error: 'Permission insuffisante' }
  }
  return { user }
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const caller = await requireActiveAdmin(req, supabaseAdmin)
    if ('error' in caller) return json({ error: caller.error }, caller.status)

    const body = await req.json().catch(() => ({}))
    const email = text(body?.email, 200)?.toLowerCase() || ''
    const full_name = text(body?.full_name, 100)
    const role = typeof body?.role === 'string' ? body.role : ''
    const department = text(body?.department, 100)
    const plant_id = typeof body?.plant_id === 'string' && UUID_RE.test(body.plant_id) ? body.plant_id : null
    const language = body?.language === 'en' ? 'en' : 'fr'
    const avatar_url = text(body?.avatar_url, 500)
    const mode = body?.mode === 'password' ? 'password' : 'invite'

    if (!EMAIL_RE.test(email)) return json({ error: 'Email invalide' }, 400)
    if (!full_name) return json({ error: 'Nom requis' }, 400)
    if (!ROLES.includes(role)) return json({ error: 'Rôle invalide' }, 400)

    let userId: string
    let tempPassword: string | null = null

    if (mode === 'password') {
      // Mot de passe temporaire généré ici — jamais reçu du navigateur.
      tempPassword = generatePassword()
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name, role, department, plant_id, language, avatar_url, must_change_password: true },
      })
      if (error) throw error
      userId = data.user.id
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name, role, department, plant_id, language, avatar_url },
      })
      if (error) throw error
      userId = data.user.id
    }

    const { error: profileError } = await supabaseAdmin.from('user_profiles').upsert({
      id: userId,
      full_name,
      email,
      role,
      department,
      plant_id,
      language,
      avatar_url,
      active: mode === 'password',
      invited_at: mode === 'password' ? null : new Date().toISOString(),
      must_change_password: mode === 'password',
    })
    if (profileError) {
      // Pas de compte d'authentification orphelin : sinon chaque nouvel essai
      // échouerait avec « already registered » et l'invité n'aurait aucun profil.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {})
      throw profileError
    }

    return json({ success: true, temp_password: tempPassword })
  } catch (err) {
    return json({ error: (err as Error)?.message || 'Erreur' }, 400)
  }
})
