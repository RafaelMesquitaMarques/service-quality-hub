// Branchement du modèle d'autorisation sur Express.
// À poser APRÈS `requireAuth`, qui remplit `req.user` et refuse déjà les
// comptes désactivés.
//
// Deux familles de règles, et c'est la distinction importante :
//
//   - celles qui ne dépendent que du rôle (« seuls les admins suppriment une
//     occurrence ») : décidables avant de toucher la base → `requireCan`.
//
//   - celles qui dépendent de la LIGNE visée (« le créateur modifie la sienne »,
//     « le propriétaire de ce rapport ») : il faut charger la ligne d'abord
//     → `requireCanOn`.
//
// Mélanger les deux est l'erreur facile, et elle est silencieuse : appeler
// `requireCan('update', 'occurrences')` sans ligne refuserait tous les `cpm`,
// y compris sur leurs propres occurrences, sans message clair. D'où le garde-fou
// ci-dessous : cette combinaison lève à la DÉFINITION de la route, donc au
// démarrage du serveur, pas au premier appel d'un utilisateur.

const { can, ForbiddenError } = require('../auth/policy')

// Couples action:ressource dont la décision dépend du contenu de la ligne.
const RECORD_DEPENDENT = new Set([
  'occurrences:update',
  'savedReports:read',
  'savedReports:create',
  'savedReports:update',
  'savedReports:delete',
  'users:update',
])

function isRecordDependent(action, resource) {
  return RECORD_DEPENDENT.has(`${resource}:${action}`)
}

/**
 * Garde pour les règles qui ne dépendent que du rôle.
 * Lève au démarrage si la règle visée a besoin de la ligne.
 */
function requireCan(action, resource) {
  if (isRecordDependent(action, resource)) {
    throw new Error(
      `authorize: « ${action} ${resource} » dépend de la ligne visée. ` +
      `Utiliser requireCanOn(action, resource, chargeur) pour charger la ligne d'abord.`)
  }
  return function (req, res, next) {
    if (!can(req.user, action, resource)) return next(new ForbiddenError(action, resource))
    next()
  }
}

/**
 * Garde pour les règles qui dépendent de la ligne.
 * @param load  async (req) => ligne | null
 * La ligne chargée est posée sur `req.record` pour éviter de la relire ensuite.
 *
 * Une ligne absente répond 404 — jamais 200. C'est la leçon du bogue des notes
 * de réunion : une écriture qui ne touche rien doit se voir.
 */
function requireCanOn(action, resource, load) {
  if (typeof load !== 'function') {
    throw new Error(`authorize: « ${action} ${resource} » exige une fonction de chargement.`)
  }
  return async function (req, res, next) {
    try {
      const record = await load(req)
      if (record == null) {
        return res.status(404).json({ error: 'Ressource introuvable' })
      }
      if (!can(req.user, action, resource, record)) {
        return next(new ForbiddenError(action, resource))
      }
      req.record = record
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Filtre une liste selon le droit de lecture ligne à ligne.
 * Utile pour les rapports enregistrés, où la visibilité se décide par ligne.
 * Un filtrage en base reste préférable quand c'est possible : celui-ci est le
 * filet, pas la passoire principale.
 */
function readableBy(user, resource, rows) {
  return (rows || []).filter(row => can(user, 'read', resource, row))
}

module.exports = { requireCan, requireCanOn, readableBy, isRecordDependent }
