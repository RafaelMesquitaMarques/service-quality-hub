// Tests du modèle d'autorisation — logique pure, aucune base, aucune dépendance.
//   npm run test:policy
//
// Chaque cas correspond à une ligne de docs/migration-azure/02-modele-autorisation.md.
// Quand la règle change, ce fichier doit changer avec elle : c'est lui qui dit
// ce que l'API accordera une fois que la RLS ne sera plus là pour rattraper.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import policy from '../policy.js'

const { can, assertCan, canChangeRole, canSetVisibility, ForbiddenError, ROLES } = policy

const user = (role, id = 'u-' + role) => ({ id, role, active: true })
const admin   = user('admin')
const manager = user('manager')
const cpm     = user('cpm')
const sd      = user('service_desk')
const viewer  = user('viewer')
const EVERYONE = [admin, manager, cpm, sd, viewer]

const allowedFor = (action, resource, record = null) =>
  EVERYONE.filter(u => can(u, action, resource, record)).map(u => u.role).sort()

describe('refus par défaut', () => {
  test('aucun utilisateur', () => {
    assert.equal(can(null, 'read', 'occurrences'), false)
    assert.equal(can(undefined, 'read', 'occurrences'), false)
    assert.equal(can('admin', 'read', 'occurrences'), false)
  })

  test('rôle inconnu', () => {
    assert.equal(can({ id: 'x', role: 'superadmin', active: true }, 'read', 'occurrences'), false)
    assert.equal(can({ id: 'x', role: undefined, active: true }, 'read', 'occurrences'), false)
  })

  test('compte désactivé : rien, pas même la lecture', () => {
    const off = { id: 'u1', role: 'admin', active: false }
    assert.equal(can(off, 'read', 'occurrences'), false)
    assert.equal(can(off, 'delete', 'occurrences'), false)
  })

  test('action ou ressource inconnue', () => {
    assert.equal(can(admin, 'purge', 'occurrences'), false)
    assert.equal(can(admin, 'read', 'inexistant'), false)
  })

  test('une clé héritée du prototype ne fait pas une ressource', () => {
    assert.equal(can(admin, 'read', 'constructor'), false)
    assert.equal(can(admin, 'read', '__proto__'), false)
    assert.equal(can(admin, 'read', 'toString'), false)
  })
})

describe('référentiels : tout le monde lit, seuls les admins écrivent', () => {
  for (const resource of ['brands', 'categories', 'clients', 'departments', 'plants']) {
    test(resource, () => {
      assert.deepEqual(allowedFor('read', resource), ROLES.slice().sort())
      for (const action of ['create', 'update', 'delete']) {
        assert.deepEqual(allowedFor(action, resource), ['admin'], `${action} ${resource}`)
      }
    })
  }
})

