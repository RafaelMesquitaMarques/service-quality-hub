// Tests du calcul de la piste d'audit — logique pure, aucune base.
//
// Les règles testées ici sont subtiles et volontaires. Elles viennent de bogues
// réels corrigés côté client ; les perdre au passage sur le serveur fabriquerait
// soit du bruit dans le journal, soit des trous dedans.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import history from '../history.js'

const { diffRows, lineEventRow, sameValue, MAX_FIELD } = history

const base = { ticketId: 'occ-1', changedBy: 'u-1' }

describe('sameValue — ce qui compte comme une modification', () => {
  test('null, undefined et chaîne vide sont équivalents', () => {
    assert.equal(sameValue(null, undefined), true)
    assert.equal(sameValue(null, ''), true)
    assert.equal(sameValue(undefined, ''), true)
    assert.equal(sameValue('', ''), true)
  })

  test('un NUMERIC qui revient en texte ne fabrique pas de modification', () => {
    // PostgreSQL renvoie les colonnes NUMERIC sous forme de texte : sans cette
    // règle, rouvrir et resauvegarder sans rien changer créait des lignes.
    assert.equal(sameValue(3000, '3000.00'), true)
    assert.equal(sameValue('3000.00', 3000), true)
    assert.equal(sameValue('0.0', 0), true)
    assert.equal(sameValue(-12.5, '-12.50'), true)
  })

  test('deux nombres différents restent une modification', () => {
    assert.equal(sameValue(3000, 3000.01), false)
    assert.equal(sameValue(0, 1), false)
  })

  test('zéro n est pas du vide', () => {
    // Un coût de 0 est une valeur saisie, pas une absence de saisie.
    assert.equal(sameValue(0, ''), false)
    assert.equal(sameValue(0, null), false)
    assert.equal(sameValue(null, 0), false)
  })

  test('le texte se compare en texte', () => {
    assert.equal(sameValue('Pièce manquante', 'Pièce manquante'), true)
    assert.equal(sameValue('Pièce manquante', 'Pièce abîmée'), false)
    assert.equal(sameValue('abc', 'ABC'), false)
  })

  test('les booléens', () => {
    assert.equal(sameValue(true, true), true)
    assert.equal(sameValue(false, true), false)
    assert.equal(sameValue(true, 'true'), true)
  })
})

