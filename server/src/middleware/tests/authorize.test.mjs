// Tests du branchement de l'autorisation sur Express.
// Pas de serveur, pas de base : on fabrique req/res/next à la main.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import authorize from '../authorize.js'
import policy from '../../auth/policy.js'

const { requireCan, requireCanOn, readableBy, isRecordDependent } = authorize
const { ForbiddenError } = policy

const user = (role, id = 'u-' + role) => ({ id, role, active: true })
const admin  = user('admin')
const cpm    = user('cpm')
const viewer = user('viewer')

// Doubles minimalistes.
function fakeRes() {
  const res = { statusCode: null, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}
function capture() {
  const calls = []
  const next = (err) => calls.push(err)
  return { next, calls, get passed() { return calls.length === 1 && calls[0] === undefined } }
}

describe('requireCan — règles qui ne dépendent que du rôle', () => {
  test('laisse passer le rôle autorisé', () => {
    const mw = requireCan('delete', 'occurrences')
    const c = capture()
    mw({ user: admin }, fakeRes(), c.next)
    assert.equal(c.passed, true)
  })

  test('transmet une ForbiddenError sinon', () => {
    const mw = requireCan('delete', 'occurrences')
    const c = capture()
    mw({ user: cpm }, fakeRes(), c.next)
    assert.equal(c.calls.length, 1)
    assert.ok(c.calls[0] instanceof ForbiddenError)
    assert.equal(c.calls[0].status, 403)
  })

  test('un viewer est refusé en écriture', () => {
    const mw = requireCan('create', 'lines')
    const c = capture()
    mw({ user: viewer }, fakeRes(), c.next)
    assert.ok(c.calls[0] instanceof ForbiddenError)
  })

  test('une requête sans utilisateur est refusée', () => {
    const mw = requireCan('read', 'occurrences')
    const c = capture()
    mw({}, fakeRes(), c.next)
    assert.ok(c.calls[0] instanceof ForbiddenError)
  })
})

describe('garde-fou : une règle qui dépend de la ligne refuse requireCan', () => {
  // L'erreur est levée à la DÉFINITION de la route, donc au démarrage du
  // serveur — pas au premier appel d'un utilisateur.
  for (const [action, resource] of [
    ['update', 'occurrences'],
    ['update', 'savedReports'],
    ['read', 'savedReports'],
    ['update', 'users'],
  ]) {
    test(`${action} ${resource}`, () => {
      assert.equal(isRecordDependent(action, resource), true)
      assert.throws(() => requireCan(action, resource), /dépend de la ligne visée/)
    })
  }

  test('les règles de rôle pur restent autorisées', () => {
    assert.equal(isRecordDependent('delete', 'occurrences'), false)
    assert.doesNotThrow(() => requireCan('delete', 'occurrences'))
    assert.doesNotThrow(() => requireCan('create', 'meetings'))
  })
})

describe('requireCanOn — règles qui dépendent de la ligne', () => {
  test('exige une fonction de chargement', () => {
    assert.throws(() => requireCanOn('update', 'occurrences'), /fonction de chargement/)
    assert.throws(() => requireCanOn('update', 'occurrences', 'pas une fonction'), /fonction de chargement/)
  })

  test('ligne absente : 404, jamais 200', async () => {
    const mw = requireCanOn('update', 'occurrences', async () => null)
    const res = fakeRes()
    const c = capture()
    await mw({ user: admin }, res, c.next)
    assert.equal(res.statusCode, 404)
    assert.equal(c.calls.length, 0)
  })

  test('le créateur passe et récupère la ligne sur req.record', async () => {
    const ligne = { id: 'occ-1', created_by: cpm.id }
    const mw = requireCanOn('update', 'occurrences', async () => ligne)
    const req = { user: cpm }
    const c = capture()
    await mw(req, fakeRes(), c.next)
    assert.equal(c.passed, true)
    assert.equal(req.record, ligne)
  })

  test('un cpm sur l occurrence d un autre est refusé', async () => {
    const mw = requireCanOn('update', 'occurrences', async () => ({ id: 'occ-2', created_by: 'autre' }))
    const c = capture()
    await mw({ user: cpm }, fakeRes(), c.next)
    assert.ok(c.calls[0] instanceof ForbiddenError)
  })

  test('une occurrence importée reste modifiable par un encadrant', async () => {
    const mw = requireCanOn('update', 'occurrences', async () => ({ id: 'occ-3', created_by: null }))
    const c = capture()
    await mw({ user: admin }, fakeRes(), c.next)
    assert.equal(c.passed, true)
  })

  test('une erreur du chargeur part dans next, pas en 403', async () => {
    const boom = new Error('base injoignable')
    const mw = requireCanOn('update', 'occurrences', async () => { throw boom })
    const c = capture()
    await mw({ user: admin }, fakeRes(), c.next)
    assert.equal(c.calls[0], boom)
  })
})

describe('readableBy', () => {
  test('ne garde que les lignes lisibles', () => {
    const rows = [
      { id: 1, owner_id: cpm.id, visibility: 'private' },
      { id: 2, owner_id: 'autre', visibility: 'private' },
      { id: 3, owner_id: 'autre', visibility: 'shared' },
    ]
    assert.deepEqual(readableBy(cpm, 'savedReports', rows).map(r => r.id), [1, 3])
  })

  test('tolère une liste vide ou absente', () => {
    assert.deepEqual(readableBy(cpm, 'savedReports', null), [])
    assert.deepEqual(readableBy(cpm, 'savedReports', []), [])
  })
})