describe('occurrences', () => {
  test('lecture ouverte à tous les comptes actifs', () => {
    assert.deepEqual(allowedFor('read', 'occurrences'), ROLES.slice().sort())
  })

  test('création interdite au viewer seulement', () => {
    assert.deepEqual(allowedFor('create', 'occurrences'), ['admin', 'cpm', 'manager', 'service_desk'])
  })

  test('suppression réservée aux admins', () => {
    assert.deepEqual(allowedFor('delete', 'occurrences'), ['admin'])
  })

  test('un cpm modifie ce qu il a créé', () => {
    const sien = { created_by: cpm.id }
    assert.equal(can(cpm, 'update', 'occurrences', sien), true)
  })

  test('un cpm ne modifie pas l occurrence d un autre', () => {
    const autre = { created_by: 'quelqu-un-dautre' }
    assert.equal(can(cpm, 'update', 'occurrences', autre), false)
  })

  test('le viewer est exclu même de sa propre occurrence', () => {
    // « Lecture seule » sans exception : il ne peut pas en créer, il ne doit
    // pas pouvoir en modifier. Cas atteignable si un compte ayant créé des
    // occurrences est un jour rétrogradé en viewer.
    assert.equal(can(viewer, 'update', 'occurrences', { created_by: viewer.id }), false)
  })

  test('les rôles encadrants modifient l occurrence de n importe qui', () => {
    const autre = { created_by: 'quelqu-un-dautre' }
    for (const u of [admin, manager, sd]) {
      assert.equal(can(u, 'update', 'occurrences', autre), true, u.role)
    }
  })

  test('occurrence importée (created_by NULL) : encadrants seulement', () => {
    // 2 072 des 2 565 occurrences sont dans ce cas. Conséquence assumée et
    // documentée : un cpm ne peut pas modifier l historique importé.
    const importee = { created_by: null }
    assert.equal(can(cpm, 'update', 'occurrences', importee), false)
    assert.equal(can(admin, 'update', 'occurrences', importee), true)
    assert.equal(can(sd, 'update', 'occurrences', importee), true)
  })

  test('sans la ligne visée, seuls les encadrants passent', () => {
    // Une route qui oublie de charger la ligne ne doit pas élargir les droits.
    assert.equal(can(cpm, 'update', 'occurrences', null), false)
    assert.equal(can(manager, 'update', 'occurrences', null), true)
  })

  test('un identifiant de créateur nul ne vaut pas un utilisateur sans identifiant', () => {
    const fantome = { id: null, role: 'cpm', active: true }
    assert.equal(can(fantome, 'update', 'occurrences', { created_by: null }), false)
  })
})

describe('lignes et photos : le viewer ne touche pas aux coûts', () => {
  for (const resource of ['lines', 'photos']) {
    test(resource, () => {
      assert.deepEqual(allowedFor('read', resource), ROLES.slice().sort())
      for (const action of ['create', 'update', 'delete']) {
        assert.deepEqual(
          allowedFor(action, resource),
          ['admin', 'cpm', 'manager', 'service_desk'],
          `${action} ${resource}`)
      }
    })
  }
})

describe('journal d audit : en ajout seul, et jamais par le client', () => {
  test('personne ne crée, ne modifie ni ne supprime une ligne d historique', () => {
    for (const action of ['create', 'update', 'delete']) {
      assert.deepEqual(allowedFor(action, 'history'), [], action)
    }
  })
  test('tout le monde le lit', () => {
    assert.deepEqual(allowedFor('read', 'history'), ROLES.slice().sort())
  })
})

describe('réunions', () => {
  test('écriture réservée aux encadrants', () => {
    for (const action of ['create', 'update', 'delete']) {
      assert.deepEqual(allowedFor(action, 'meetings'), ['admin', 'manager', 'service_desk'], action)
    }
  })
  test('un cpm ne crée ni ne supprime une réunion', () => {
    assert.equal(can(cpm, 'create', 'meetings'), false)
    assert.equal(can(cpm, 'delete', 'meetings'), false)
  })
  test('occurrences et actions rattachées : interdites au viewer', () => {
    for (const resource of ['meetingLinks', 'meetingActions']) {
      assert.deepEqual(allowedFor('update', resource), ['admin', 'cpm', 'manager', 'service_desk'], resource)
    }
  })
})

describe('revenus', () => {
  test('écriture réservée aux admins et managers', () => {
    for (const action of ['create', 'update', 'delete']) {
      assert.deepEqual(allowedFor(action, 'revenue'), ['admin', 'manager'], action)
    }
  })
  test('lecture ouverte : le tableau de bord en a besoin pour le SC %', () => {
    assert.deepEqual(allowedFor('read', 'revenue'), ROLES.slice().sort())
  })
})

