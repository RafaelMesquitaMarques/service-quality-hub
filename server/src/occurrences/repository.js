// Le seul endroit de la couche occurrence qui parle SQL.
//
// Volontairement mince : tout ce qui est décision est dans service.js, qui ne
// connaît pas la base et se teste sans elle. Quand le moteur changera, c'est
// ici — et seulement ici — qu'il faudra regarder.
//
// Le dépôt est construit AUTOUR d'une transaction. L'appelant ouvre la
// transaction, passe `trx` ici, et la lecture, l'écriture et le journal
// partagent la même unité de travail.
//
//     await knex.transaction(async (trx) => {
//       const repo = occurrenceRepository(trx)
//       return updateOccurrence({ repo, id, patch, user })
//     })

// Règle du projet (voir CLAUDE.md) : les LECTURES d'affichage passent par la
// vue `tickets_with_cost`, qui porte le coût calculé ; les ÉCRITURES vont sur
// la table `tickets`. L'instantané pris avant une modification lit la TABLE :
// il sert à calculer la piste d'audit, donc il lui faut les valeurs réelles
// des colonnes, pas les colonnes dérivées de la vue.
const TABLE = 'tickets'
const VIEW = 'tickets_with_cost'
const HISTORY = 'ticket_history'

function occurrenceRepository(trx) {
  return {
    /**
     * Instantané avant modification, sur la table.
     * `forUpdate` verrouille la ligne jusqu'à la fin de la transaction : sans
     * lui, deux modifications simultanées calculent leur historique sur le même
     * état initial et la seconde écrase la première sans que rien ne le dise.
     * Knex traduit le verrou selon le dialecte.
     */
    async findById(id) {
      const row = await trx(TABLE).where({ id }).forUpdate().first()
      return row || null
    },

    /** Lecture d'affichage, avec le coût calculé. Hors transaction d'écriture. */
    async findForDisplay(id) {
      const row = await trx(VIEW).where({ id }).first()
      return row || null
    },

    /**
     * Renvoie la ligne modifiée, ou null si l'écriture n'a touché aucune ligne.
     * Ce null est significatif : le service en fait un 404. Une écriture qui ne
     * touche rien ne doit jamais ressembler à un succès.
     */
    async update(id, patch) {
      const rows = await trx(TABLE).where({ id }).update(patch).returning('*')
      return rows && rows.length ? rows[0] : null
    },

    /** Journal en ajout seul. Aucune mise à jour, aucune suppression. */
    async insertHistory(rows) {
      if (!rows || rows.length === 0) return 0
      await trx(HISTORY).insert(rows)
      return rows.length
    },
  }
}

module.exports = { occurrenceRepository, TABLE, VIEW, HISTORY }
