// Modèle d'autorisation de l'application — logique pure, sans base de données.
//
// C'est la traduction en code des 44 politiques RLS relevées le 2026-11-19
// (voir docs/migration-azure/02-modele-autorisation.md). Tant que le front
// parle directement à PostgREST, la RLS reste la seule barrière ; dès que la
// couche API sert les données, c'est ce fichier qui décide, et la RLS ne sera
// plus là pour rattraper une règle oubliée.
//
// Deux principes :
//   1. Refus par défaut. Une ressource ou une action inconnue est refusée.
//   2. Aucune dépendance. Ce module est testable sans base ni serveur
//      (voir tests/policy.test.mjs, `npm run test:policy`).

const ROLES = ['admin', 'manager', 'cpm', 'service_desk', 'viewer']

// Rôles encadrants : ceux qui peuvent agir sur le travail d'autrui.
const ENCADRANT = ['admin', 'manager', 'service_desk']

const ACTIONS = ['read', 'create', 'update', 'delete']

// ─── Prédicats ───────────────────────────────────────────────────────────────
// Chacun reçoit (user, record) et renvoie un booléen.

const authenticated = () => true
const never = () => false
const roleIn = (...roles) => (user) => roles.includes(user.role)
const adminOnly = roleIn('admin')
const adminOrManager = roleIn('admin', 'manager')
const encadrant = roleIn(...ENCADRANT)
const notViewer = (user) => user.role !== 'viewer'

// Une occurrence se modifie par son créateur, ou par un rôle encadrant.
// Conséquence assumée : les 2 072 occurrences importées ont `created_by` à NULL,
// donc un `cpm` ne peut pas les modifier — seuls les encadrants le peuvent.
//
// Le `viewer` est exclu même de ses propres occurrences : « lecture seule »
// ne souffre pas d'exception, sinon la règle se contredit (il ne peut pas en
// créer). La politique RLS, elle, garde la clause `auth.uid() = created_by`
// sans exclure le viewer — inatteignable aujourd'hui (aucune des 2 565
// occurrences n'a été créée par un viewer, vérifié le 2026-11-19), mais elle
// le redeviendrait si un compte ayant créé des occurrences était rétrogradé
// en viewer. À resserrer côté base lors d'une prochaine migration.
const ownerOrEncadrant = (user, record) =>
  notViewer(user) && (
    (record != null && record.created_by != null && record.created_by === user.id) ||
    ENCADRANT.includes(user.role))

// ─── Rapports enregistrés ────────────────────────────────────────────────────
// Le modèle le plus fin, repris tel quel : il était déjà cohérent côté RLS.
const isOwner = (user, record) => record != null && record.owner_id === user.id
const isShared = (record) => record != null && record.visibility === 'shared'

const savedReportRead = (user, record) => isOwner(user, record) || isShared(record)

// La politique RLS distingue deux choses que `can()` seul ne peut pas exprimer :
//   USING      — quelles lignes vous pouvez toucher
//   WITH CHECK — dans quel état la ligne a le droit de finir
// Un `cpm` propriétaire d'un rapport partagé peut donc le modifier (USING passe)
// mais pas le laisser partagé (WITH CHECK échoue). D'où deux fonctions : `can()`
// répond à la première question, `canSetVisibility()` à la seconde.
const savedReportCreate = (user, record) =>
  isOwner(user, record) && canSetVisibility(user, record && record.visibility)
const savedReportUpdate = (user, record) =>
  isOwner(user, record) || (isShared(record) && adminOnly(user))
const savedReportDelete = (user, record) => isOwner(user, record) || adminOnly(user)

/** Partager un rapport est réservé aux admins et managers. Privé : tout le monde. */
function canSetVisibility(user, visibility) {
  if (visibility !== 'shared') return true
  return adminOrManager(user)
}

// Un compte modifie son propre profil ; un admin modifie n'importe lequel.
// L'élévation de rôle est refusée séparément (voir canChangeRole plus bas) :
// aujourd'hui le déclencheur user_profiles_guard_privileges s'en charge, et il
// ne survivra pas au changement de base.
const selfOrAdmin = (user, record) =>
  (record != null && record.id === user.id) || adminOnly(user)

