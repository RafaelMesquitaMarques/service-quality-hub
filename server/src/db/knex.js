// Accès SQL de la couche API.
//
// Coexiste volontairement avec `client.js` (le client Supabase utilisé par les
// scripts d'import) : la bascule se fait zone par zone, pas d'un bloc.
//
// Le dialecte est une variable d'environnement. C'est tout l'intérêt du choix
// de Knex (voir docs/migration-azure/04-choix-query-builder.md) : passer à
// SQL Server, c'est `DB_CLIENT=mssql` et une autre chaîne de connexion. Ce que
// ça ne règle PAS — les types uuid, les timestamptz, les tableaux text[], les
// fonctions plpgsql — est listé dans ce même document.
//
// `buildConfig` est pur et testable ; l'instance, elle, est paresseuse : rien
// ne se connecte au simple chargement du module.

const knexFactory = require('knex')

const DIALECTS = {
  pg: { driver: 'pg', defaultPort: 5432 },
  mssql: { driver: 'tedious', defaultPort: 1433 },
}

/**
 * Construit la configuration Knex à partir de l'environnement.
 * Pur : ne lit rien d'autre, n'ouvre aucune connexion.
 * @throws si le dialecte est inconnu ou la chaîne de connexion absente.
 */
function buildConfig(env = process.env) {
  const client = env.DB_CLIENT || 'pg'

  if (!Object.prototype.hasOwnProperty.call(DIALECTS, client)) {
    throw new Error(
      `DB_CLIENT « ${client} » inconnu. Valeurs acceptées : ${Object.keys(DIALECTS).join(', ')}.`)
  }

  const connection = env.DATABASE_URL
  if (!connection) {
    throw new Error(
      'DATABASE_URL est absent. Avec l\'hébergeur actuel, prendre la chaîne du ' +
      '« Session pooler » : la connexion directe n\'a pas d\'enregistrement IPv4 ' +
      'et échoue par expiration de délai, ce qui se confond avec un mot de passe erroné.')
  }

  return {
    client,
    connection,
    pool: {
      min: Number(env.DB_POOL_MIN || 0),
      max: Number(env.DB_POOL_MAX || 10),
      // Un délai d'acquisition court évite qu'une base injoignable fasse
      // patienter les requêtes HTTP jusqu'à leur propre expiration.
      acquireTimeoutMillis: Number(env.DB_POOL_TIMEOUT || 10000),
    },
    // Ne jamais renvoyer la chaîne de connexion dans un message d'erreur :
    // elle contient le mot de passe.
    acquireConnectionTimeout: Number(env.DB_POOL_TIMEOUT || 10000),
  }
}

let instance = null

/** Instance partagée, créée au premier appel seulement. */
function getKnex(env = process.env) {
  if (!instance) instance = knexFactory(buildConfig(env))
  return instance
}

/** Ferme le pool. À appeler à l'arrêt du serveur et en fin de test. */
async function closeKnex() {
  if (instance) {
    await instance.destroy()
    instance = null
  }
}

module.exports = { buildConfig, getKnex, closeKnex, DIALECTS }
