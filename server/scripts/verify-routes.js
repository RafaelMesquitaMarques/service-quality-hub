// Vérification HTTP de bout en bout des routes d'occurrence.
//
//     DATABASE_URL="postgresql://..." npm run verify:routes
//
// Ce que les tests sans base ne peuvent pas montrer : que les pièces se
// touchent vraiment. Ici la requête traverse toute la pile — HTTP, requireAuth,
// requireCan/requireCanOn, policy, service, repository, PostgreSQL — et un 403
// arrive parce qu'une règle a refusé, pas parce qu'un double l'a simulé.
//
// SÛRETÉ : aucune écriture. Uniquement des lectures et des refus attendus. Les
// requêtes de modification envoyées sont celles qui DOIVENT être refusées ;
// elles n'atteignent jamais la base.
//
// L'application est chargée en processus et écoute sur un port éphémère, ce qui
// ne demande aucun port libre convenu d'avance et n'entre en conflit avec rien.

const path = require('path')
const fs = require('fs')
const jwt = require('jsonwebtoken')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

if (!process.env.DATABASE_URL) {
  const repli = path.join(process.env.USERPROFILE || process.env.HOME || '', '.checkmate', 'supabase-db-url.txt')
  if (fs.existsSync(repli)) {
    const m = fs.readFileSync(repli, 'utf8').match(/postgres(?:ql)?:\/\/\S+/)
    if (m) process.env.DATABASE_URL = m[0]
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant.'); process.exit(2)
}
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant : il sert à signer les jetons de test.'); process.exit(2)
}

const app = require('../src/app')
const { getKnex, closeKnex } = require('../src/db/knex')

let echecs = 0
const verifier = (nom, ok, detail = '') => {
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  ${nom}${detail ? '   — ' + detail : ''}`)
  if (!ok) echecs++
}

async function main() {
  const db = getKnex()

  // Les comptes témoins sont découverts, pas codés en dur : le script marche
  // sur n'importe quelle base portant ce schéma.
  const comptes = {}
  for (const role of ['admin', 'manager', 'cpm', 'viewer']) {
    const u = await db('user_profiles').where({ role }).whereNot('active', false).first('id')
    if (u) comptes[role] = u.id
  }
  const manquants = ['admin', 'manager', 'cpm', 'viewer'].filter(r => !comptes[r])
  if (manquants.length) {
    console.error('Aucun compte actif pour : ' + manquants.join(', ')); process.exit(2)
  }
  const jeton = (role) => jwt.sign({ sub: comptes[role] }, process.env.JWT_SECRET, { expiresIn: '5m' })

  const serveur = app.listen(0)
  await new Promise(r => serveur.once('listening', r))
  const BASE = `http://127.0.0.1:${serveur.address().port}/api/occurrences`
  console.log(`Application en écoute sur le port ${serveur.address().port}\n`)

  const appel = async (chemin, { role, methode = 'GET', corps, token } = {}) => {
    const h = {}
    const t = token !== undefined ? token : (role ? jeton(role) : null)
    if (t) h.Authorization = 'Bearer ' + t
    if (corps) h['Content-Type'] = 'application/json'
    const r = await fetch(BASE + chemin, {
      method: methode, headers: h, body: corps ? JSON.stringify(corps) : undefined,
    })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data }
  }

  try {
    console.log('1. Authentification')
    verifier('sans jeton : 401', (await appel('/', { token: null })).status === 401)
    verifier('jeton invalide : 401', (await appel('/', { token: 'nimporte.quoi.ici' })).status === 401)

    console.log('\n2. Lecture — ouverte à tous les rôles actifs')
    const liste = await appel('/?limit=5', { role: 'viewer' })
    verifier('un viewer lit la liste : 200', liste.status === 200, `total ${liste.data?.total}`)
    verifier('la pagination est respectée', liste.data?.occurrences?.length === 5)
    const unId = liste.data?.occurrences?.[0]?.id
    const une = await appel('/' + unId, { role: 'viewer' })
    verifier('un viewer lit une occurrence : 200', une.status === 200,
      `n° ${une.data?.occurrence?.occurrence_no}`)

    console.log('\n3. Filtres')
    const f = await appel('/?status=completed&limit=3', { role: 'manager' })
    verifier('filtre par statut : 200', f.status === 200)
    verifier('toutes les lignes respectent le filtre',
      (f.data?.occurrences || []).length > 0 && f.data.occurrences.every(o => o.status === 'completed'))

    console.log('\n4. Autorisation — les refus')
    verifier('un viewer ne crée pas : 403',
      (await appel('/', { role: 'viewer', methode: 'POST', corps: { quality_issue: 'x' } })).status === 403)
    for (const role of ['viewer', 'cpm', 'manager']) {
      verifier(`un ${role} ne supprime pas : 403`,
        (await appel('/' + unId, { role, methode: 'DELETE' })).status === 403)
    }

    console.log('\n5. La règle qui dépend de la ligne')
    const importee = await db('tickets').whereNull('created_by').first('id', 'occurrence_no')
    if (importee) {
      verifier('un cpm ne modifie pas une occurrence sans créateur : 403',
        (await appel('/' + importee.id, { role: 'cpm', methode: 'PATCH', corps: { comment: 'x' } })).status === 403,
        `n° ${importee.occurrence_no}`)
    }
    verifier('occurrence inexistante : 404',
      (await appel('/00000000-0000-0000-0000-000000000000',
        { role: 'admin', methode: 'PATCH', corps: { comment: 'x' } })).status === 404)

    console.log(`\n${echecs === 0 ? 'TOUT PASSE' : echecs + ' ECHEC(S)'}`)
  } finally {
    serveur.close()
    await closeKnex()
    process.exitCode = echecs ? 1 : 0
  }
}

main().catch((e) => {
  console.error('ERREUR :', String(e.message).replace(/:\/\/[^@]*@/, '://*****@'))
  process.exitCode = 1
})
