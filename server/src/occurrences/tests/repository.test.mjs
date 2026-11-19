// Tests du dépôt d'occurrence.
//
// Portée limitée, et c'est assumé : ce module est le seul de la couche qui
// parle SQL, donc le seul qu'on ne peut pas vraiment vérifier sans base. Ce qui
// est testable ici, c'est sa forme — que le module se charge, qu'il expose ce
// que le service attend, et qu'il vise les bonnes relations.
//
// Le SQL lui-même sera vérifié contre une vraie base dès qu'une connexion sera
// disponible. Tant que ce n'est pas fait, ne pas considérer ce module comme
// couvert.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import repository from '../repository.js'
import service from '../service.js'

const { occurrenceRepository, TABLE, VIEW, HISTORY } = repository

describe('forme du dépôt', () => {
  test('expose exactement ce que le service appelle', () => {
    const repo = occurrenceRepository(() => {})
    // Le service n'utilise que ces trois méthodes : si l'une disparaît, il
    // échouerait à l'exécution, pas au chargement.
    for (const m of ['findById', 'update', 'insertHistory']) {
      assert.equal(typeof repo[m], 'function', m)
    }
    assert.equal(typeof repo.findForDisplay, 'function')
  })

  test('les méthodes du service existent toutes sur le dépôt', () => {
    // Garde-fou contre une dérive entre les deux modules.
    const repo = occurrenceRepository(() => {})
    const attendues = ['findById', 'update', 'insertHistory']
    const manquantes = attendues.filter(m => typeof repo[m] !== 'function')
    assert.deepEqual(manquantes, [])
    assert.equal(typeof service.updateOccurrence, 'function')
  })
})

describe('relations visées', () => {
  test('les écritures vont sur la table, pas sur la vue', () => {
    // Règle du projet : lecture d'affichage par la vue (coût calculé),
    // écriture sur la table.
    assert.equal(TABLE, 'tickets')
    assert.equal(VIEW, 'tickets_with_cost')
    assert.notEqual(TABLE, VIEW)
  })

  test('le journal a sa propre table', () => {
    assert.equal(HISTORY, 'ticket_history')
  })
})

describe('insertHistory', () => {
  test('une liste vide ne touche pas la base', async () => {
    // Sans ce court-circuit, Knex produirait un INSERT sans valeurs.
    let appele = false
    const trx = () => { appele = true; return {} }
    const repo = occurrenceRepository(trx)
    assert.equal(await repo.insertHistory([]), 0)
    assert.equal(await repo.insertHistory(null), 0)
    assert.equal(appele, false)
  })
})
