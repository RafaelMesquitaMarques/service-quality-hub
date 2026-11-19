// Routes des occurrences — la première tranche verticale de la couche API.
//
// Elle assemble les quatre pièces écrites séparément : `policy.js` dit qui a le
// droit, `authorize.js` pose la question au bon moment, `service.js` orchestre,
// `repository.js` parle SQL. Chacune est testée seule ; c'est ici qu'elles se
// touchent.
//
// À NE PAS CONFONDRE avec `tickets.js`, l'ancien module : celui-là passe par la
// clé de service, qui contourne la RLS, et porte ses propres contrôles. Les
// deux cohabitent le temps de la bascule ; rien n'appelle encore celui-ci.

const router = require('express').Router()
const { requireAuth } = require('../middleware/auth')
const { requireCan, requireCanOn } = require('../middleware/authorize')
const { getKnex } = require('../db/knex')
const { occurrenceRepository, VIEW } = require('../occurrences/repository')
const {
  createOccurrence, updateOccurrence, deleteOccurrence,
} = require('../occurrences/service')

// Toute la surface exige une session. `requireAuth` refuse déjà les comptes
// désactivés, et `policy.js` les refuse une seconde fois — une barrière qui
// dépend d'une seule vérification n'en est pas une.
router.use(requireAuth)

// Filtres acceptés sur la liste. Repris de `ticketApi.list` côté client :
// l'API doit couvrir ce que l'écran fait déjà, pas ce qu'on aimerait qu'il fasse.
const FILTRES_EGALITE = ['status', 'plant', 'brand', 'department', 'fiscal_year']
const LIMITE_DEFAUT = 100
const LIMITE_MAX = 1000

/**
 * GET /api/occurrences
 *
 * Pagination volontaire : le client charge aujourd'hui TOUTES les occurrences
 * d'une année fiscale en bouclant sur `.range()`, parce que PostgREST plafonne
 * à 1000 lignes. Le besoin de tout charger d'un coup est réel, mais il est
 * propre au tableau de bord : il aura son endpoint, qui fera la jointure côté
 * serveur. La liste, elle, pagine.
 */
router.get('/', requireCan('read', 'occurrences'), async (req, res) => {
  const db = getKnex()
  const { search, date_from, date_to } = req.query

  const limite = req.query.limit === 'all'
    ? LIMITE_MAX
    : Math.min(Number(req.query.limit) || LIMITE_DEFAUT, LIMITE_MAX)
  const decalage = Math.max(Number(req.query.offset) || 0, 0)

  const base = () => {
    let q = db(VIEW)
    for (const champ of FILTRES_EGALITE) {
      if (req.query[champ] !== undefined && req.query[champ] !== '') q = q.where(champ, req.query[champ])
    }
    if (date_from) q = q.where('issue_reception_date', '>=', date_from)
    if (date_to) q = q.where('issue_reception_date', '<=', date_to)
    // `ilike` est l'insensibilité à la casse de PostgreSQL. Sur la base cible,
    // dont la collation est déjà insensible, Knex produira un LIKE ordinaire.
    if (search) q = q.where('quality_issue', 'ilike', `%${search}%`)
    return q
  }

  const [{ count }] = await base().count({ count: '*' })

  // Tri secondaire sur l'identifiant : `issue_reception_date` n'est pas unique,
  // et sans départage la pagination peut répéter ou sauter des lignes.
  const occurrences = await base()
    .select('*')
    .orderBy('issue_reception_date', 'desc')
    .orderBy('id', 'asc')
    .limit(limite)
    .offset(decalage)

  res.json({
    occurrences,
    total: Number(count),
    limit: limite,
    offset: decalage,
  })
})

/** GET /api/occurrences/:id — lecture d'affichage, par la vue (coût calculé). */
router.get('/:id', requireCan('read', 'occurrences'), async (req, res) => {
  const occurrence = await getKnex()(VIEW).where({ id: req.params.id }).first()
  if (!occurrence) return res.status(404).json({ error: 'Occurrence introuvable' })
  res.json({ occurrence })
})

/** POST /api/occurrences — en-tête et lignes dans une seule transaction. */
router.post('/', requireCan('create', 'occurrences'), async (req, res) => {
  const { lines, ...header } = req.body || {}

  const resultat = await getKnex().transaction((trx) =>
    createOccurrence({
      repo: occurrenceRepository(trx),
      header,
      lines: Array.isArray(lines) ? lines : [],
      user: req.user,
    }))

  res.status(201).json(resultat)
})

/**
 * PATCH /api/occurrences/:id
 *
 * `requireCanOn` charge la ligne AVANT de décider : la règle dit « le créateur
 * modifie la sienne », elle ne peut pas se trancher sur le seul rôle. Le
 * service relit ensuite la ligne dans la transaction, avec un verrou — deux
 * lectures, mais la première décide et la seconde protège.
 */
router.patch('/:id',
  requireCanOn('update', 'occurrences', (req) =>
    getKnex()('tickets').where({ id: req.params.id }).first()),
  async (req, res) => {
    const resultat = await getKnex().transaction((trx) =>
      updateOccurrence({
        repo: occurrenceRepository(trx),
        id: req.params.id,
        patch: req.body || {},
        user: req.user,
      }))

    res.json({
      occurrence: resultat.occurrence,
      // Dire ce qui a été refusé plutôt que de l'ignorer en silence : un client
      // qui envoie `created_by` doit l'apprendre, pas le deviner.
      rejectedFields: resultat.rejectedFields,
      historyCount: resultat.historyRows.length,
    })
  })

/**
 * DELETE /api/occurrences/:id — réservé aux admins.
 *
 * La base cascade (lignes, photos, historique, liens de réunion), donc une
 * seule suppression suffit. Les fichiers du stockage, eux, ne participent à
 * aucune transaction : leurs chemins sont renvoyés pour être effacés APRÈS le
 * commit. Le câblage de cet effacement attend que la destination du stockage
 * soit tranchée — l'écrire maintenant serait du travail à jeter.
 */
router.delete('/:id', requireCan('delete', 'occurrences'), async (req, res) => {
  const resultat = await getKnex().transaction((trx) =>
    deleteOccurrence({ repo: occurrenceRepository(trx), id: req.params.id }))

  res.json({
    deleted: resultat.occurrence.id,
    storagePaths: resultat.storagePaths,
  })
})

module.exports = router
