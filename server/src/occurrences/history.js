// Calcul de la piste d'audit — logique pure, sans base de données.
//
// Portage de `logTicketHistory` / `logLineHistory` / `logLineEvent`, qui vivent
// aujourd'hui dans le navigateur (client/src/services/api.js). Deux raisons de
// les déplacer :
//
//   1. Un journal d'audit alimenté par le client n'est pas un journal d'audit :
//      c'est l'audité qui décide de ce qui y entre.
//
//   2. Côté client, l'insertion est enveloppée dans un try/catch qui se contente
//      d'un console.warn. Si elle échoue, la modification a déjà eu lieu et la
//      trace est perdue sans bruit. Côté serveur, le calcul ci-dessous et
//      l'écriture qu'il alimente tiennent dans la même transaction : soit les
//      deux, soit aucun des deux.
//
// Ce module ne fait que CALCULER les lignes à écrire. L'écriture appartient au
// service, dans la transaction.

// La colonne `field` de ticket_history est bornée.
const MAX_FIELD = 50

// Champs jamais journalisés :
//   - updated_at : horodatage technique, réécrit à chaque sauvegarde ;
//   - fiscal_year / fiscal_month / date_yyyy_mm : DÉRIVÉS de
//     issue_reception_date. Les journaliser ferait trois lignes de bruit pour
//     une seule modification réelle — et la date, elle, est bien tracée, donc
//     la dérivation reste reconstituable.
const IGNORED = new Set(['updated_at', 'fiscal_year', 'fiscal_month', 'date_yyyy_mm'])

/**
 * Deux valeurs sont-elles « la même » pour l'historique ?
 *
 * Règles reprises telles quelles du client, elles sont voulues :
 *   - null, undefined et la chaîne vide sont équivalents (passer de null à ""
 *     n'est pas une modification) ;
 *   - deux valeurs numériques se comparent en nombres : PostgreSQL renvoie les
 *     colonnes NUMERIC sous forme de texte, donc 3000 et "3000.00" sont la même
 *     chose. Sans cette règle, rouvrir et resauvegarder une occurrence sans
 *     rien changer fabriquait des lignes d'historique.
 */
function sameValue(a, b) {
  const na = a === null || a === undefined ? '' : a
  const nb = b === null || b === undefined ? '' : b
  if (na === '' && nb === '') return true
  const fa = Number(na)
  const fb = Number(nb)
  const bothNumeric =
    String(na).trim() !== '' && String(nb).trim() !== '' &&
    !Number.isNaN(fa) && !Number.isNaN(fb)
  if (bothNumeric) return fa === fb
  return String(na) === String(nb)
}

/** null et undefined restent null ; tout le reste devient du texte. */
function asText(v) {
  return v === null || v === undefined ? null : String(v)
}

/**
 * Lignes d'historique pour une modification.
 *
 * @param ticketId  occurrence concernée
 * @param changedBy identifiant de l'auteur (jamais fourni par le client :
 *                  il vient de la session côté serveur)
 * @param before    état avant, tel que lu dans la transaction
 * @param after     modifications demandées (et elles seules)
 * @param prefix    'line:' pour une ligne d'occurrence
 * @param note      intitulé de la ligne, pour situer la modification
 * @returns {Array} lignes prêtes à insérer, vide si rien n'a changé
 */
function diffRows({ ticketId, changedBy = null, before, after, prefix = '', note = null }) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return []

  const rows = []
  for (const field of Object.keys(after)) {
    if (IGNORED.has(field)) continue
    if (sameValue(before[field], after[field])) continue
    rows.push({
      ticket_id: ticketId,
      changed_by: changedBy,
      field: (prefix + field).slice(0, MAX_FIELD),
      old_value: asText(before[field]),
      new_value: asText(after[field]),
      ...(note === null || note === undefined ? {} : { note: String(note) }),
    })
  }
  return rows
}

const LINE_EVENTS = new Set(['line_added', 'line_removed'])

/**
 * Ajout ou suppression d'une ligne : l'intitulé part dans old_value pour une
 * suppression, dans new_value pour un ajout, pour que la lecture du journal
 * dise dans quel sens la chose est allée.
 */
function lineEventRow({ ticketId, changedBy = null, kind, label = null }) {
  if (!LINE_EVENTS.has(kind)) {
    throw new Error(`history: évènement de ligne inconnu « ${kind} »`)
  }
  const val = asText(label)
  return {
    ticket_id: ticketId,
    changed_by: changedBy,
    field: kind,
    old_value: kind === 'line_removed' ? val : null,
    new_value: kind === 'line_added' ? val : null,
  }
}

module.exports = { diffRows, lineEventRow, sameValue, IGNORED, MAX_FIELD }
