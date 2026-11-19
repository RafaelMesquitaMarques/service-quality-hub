// Tests de la configuration d'accès SQL. Aucune connexion n'est ouverte :
// `buildConfig` est pur, et Knex construit ses requêtes sans joindre la base.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import db from '../knex.js'
import knexFactory from 'knex'

const { buildConfig, DIALECTS } = db
const URL = 'postgresql://user:motdepasse@exemple.invalid:5432/base'

describe('buildConfig', () => {
  test('PostgreSQL par défaut', () => {
    const c = buildConfig({ DATABASE_URL: URL })
    assert.equal(c.client, 'pg')
    assert.equal(c.connection, URL)
  })

  test('le dialecte vient de l environnement', () => {
    assert.equal(buildConfig({ DATABASE_URL: URL, DB_CLIENT: 'mssql' }).client, 'mssql')
  })

  test('un dialecte inconnu lève, en disant lesquels sont acceptés', () => {
    assert.throws(
      () => buildConfig({ DATABASE_URL: URL, DB_CLIENT: 'oracle' }),
      /inconnu.*pg, mssql/s)
  })

  test('une chaîne de connexion absente lève, en rappelant le piège IPv6', () => {
    // La connexion directe de l hébergeur actuel n a pas d enregistrement A :
    // elle expire au lieu de refuser, ce qui ressemble à un mot de passe faux.
    assert.throws(() => buildConfig({}), /Session pooler/)
  })

  test('les tailles de pool sont réglables et numériques', () => {
    const c = buildConfig({ DATABASE_URL: URL, DB_POOL_MIN: '2', DB_POOL_MAX: '25' })
    assert.equal(c.pool.min, 2)
    assert.equal(c.pool.max, 25)
    assert.equal(typeof c.pool.max, 'number')
  })

  test('valeurs par défaut du pool', () => {
    const c = buildConfig({ DATABASE_URL: URL })
    assert.equal(c.pool.min, 0)
    assert.equal(c.pool.max, 10)
    assert.ok(c.pool.acquireTimeoutMillis > 0)
  })

  test('chaque dialecte déclaré a un pilote et un port', () => {
    for (const [nom, d] of Object.entries(DIALECTS)) {
      assert.ok(d.driver, nom)
      assert.ok(Number.isInteger(d.defaultPort), nom)
    }
  })
})

describe('portabilité du dialecte', () => {
  // La promesse du choix de Knex, vérifiée plutôt que supposée : la MÊME
  // expression produit le SQL de chaque moteur. Le pilote n est pas nécessaire
  // pour construire une requête, seulement pour l exécuter.
  const requete = (client) =>
    knexFactory({ client })
      .select('id', 'quality_issue')
      .from('tickets')
      .where('fiscal_year', 2026)
      .limit(5)
      .toString()

  test('PostgreSQL : guillemets et LIMIT', () => {
    const sql = requete('pg')
    assert.match(sql, /"tickets"/)
    assert.match(sql, /limit 5/)
  })

  test('SQL Server : crochets et TOP', () => {
    const sql = requete('mssql')
    assert.match(sql, /\[tickets\]/)
    assert.match(sql, /top \(5\)/)
    assert.doesNotMatch(sql, /limit/)
  })

  test('les paramètres sont liés, pas concaténés', () => {
    // Protection contre l injection : la valeur ne doit pas finir collée dans
    // le texte de la requête.
    const mechant = "O'Brien; DROP TABLE tickets"
    const q = knexFactory({ client: 'pg' })
      .select('*').from('tickets').where('quality_issue', mechant)

    // Forme générique : l emplacement est un « ? ».
    const { sql, bindings } = q.toSQL()
    assert.match(sql, /= \?$/)
    assert.deepEqual(bindings, [mechant])
    assert.doesNotMatch(sql, /DROP TABLE/)

    // Forme native du dialecte : PostgreSQL numérote ses paramètres.
    const natif = q.toSQL().toNative()
    assert.match(natif.sql, /\$1/)
    assert.deepEqual(natif.bindings, [mechant])
    assert.doesNotMatch(natif.sql, /DROP TABLE/)
  })
})