// ─── La matrice ──────────────────────────────────────────────────────────────

const RULES = {
  // Référentiels : tout le monde lit, seuls les admins écrivent.
  brands:       { read: authenticated, create: adminOnly, update: adminOnly, delete: adminOnly },
  categories:   { read: authenticated, create: adminOnly, update: adminOnly, delete: adminOnly },
  clients:      { read: authenticated, create: adminOnly, update: adminOnly, delete: adminOnly },
  departments:  { read: authenticated, create: adminOnly, update: adminOnly, delete: adminOnly },
  plants:       { read: authenticated, create: adminOnly, update: adminOnly, delete: adminOnly },

  occurrences:  { read: authenticated, create: notViewer, update: ownerOrEncadrant, delete: adminOnly },

  // Les lignes portent les coûts : interdites au viewer en écriture.
  lines:        { read: authenticated, create: notViewer, update: notViewer, delete: notViewer },
  photos:       { read: authenticated, create: notViewer, update: notViewer, delete: notViewer },

  // Journal d'audit : en ajout seul, et l'ajout est un effet de bord de
  // l'écriture côté serveur — jamais une requête du client.
  history:      { read: authenticated, create: never, update: never, delete: never },

  meetings:     { read: authenticated, create: encadrant, update: encadrant, delete: encadrant },
  meetingLinks: { read: authenticated, create: notViewer, update: notViewer, delete: notViewer },
  meetingActions: { read: authenticated, create: notViewer, update: notViewer, delete: notViewer },

  revenue:      { read: authenticated, create: adminOrManager, update: adminOrManager, delete: adminOrManager },

  savedReports: { read: savedReportRead, create: savedReportCreate, update: savedReportUpdate, delete: savedReportDelete },

  users:        { read: authenticated, create: adminOnly, update: selfOrAdmin, delete: adminOnly },
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

/**
 * @param user   { id, role, active } — tel que le middleware d'authentification le pose
 * @param action 'read' | 'create' | 'update' | 'delete'
 * @param resource  une clé de RULES
 * @param record la ligne visée, quand la règle dépend de son contenu
 *               (propriétaire, visibilité). Facultatif sinon.
 */
function can(user, action, resource, record = null) {
  // Refus par défaut : un appelant sans profil, un compte désactivé, une
  // action ou une ressource inconnue.
  if (!user || typeof user !== 'object') return false
  if (user.active === false) return false
  if (!ROLES.includes(user.role)) return false
  if (!ACTIONS.includes(action)) return false

  const rule = Object.prototype.hasOwnProperty.call(RULES, resource) ? RULES[resource] : null
  if (!rule) return false

  const predicate = rule[action]
  if (typeof predicate !== 'function') return false

  return predicate(user, record) === true
}

/**
 * Seul un admin change le rôle d'un compte, et jamais le sien : sans cette
 * seconde condition, un admin unique peut se rétrograder et verrouiller
 * l'administration. Reprend le garde-fou du déclencheur
 * user_profiles_guard_privileges, qui ne suivra pas au changement de base.
 */
function canChangeRole(user, targetUserId) {
  if (!can(user, 'update', 'users', { id: targetUserId })) return false
  if (!adminOnly(user)) return false
  return user.id !== targetUserId
}

class ForbiddenError extends Error {
  constructor(action, resource) {
    super(`Action refusée : ${action} sur ${resource}`)
    this.name = 'ForbiddenError'
    this.status = 403
  }
}

/** Variante qui lève, pour les routes. */
function assertCan(user, action, resource, record = null) {
  if (!can(user, action, resource, record)) throw new ForbiddenError(action, resource)
  return true
}

module.exports = {
  can,
  assertCan,
  canChangeRole,
  canSetVisibility,
  ForbiddenError,
  ROLES,
  ENCADRANT,
  ACTIONS,
  RESOURCES: Object.keys(RULES),
}
