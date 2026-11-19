// Opérations métier sur les occurrences.
//
// Le service ne connaît ni Knex, ni Express, ni la base : il reçoit un
// « dépôt » (repository) et orchestre. C'est ce qui le rend testable sans
// connexion, et c'est aussi ce qui rendra le changement de moteur indolore —
// seul le dépôt parle SQL.
//
// Ce que ça corrige par rapport à aujourd'hui : côté navigateur, modifier une
// occurrence fait trois allers-retours indépendants (lire l'état avant, écrire,
// journaliser). Si le troisième échoue, la modification a eu lieu sans trace.
// Ici les trois tiennent dans la transaction ouverte par l'appelant : soit tout,
// soit rien.

const { diffRows } = require('./history')

class NotFoundError extends Error {
  constructor(message = 'Occurrence introuvable') {
    super(message)
    this.name = 'NotFoundError'
    this.status = 404
  }
}

// Champs qu'une requête ne peut jamais fixer, quoi qu'elle envoie.
//
// `created_by` est le plus important : la règle d'autorisation dit « le
// créateur modifie la sienne », donc pouvoir réécrire ce champ reviendrait à
// s'attribuer le droit de modification. Aujourd'hui le navigateur transmet sa
// charge utile telle quelle et rien ne l'en empêche.
//
// Les champs fiscaux sont dérivés de `issue_reception_date` par un déclencheur
// de base (migration 2026-10-26) : les laisser passer ouvrirait une seconde
// source de vérité, qui divergerait.
const IMMUTABLE_FIELDS = new Set([
  'id',
  'occurrence_no',
  'created_by',
  'created_at',
  'fiscal_year',
  'fiscal_month',
  'date_yyyy_mm',
])

/** Retire les champs non modifiables. Renvoie aussi ce qui a été écarté. */
function sanitizePatch(patch) {
  const clean = {}
  const rejected = []
  for (const [k, v] of Object.entries(patch || {})) {
    if (IMMUTABLE_FIELDS.has(k)) rejected.push(k)
    else clean[k] = v
  }
  return { clean, rejected }
}

/**
 * Modifie une occurrence et journalise la modification, dans la même unité de
 * travail que l'appelant.
 *
 * @param repo  { findById, update, insertHistory } — le dépôt, lié à la
 *              transaction en cours par l'appelant
 * @param id    occurrence visée
 * @param patch modifications demandées
 * @param user  { id } — auteur, pris de la session, jamais de la requête
 * @param now   horloge injectable, pour que les tests soient déterministes
 * @returns { occurrence, historyRows, rejectedFields }
 * @throws NotFoundError si l'occurrence n'existe pas, ou si l'écriture ne
 *         touche aucune ligne.
 */
async function updateOccurrence({ repo, id, patch, user, now = () => new Date().toISOString() }) {
  const before = await repo.findById(id)
  if (!before) throw new NotFoundError()

  const { clean, rejected } = sanitizePatch(patch)

  // Une demande vide, ou qui ne contenait que des champs non modifiables, n'est
  // pas une erreur : on renvoie l'état courant sans rien écrire ni journaliser.
  if (Object.keys(clean).length === 0) {
    return { occurrence: before, historyRows: [], rejectedFields: rejected }
  }

  const updated = await repo.update(id, { ...clean, updated_at: now() })

  // Zéro ligne touchée alors que la lecture avait réussi : la ligne a disparu
  // entre-temps, ou une règle de base a refusé l'écriture sans lever d'erreur.
  // Dans les deux cas c'est 404, jamais un succès silencieux.
  if (!updated) throw new NotFoundError()

  // L'historique se calcule sur ce qui a été DEMANDÉ, pas sur la ligne
  // renvoyée : sinon les champs recalculés par un déclencheur apparaîtraient
  // comme des modifications de l'utilisateur.
  const historyRows = diffRows({
    ticketId: id,
    changedBy: user ? user.id : null,
    before,
    after: clean,
  })

  if (historyRows.length > 0) {
    // Pas de try/catch ici, volontairement : un échec doit remonter et faire
    // annuler la transaction. Une modification sans trace vaut moins qu'une
    // modification refusée.
    await repo.insertHistory(historyRows)
  }

  return { occurrence: updated, historyRows, rejectedFields: rejected }
}

/**
 * Crée une occurrence et ses lignes, dans la même unité de travail.
 *
 * Aujourd'hui cette séquence est écrite dans TROIS composants (TicketModal,
 * MobileTicketForm, MobileNewOccurrence), chacun enchaînant des insertions
 * indépendantes : une panne entre l'en-tête et les lignes laisse une occurrence
 * vide en base.
 *
 * Les PHOTOS restent volontairement HORS de la transaction. Leur dépôt passe
 * par un stockage de fichiers, qui ne participe à aucune transaction SQL, et
 * l'application traite déjà leur échec comme non fatal : perdre une photo ne
 * doit pas faire perdre la réclamation. L'appelant les traite après coup.
 *
 * @returns { occurrence, lines }
 */
async function createOccurrence({ repo, header, lines = [], user, now = () => new Date().toISOString() }) {
  const { clean } = sanitizePatch(header)

  // L'auteur vient de la session. Le refuser dans la charge utile puis le poser
  // ici évite qu'une requête s'attribue la paternité d'une occurrence — et donc,
  // par la règle « le créateur modifie la sienne », le droit de la modifier.
  const aEcrire = { ...clean, created_by: user ? user.id : null, updated_at: now() }

  const occurrence = await repo.insertOccurrence(aEcrire)
  if (!occurrence) throw new Error('La création n\'a renvoyé aucune ligne')

  let creees = []
  if (lines.length > 0) {
    const aInserer = lines.map((l, i) => {
      const { clean: ligne } = sanitizePatch(l)
      delete ligne.occurrence_id          // jamais depuis la requête
      delete ligne.photos                 // côté client uniquement
      return { ...ligne, occurrence_id: occurrence.id, sort_order: ligne.sort_order ?? i }
    })
    creees = await repo.insertLines(aInserer)
  }

  return { occurrence, lines: creees }
}

/**
 * Supprime une occurrence.
 *
 * La base fait déjà la cascade : `occurrence_lines`, `ticket_photos`,
 * `ticket_history` et `meeting_tickets` portent toutes
 * `ON DELETE CASCADE` vers `tickets`. Une seule suppression suffit donc, et
 * elle est atomique par construction.
 *
 * Le client, lui, supprime les trois tables à la main — sans vérifier l'erreur
 * des deux premières. C'est précisément cette duplication qui crée le risque
 * d'orphelins que la cascade évitait déjà.
 *
 * Les FICHIERS du stockage sont retournés, pas supprimés : il faut les effacer
 * APRÈS le commit. Le client fait l'inverse — il efface les fichiers d'abord,
 * si bien qu'un échec ensuite laisse des vignettes cassées. Dans l'autre ordre,
 * le pire cas est un fichier orphelin, qui ne coûte que de l'espace.
 *
 * @returns { occurrence, storagePaths }
 */
async function deleteOccurrence({ repo, id }) {
  const storagePaths = await repo.findPhotoPaths(id)
  const occurrence = await repo.deleteOccurrence(id)
  if (!occurrence) throw new NotFoundError()
  return { occurrence, storagePaths }
}

module.exports = {
  updateOccurrence,
  createOccurrence,
  deleteOccurrence,
  sanitizePatch,
  NotFoundError,
  IMMUTABLE_FIELDS,
}
