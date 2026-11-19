// Tests du service d'occurrence — aucune base : le dépôt est un double qui
// enregistre ce qu'on lui demande.
//
// Ce qui est testé ici, c'est l'ORCHESTRATION : l'ordre des opérations, ce qui
// est écrit, ce qui est refusé, et ce qui remonte en erreur. C'est exactement
// la partie que les trois allers-retours du navigateur font mal aujourd'hui.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import service from '../service.js'

const {
  updateOccurrence, createOccurrence, deleteOccurrence,
  sanitizePatch, NotFoundError, IMMUTABLE_FIELDS,
} = service

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

// ─── Création ────────────────────────────────────────────────────────────────

/** Double pour la création et la suppression. */
function fakeRepo2({ creee = { id: 'occ-neuve' }, lignes = [], chemins = [], supprimee = { id: 'occ-1' } } = {}) {
  const calls = []
  return {
    calls,
    nomsAppeles: () => calls.map(c => c[0]),
    async insertOccurrence(row) { calls.push(['insertOccurrence', row]); return creee },
    async insertLines(rows) { calls.push(['insertLines', rows]); return lignes },
    async findPhotoPaths(id) { calls.push(['findPhotoPaths', id]); return chemins },
    async deleteOccurrence(id) { calls.push(['deleteOccurrence', id]); return supprimee },
  }
}

describe('createOccurrence', () => {
  test('l auteur vient de la session, pas de la charge utile', async () => {
    // Sinon on s attribue la paternite, et avec elle le droit de modifier.
    const repo = fakeRepo2()
    await createOccurrence({
      repo, user, now: HORLOGE,
      header: { quality_issue: 'Porte rayée', created_by: 'quelqu-un-dautre' },
    })
    const [, ecrit] = repo.calls.find(c => c[0] === 'insertOccurrence')
    assert.equal(ecrit.created_by, user.id)
  })

  test('sans session, l auteur reste nul', async () => {
    const repo = fakeRepo2()
    await createOccurrence({ repo, user: null, now: HORLOGE, header: { quality_issue: 'x' } })
    const [, ecrit] = repo.calls.find(c => c[0] === 'insertOccurrence')
    assert.equal(ecrit.created_by, null)
  })

  test('les champs d identite et les champs fiscaux sont refusés', async () => {
    const repo = fakeRepo2()
    await createOccurrence({
      repo, user, now: HORLOGE,
      header: { quality_issue: 'x', id: 'impose', occurrence_no: 1, fiscal_year: 2030 },
    })
    const [, ecrit] = repo.calls.find(c => c[0] === 'insertOccurrence')
    assert.deepEqual(Object.keys(ecrit).sort(), ['created_by', 'quality_issue', 'updated_at'])
  })

  test('les lignes reçoivent l identifiant de l occurrence créée', async () => {
    const repo = fakeRepo2({ creee: { id: 'occ-neuve' } })
    await createOccurrence({
      repo, user, now: HORLOGE, header: { quality_issue: 'x' },
      lines: [{ quality_issue: 'Tiroir' }, { quality_issue: 'Panneau' }],
    })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertLines')
    assert.deepEqual(lignes.map(l => l.occurrence_id), ['occ-neuve', 'occ-neuve'])
  })

  test('une ligne ne peut pas désigner une autre occurrence', async () => {
    const repo = fakeRepo2({ creee: { id: 'occ-neuve' } })
    await createOccurrence({
      repo, user, now: HORLOGE, header: { quality_issue: 'x' },
      lines: [{ quality_issue: 'Tiroir', occurrence_id: 'occ-de-quelqu-un-dautre' }],
    })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertLines')
    assert.equal(lignes[0].occurrence_id, 'occ-neuve')
  })

  test('l ordre des lignes suit leur position, sauf s il est fourni', async () => {
    const repo = fakeRepo2()
    await createOccurrence({
      repo, user, now: HORLOGE, header: { quality_issue: 'x' },
      lines: [{ quality_issue: 'a' }, { quality_issue: 'b', sort_order: 7 }, { quality_issue: 'c' }],
    })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertLines')
    assert.deepEqual(lignes.map(l => l.sort_order), [0, 7, 2])
  })

  test('les photos ne partent pas en base avec la ligne', async () => {
    // Elles passent par le stockage, hors transaction : voir le service.
    const repo = fakeRepo2()
    await createOccurrence({
      repo, user, now: HORLOGE, header: { quality_issue: 'x' },
      lines: [{ quality_issue: 'a', photos: [{ name: 'p.jpg' }] }],
    })
    const [, lignes] = repo.calls.find(c => c[0] === 'insertLines')
    assert.equal('photos' in lignes[0], false)
  })

  test('sans ligne, aucune insertion de ligne', async () => {
    const repo = fakeRepo2()
    await createOccurrence({ repo, user, now: HORLOGE, header: { quality_issue: 'x' } })
    assert.deepEqual(repo.nomsAppeles(), ['insertOccurrence'])
  })

  test('une création qui ne renvoie rien lève', async () => {
    const repo = fakeRepo2({ creee: null })
    await assert.rejects(
      () => createOccurrence({ repo, user, now: HORLOGE, header: { quality_issue: 'x' } }),
      /aucune ligne/)
  })
})

// ─── Suppression ─────────────────────────────────────────────────────────────

describe('deleteOccurrence', () => {
  test('relève les fichiers AVANT de supprimer', async () => {
    // Dans l autre ordre, les chemins sont perdus avec les lignes.
    const repo = fakeRepo2({ chemins: ['tickets/occ-1/a.jpg'] })
    await deleteOccurrence({ repo, id: 'occ-1' })
    assert.deepEqual(repo.nomsAppeles(), ['findPhotoPaths', 'deleteOccurrence'])
  })

  test('renvoie les chemins pour nettoyage après commit', async () => {
    const chemins = ['tickets/occ-1/a.jpg', 'tickets/occ-1/b.jpg']
    const repo = fakeRepo2({ chemins })
    const r = await deleteOccurrence({ repo, id: 'occ-1' })
    assert.deepEqual(r.storagePaths, chemins)
  })

  test('une seule suppression : la base fait la cascade', async () => {
    // occurrence_lines, ticket_photos, ticket_history et meeting_tickets
    // portent toutes ON DELETE CASCADE vers tickets.
    const repo = fakeRepo2()
    await deleteOccurrence({ repo, id: 'occ-1' })
    assert.equal(repo.nomsAppeles().filter(n => n.startsWith('delete')).length, 1)
  })

  test('une suppression qui ne touche rien est un 404', async () => {
    const repo = fakeRepo2({ supprimee: null })
    await assert.rejects(
      () => deleteOccurrence({ repo, id: 'occ-absente' }),
      (e) => e instanceof NotFoundError && e.status === 404)
  })

  test('une occurrence sans photo se supprime sans histoire', async () => {
    const repo = fakeRepo2({ chemins: [] })
    const r = await deleteOccurrence({ repo, id: 'occ-1' })
    assert.deepEqual(r.storagePaths, [])
    assert.ok(r.occurrence)
  })
})