describe('diffRows', () => {
  test('ne journalise que ce qui a changé', () => {
    const rows = diffRows({
      ...base,
      before: { status: 'service_desk', quality_issue: 'Porte rayée', cost_approx: 100 },
      after:  { status: 'quality_meeting', quality_issue: 'Porte rayée' },
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].field, 'status')
    assert.equal(rows[0].old_value, 'service_desk')
    assert.equal(rows[0].new_value, 'quality_meeting')
  })

  test('un champ absent de la demande n est pas une modification', () => {
    // `after` ne contient que ce qui a été demandé : le reste est intouché.
    const rows = diffRows({
      ...base,
      before: { status: 'a', quality_issue: 'x' },
      after:  { status: 'a' },
    })
    assert.deepEqual(rows, [])
  })

  test('porte l auteur et l occurrence', () => {
    const [row] = diffRows({ ...base, before: { s: 1 }, after: { s: 2 } })
    assert.equal(row.ticket_id, 'occ-1')
    assert.equal(row.changed_by, 'u-1')
  })

  test('l auteur ne vient jamais de la demande', () => {
    // changedBy est posé par le serveur depuis la session. Omis, il reste null
    // plutôt que de prendre une valeur fournie par l appelant.
    const [row] = diffRows({ ticketId: 'occ-1', before: { s: 1 }, after: { s: 2 } })
    assert.equal(row.changed_by, null)
  })

  test('les valeurs partent en texte, null reste null', () => {
    const rows = diffRows({
      ...base,
      before: { cost_approx: null, affected_qty: 2 },
      after:  { cost_approx: 1250.5, affected_qty: null },
    })
    const parChamp = Object.fromEntries(rows.map(r => [r.field, r]))
    assert.equal(parChamp.cost_approx.old_value, null)
    assert.equal(parChamp.cost_approx.new_value, '1250.5')
    assert.equal(parChamp.affected_qty.old_value, '2')
    assert.equal(parChamp.affected_qty.new_value, null)
  })

  describe('champs jamais journalisés', () => {
    test('updated_at, horodatage technique', () => {
      const rows = diffRows({
        ...base,
        before: { updated_at: '2026-01-01' },
        after:  { updated_at: '2026-11-19' },
      })
      assert.deepEqual(rows, [])
    })

    test('les champs fiscaux, qui sont dérivés de la date', () => {
      // Journaliser les trois ferait quatre lignes pour une seule modification
      // réelle. La date, elle, est bien tracée.
      const rows = diffRows({
        ...base,
        before: { issue_reception_date: '2026-10-30', fiscal_year: 2026, fiscal_month: 11, date_yyyy_mm: '2026-10' },
        after:  { issue_reception_date: '2026-12-02', fiscal_year: 2027, fiscal_month: 1,  date_yyyy_mm: '2026-12' },
      })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].field, 'issue_reception_date')
    })
  })

  describe('lignes d occurrence', () => {
    test('le préfixe situe la modification sur une ligne', () => {
      const [row] = diffRows({
        ...base, prefix: 'line:', note: 'Tiroir coincé',
        before: { cost_approx: 100 },
        after:  { cost_approx: 250 },
      })
      assert.equal(row.field, 'line:cost_approx')
      assert.equal(row.note, 'Tiroir coincé')
    })

    test('sans note, la clé est absente plutôt que nulle', () => {
      const [row] = diffRows({ ...base, before: { s: 1 }, after: { s: 2 } })
      assert.equal('note' in row, false)
    })

    test('le nom du champ est borné à la longueur de la colonne', () => {
      const longName = 'x'.repeat(80)
      const [row] = diffRows({
        ...base, prefix: 'line:',
        before: { [longName]: 'a' },
        after:  { [longName]: 'b' },
      })
      assert.equal(row.field.length, MAX_FIELD)
      assert.ok(row.field.startsWith('line:'))
    })
  })

  describe('entrées douteuses', () => {
    test('un état manquant ne journalise rien plutôt que de tout journaliser', () => {
      assert.deepEqual(diffRows({ ...base, before: null, after: { s: 1 } }), [])
      assert.deepEqual(diffRows({ ...base, before: { s: 1 }, after: null }), [])
      assert.deepEqual(diffRows({ ...base, before: undefined, after: undefined }), [])
    })
    test('une demande vide ne journalise rien', () => {
      assert.deepEqual(diffRows({ ...base, before: { s: 1 }, after: {} }), [])
    })
  })
})

describe('lineEventRow', () => {
  test('un ajout met l intitulé dans new_value', () => {
    const row = lineEventRow({ ...base, kind: 'line_added', label: 'Panneau fendu' })
    assert.equal(row.field, 'line_added')
    assert.equal(row.old_value, null)
    assert.equal(row.new_value, 'Panneau fendu')
  })

  test('une suppression le met dans old_value', () => {
    const row = lineEventRow({ ...base, kind: 'line_removed', label: 'Panneau fendu' })
    assert.equal(row.old_value, 'Panneau fendu')
    assert.equal(row.new_value, null)
  })

  test('une ligne sans intitulé reste journalisable', () => {
    // Une ligne sans intitulé est une réclamation annulée : c est voulu, et ça
    // ne doit pas empêcher de tracer sa suppression.
    const row = lineEventRow({ ...base, kind: 'line_removed' })
    assert.equal(row.old_value, null)
  })

  test('un évènement inconnu lève plutôt que de passer en silence', () => {
    assert.throws(() => lineEventRow({ ...base, kind: 'line_exploded' }), /inconnu/)
  })
})