describe('rapports enregistrés', () => {
  const mien   = (visibility = 'private') => ({ owner_id: cpm.id, visibility })
  const autrui = (visibility = 'private') => ({ owner_id: 'quelqu-un-dautre', visibility })

  test('lecture : le sien, ou un rapport partagé', () => {
    assert.equal(can(cpm, 'read', 'savedReports', mien()), true)
    assert.equal(can(cpm, 'read', 'savedReports', autrui('private')), false)
    assert.equal(can(cpm, 'read', 'savedReports', autrui('shared')), true)
  })

  test('un admin ne lit pas le rapport privé d un autre', () => {
    // Le partage est explicite : être admin ne donne pas de droit de regard.
    assert.equal(can(admin, 'read', 'savedReports', autrui('private')), false)
  })

  test('création : pour soi uniquement', () => {
    assert.equal(can(cpm, 'create', 'savedReports', mien()), true)
    assert.equal(can(cpm, 'create', 'savedReports', autrui()), false)
  })

  test('créer un rapport partagé est réservé aux admins et managers', () => {
    assert.equal(can(cpm, 'create', 'savedReports', mien('shared')), false)
    assert.equal(can(viewer, 'create', 'savedReports', { owner_id: viewer.id, visibility: 'shared' }), false)
    assert.equal(can(manager, 'create', 'savedReports', { owner_id: manager.id, visibility: 'shared' }), true)
  })

  test('un viewer peut se créer un rapport privé', () => {
    // Lecture seule porte sur les données, pas sur ses propres filtres.
    assert.equal(can(viewer, 'create', 'savedReports', { owner_id: viewer.id, visibility: 'private' }), true)
  })

  test('USING : le propriétaire touche son rapport, même partagé', () => {
    assert.equal(can(cpm, 'update', 'savedReports', mien('shared')), true)
  })

  test('WITH CHECK : mais il ne peut pas le laisser partagé', () => {
    // Les deux questions sont distinctes — c est exactement ce que la RLS
    // exprimait avec USING et WITH CHECK séparés.
    assert.equal(canSetVisibility(cpm, 'shared'), false)
    assert.equal(canSetVisibility(cpm, 'private'), true)
    assert.equal(canSetVisibility(manager, 'shared'), true)
  })

  test('un admin modifie un rapport partagé qui ne lui appartient pas', () => {
    assert.equal(can(admin, 'update', 'savedReports', autrui('shared')), true)
    assert.equal(can(manager, 'update', 'savedReports', autrui('shared')), false)
  })

  test('suppression : le sien, ou n importe lequel pour un admin', () => {
    assert.equal(can(cpm, 'delete', 'savedReports', mien()), true)
    assert.equal(can(cpm, 'delete', 'savedReports', autrui()), false)
    assert.equal(can(admin, 'delete', 'savedReports', autrui()), true)
  })
})

describe('comptes utilisateurs', () => {
  test('chacun modifie son profil', () => {
    assert.equal(can(cpm, 'update', 'users', { id: cpm.id }), true)
    assert.equal(can(cpm, 'update', 'users', { id: 'autre' }), false)
  })
  test('un admin modifie n importe quel profil', () => {
    assert.equal(can(admin, 'update', 'users', { id: 'autre' }), true)
  })
  test('création et suppression réservées aux admins', () => {
    assert.deepEqual(allowedFor('create', 'users'), ['admin'])
    assert.deepEqual(allowedFor('delete', 'users'), ['admin'])
  })

  test('seul un admin change un rôle', () => {
    assert.equal(canChangeRole(admin, 'autre'), true)
    assert.equal(canChangeRole(manager, 'autre'), false)
    assert.equal(canChangeRole(cpm, cpm.id), false)
  })

  test('un admin ne change pas son propre rôle', () => {
    // Sinon un administrateur unique peut se rétrograder et verrouiller
    // l administration — reprend le garde-fou du déclencheur SQL, qui ne
    // survivra pas au changement de base.
    assert.equal(canChangeRole(admin, admin.id), false)
  })
})

describe('assertCan', () => {
  test('laisse passer ce qui est autorisé', () => {
    assert.equal(assertCan(admin, 'delete', 'occurrences'), true)
  })
  test('lève une erreur 403 sinon', () => {
    assert.throws(
      () => assertCan(viewer, 'delete', 'occurrences'),
      (e) => e instanceof ForbiddenError && e.status === 403)
  })
})
