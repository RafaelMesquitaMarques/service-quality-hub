import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Réinitialisation du mot de passe d'un utilisateur par un administrateur.
// Sécurité (2026-09-15) : la version précédente acceptait aussi les managers,
// sans vérifier que leur profil était actif ni la cible — un manager pouvait
// réinitialiser le mot de passe d'un administrateur, recevoir le mot de passe
// temporaire et se connecter à sa place. Désormais : administrateur actif
// uniquement ; mot de passe généré avec un aléa cryptographique.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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

// Appelant = administrateur actif, vérifié à partir de SON jeton de session.
// La clé anon (JWT sans utilisateur) et tout jeton invalide sont refusés.
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
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''
    if (!UUID_RE.test(userId)) return json({ error: 'user_id requis' }, 400)

    const tempPassword = generatePassword()
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: tempPassword,
      user_metadata: { must_change_password: true },
    })
    if (error) throw error

    await supabaseAdmin
      .from('user_profiles')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', userId)

    return json({ success: true, temp_password: tempPassword })
  } catch (err) {
    return json({ error: (err as Error)?.message || 'Erreur' }, 400)
  }
})
