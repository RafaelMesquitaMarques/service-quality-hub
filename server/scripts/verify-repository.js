// Vérification du dépôt d'occurrence contre une VRAIE base.
//
//     DATABASE_URL="postgresql://..." npm run verify:repository
//
// Pourquoi un script à part et pas un test de `npm run test:api` : les tests de
// la couche API tournent sans base, par choix, et doivent le rester. Ce qu'ils
// ne peuvent pas couvrir, c'est le seul module qui parle SQL — le dépôt. D'où
// ce script, à lancer à la main quand une base est joignable.
//
// SÛRETÉ : tout ce qui écrit se passe dans une transaction qui se termine par
// un rollback provoqué. Rien n'est commité, et le script le vérifie lui-même à
// la fin en relisant hors transaction. Il peut donc tourner contre la base en
// service sans rien y changer — son coût est un verrou de quelques
// millisecondes sur une ligne.
//
// NON COUVERT : le comportement du verrou `forUpdate` face à une transaction
// concurrente. La requête s'exécute, mais tester la concurrence demanderait
// deux connexions qui s'attendent, avec le risque de bloquer. À faire
// séparément si le besoin se présente.

const fs = require('fs')
const path = require('path')
const knexFactory = require('knex')
const { occurrenceRepository } = require('../src/occurrences/repository')
const { updateOccurrence, NotFoundError } = require('../src/occurrences/service')

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // Repli : fichier hors dépôt, à l'abri, pour ne pas retaper la chaîne.
  const repli = path.join(process.env.USERPROFILE || process.env.HOME || '', '.checkmate', 'supabase-db-url.txt')
  if (fs.existsSync(repli)) {
    const m = fs.readFileSync(repli, 'utf8').match(/postgres(?:ql)?:\/\/\S+/)
    if (m) return m[0]
  }
  console.error('Aucune chaîne de connexion. Définir DATABASE_URL.')
  console.error('Prendre celle du « Session pooler » : la connexion directe n\'a pas')
  console.error('d\'enregistrement IPv4 et expire au lieu de refuser.')
  process.exit(2)
}

const SONDE = 'SONDE VERIFICATION ' + new Date().toISOString()
const UUID_ABSENT = '00000000-0000-0000-0000-000000000000'

let echecs = 0
function verifier(nom, ok, detail = '') {
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'}  ${nom}${detail ? '   — ' + detail : ''}`)
  if (!ok) echecs++
}

async function main() {
  const db = knexFactory({ client: 'pg', connection: connectionString(), pool: { min: 0, max: 3 } })
  try {
    const cible = await db('tickets').orderBy('updated_at', 'desc')
      .first('id', 'occurrence_no', 'comment', 'updated_at')
    if (!cible) { console.error('Aucune occurrence : rien à vérifier.'); return }

    const compterHist = async (q = db) =>
      Number((await q('ticket_history').where({ ticket_id: cible.id }).count({ n: '*' }).first()).n)
    const histAvant = await compterHist()
    console.log(`Occurrence témoin : #${cible.occurrence_no}  (${histAvant} lignes d'historique)\n`)

    console.log('1. Écriture qui ne touche aucune ligne')
    await db.transaction(async (trx) => {
      const r = await occurrenceRepository(trx).update(UUID_ABSENT, { comment: SONDE })
      verifier('returning renvoie null', r === null, `reçu : ${JSON.stringify(r)}`)
    })

    console.log('\n2. Le service en fait un 404')
    await db.transaction(async (trx) => {
      try {
        await updateOccurrence({ repo: occurrenceRepository(trx), id: UUID_ABSENT, patch: { comment: SONDE }, user: null })
        verifier('NotFoundError levée', false, 'aucune erreur levée')
      } catch (e) {
        verifier('NotFoundError levée', e instanceof NotFoundError && e.status === 404, `${e.name} ${e.status || ''}`)
      }
    })

    console.log('\n3. Modification complète, dans une transaction annulée')
    try {
      await db.transaction(async (trx) => {
        const repo = occurrenceRepository(trx)
        const avant = await repo.findById(cible.id)
        verifier('findById avec forUpdate renvoie la ligne', !!avant && avant.id === cible.id)

        const r = await updateOccurrence({ repo, id: cible.id, patch: { comment: SONDE }, user: { id: null } })
        verifier('returning renvoie la ligne modifiée', !!r.occurrence && r.occurrence.comment === SONDE)
        verifier('une ligne d\'historique est calculée', r.historyRows.length === 1,
          `champ : ${r.historyRows.map(h => h.field).join(', ')}`)
        verifier('historique écrit DANS la transaction', (await compterHist(trx)) === histAvant + 1)

        throw new Error('__ROLLBACK_VOULU__')
      })
    } catch (e) {
      if (e.message !== '__ROLLBACK_VOULU__') throw e
    }

    console.log('\n4. Après le rollback, hors transaction')
    const apres = await db('tickets').where({ id: cible.id }).first('comment', 'updated_at')
    verifier('le commentaire est intact', apres.comment === cible.comment,
      apres.comment === SONDE ? 'LA SONDE A SURVÉCU' : 'inchangé')
    verifier('updated_at est intact', String(apres.updated_at) === String(cible.updated_at))
    verifier('aucune ligne d\'historique en trop', (await compterHist()) === histAvant)
    const sondes = Number((await db('ticket_history').where('new_value', SONDE).count({ n: '*' }).first()).n)
    verifier('aucune trace de la sonde dans tout le journal', sondes === 0)

    console.log(`\n${echecs === 0 ? 'TOUT PASSE' : echecs + ' ECHEC(S)'}`)
  } finally {
    await db.destroy()
    process.exitCode = echecs ? 1 : 0
  }
}

main().catch((e) => {
  console.error('ERREUR :', String(e.message).replace(/:\/\/[^@]*@/, '://*****@'))
  process.exitCode = 1
})
