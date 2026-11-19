// Tests du service d'occurrence — aucune base : le dépôt est un double qui
// enregistre ce qu'on lui demande.
//
// Ce qui est testé ici, c'est l'ORCHESTRATION : l'ordre des opérations, ce qui
// est écrit, ce qui est refusé, et ce qui remonte en erreur. C'est exactement
// la partie que les trois allers-retours du navigateur font mal aujourd'hui.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import service from '../service.js'

const { updateOccurrence, sanitizePatch, NotFoundError, IMMUTABLE_FIELDS } = service

const user = { id: 'u-cpm', role: 'cpm' }
const HORLOGE = () => '2026-11-19T12:00:00.000Z'

/** Dépôt factice : enregistre les appels, renvoie ce qu'on lui a dit. */
function fakeRepo({ row = null, updated = undefined, onInsert = null } = {}) {
  const calls = []
  return {
    calls,
    async findById(id) { calls.push(['findById', id]); return row },
    async update(id, patch) {
      calls.push(['update', id, patch])
      if (updated === undefined) return { ...row, ...patch }
      return updated
    },
    async insertHistory(rows) {
      calls.push(['insertHistory', rows])
      if (onInsert) return onInsert(rows)
      return rows.length
    },
  }
}

const occurrence = {
  id: 'occ-1',
  created_by: 'u-autre',
  status: 'service_desk',
  quality_issue: 'Porte rayée',
  cost_approx: 100,
}

describe('occurrence absente', () => {
  test('lève une 404 et n écrit rien', async () => {
    const repo = fakeRepo({ row: null })
    await assert.rejects(
      () => updateOccurrence({ repo, id: 'occ-inconnue', patch: { status: 'x' }, user }),
      (e) => e instanceof NotFoundError && e.status === 404)
    assert.deepEqual(repo.calls.map(c => c[0]), ['findById'])
  })

  test('une écriture qui ne touche aucune ligne est une 404, pas un succès', async () => {
    // La leçon des notes de réunion : sous RLS, un UPDATE refusé ne lève pas
    // d erreur, il modifie zéro ligne.
    const repo = fakeRepo({ row: occurrence, updated: null })
    await assert.rejects(
      () => updateOccurrence({ repo, id: 'occ-1', patch: { status: 'quality_meeting' }, user }),
      (e) => e instanceof NotFoundError)
    // Rien n a été journalisé : pas de trace d une modification qui n a pas eu lieu.
    assert.equal(repo.calls.some(c => c[0] === 'insertHistory'), false)
  })
})

describe('champs non modifiables', () => {
  test('created_by est refusé — sinon on s attribue le droit de modifier', async () => {
    // La règle d autorisation dit « le créateur modifie la sienne ». Pouvoir
    // réécrire created_by reviendrait à se donner ce droit.
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { status: 'quality_meeting', created_by: user.id },
    })
    const [, , patchEcrit] = repo.calls.find(c => c[0] === 'update')
    assert.equal('created_by' in patchEcrit, false)
    assert.deepEqual(r.rejectedFields, ['created_by'])
  })

  test('les champs dérivés et l identité sont refusés aussi', async () => {
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { id: 'autre', occurrence_no: 9999, fiscal_year: 2030, fiscal_month: 1, date_yyyy_mm: '2030-01', status: 'completed' },
    })
    const [, , patchEcrit] = repo.calls.find(c => c[0] === 'update')
    assert.deepEqual(Object.keys(patchEcrit).sort(), ['status', 'updated_at'])
    assert.deepEqual(r.rejectedFields.sort(), ['date_yyyy_mm', 'fiscal_month', 'fiscal_year', 'id', 'occurrence_no'])
  })

  test('sanitizePatch tolère une charge utile absente', () => {
    assert.deepEqual(sanitizePatch(null), { clean: {}, rejected: [] })
    assert.deepEqual(sanitizePatch(undefined), { clean: {}, rejected: [] })
  })

  test('la liste couvre identité, provenance et champs dérivés', () => {
    for (const f of ['id', 'occurrence_no', 'created_by', 'created_at', 'fiscal_year', 'fiscal_month', 'date_yyyy_mm']) {
      assert.ok(IMMUTABLE_FIELDS.has(f), f)
    }
  })
})

describe('demande sans effet', () => {
  test('une charge utile vide ne déclenche ni écriture ni journal', async () => {
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({ repo, id: 'occ-1', patch: {}, user })
    assert.deepEqual(repo.calls.map(c => c[0]), ['findById'])
    assert.equal(r.occurrence, occurrence)
    assert.deepEqual(r.historyRows, [])
  })

  test('une charge utile faite uniquement de champs refusés non plus', async () => {
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({ repo, id: 'occ-1', patch: { created_by: user.id }, user })
    assert.deepEqual(repo.calls.map(c => c[0]), ['findById'])
    assert.deepEqual(r.rejectedFields, ['created_by'])
  })

  test('une valeur identique écrit, mais ne journalise pas', async () => {
    // Resauvegarder sans rien changer ne doit pas gonfler la piste d audit.
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { cost_approx: '100.00' },   // NUMERIC revenu en texte
    })
    assert.equal(repo.calls.some(c => c[0] === 'update'), true)
    assert.equal(repo.calls.some(c => c[0] === 'insertHistory'), false)
    assert.deepEqual(r.historyRows, [])
  })
})

describe('modification normale', () => {
  test('lit, écrit, puis journalise — dans cet ordre', async () => {
    const repo = fakeRepo({ row: occurrence })
    await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { status: 'quality_meeting' },
    })
    assert.deepEqual(repo.calls.map(c => c[0]), ['findById', 'update', 'insertHistory'])
  })

  test('l horodatage de modification est posé par le serveur', async () => {
    const repo = fakeRepo({ row: occurrence })
    await updateOccurrence({ repo, id: 'occ-1', user, now: HORLOGE, patch: { status: 'completed' } })
    const [, , patchEcrit] = repo.calls.find(c => c[0] === 'update')
    assert.equal(patchEcrit.updated_at, '2026-11-19T12:00:00.000Z')
  })

  test('l auteur vient de la session, jamais de la requête', async () => {
    const repo = fakeRepo({ row: occurrence })
    await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { status: 'completed', changed_by: 'quelqu-un-dautre' },
    })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertHistory')
    for (const l of lignes) assert.equal(l.changed_by, 'u-cpm')
  })

  test('sans session, l auteur reste nul plutôt que deviné', async () => {
    const repo = fakeRepo({ row: occurrence })
    await updateOccurrence({ repo, id: 'occ-1', user: null, now: HORLOGE, patch: { status: 'completed' } })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertHistory')
    assert.equal(lignes[0].changed_by, null)
  })

  test('le journal porte l ancienne et la nouvelle valeur', async () => {
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { status: 'quality_meeting', cost_approx: 250 },
    })
    const parChamp = Object.fromEntries(r.historyRows.map(l => [l.field, l]))
    assert.equal(parChamp.status.old_value, 'service_desk')
    assert.equal(parChamp.status.new_value, 'quality_meeting')
    assert.equal(parChamp.cost_approx.old_value, '100')
    assert.equal(parChamp.cost_approx.new_value, '250')
  })

  test('updated_at n apparaît pas dans le journal', async () => {
    const repo = fakeRepo({ row: occurrence })
    const r = await updateOccurrence({ repo, id: 'occ-1', user, now: HORLOGE, patch: { status: 'completed' } })
    assert.equal(r.historyRows.some(l => l.field === 'updated_at'), false)
  })

  test('le journal se calcule sur la demande, pas sur la ligne renvoyée', async () => {
    // La base recalcule les champs fiscaux par déclencheur. Les lire sur la
    // ligne renvoyée les ferait passer pour des modifications de l utilisateur.
    const repo = fakeRepo({
      row: { ...occurrence, issue_reception_date: '2026-10-30', fiscal_year: 2026 },
      updated: { ...occurrence, issue_reception_date: '2026-12-02', fiscal_year: 2027, fiscal_month: 1 },
    })
    const r = await updateOccurrence({
      repo, id: 'occ-1', user, now: HORLOGE,
      patch: { issue_reception_date: '2026-12-02' },
    })
    assert.deepEqual(r.historyRows.map(l => l.field), ['issue_reception_date'])
  })
})

describe('échec du journal', () => {
  test('l erreur remonte au lieu d être avalée', async () => {
    // Côté navigateur, cette insertion est dans un try/catch qui se contente
    // d un console.warn : la modification reste, la trace disparaît. Ici
    // l erreur remonte pour que l appelant annule la transaction.
    const boom = new Error('insertion refusée')
    const repo = fakeRepo({ row: occurrence, onInsert: () => { throw boom } })
    await assert.rejects(
      () => updateOccurrence({ repo, id: 'occ-1', user, now: HORLOGE, patch: { status: 'completed' } }),
      (e) => e === boom)
  })
})
