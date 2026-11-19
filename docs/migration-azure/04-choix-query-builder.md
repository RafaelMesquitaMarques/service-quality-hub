# Choix de l'outil d'accès aux données

Décision du 2026-11-19, pour la couche API (phase 1).

## Décision

**Knex**, avec le dialecte choisi par variable d'environnement.

```js
// server/src/db/knex.js
const config = {
  client: process.env.DB_CLIENT || 'pg',   // 'pg' aujourd'hui, 'mssql' plus tard
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 10 },
}
```

Changer de moteur, c'est changer `DB_CLIENT` et la chaîne de connexion. C'est
exactement ce que le TI décrivait : « la seule chose qui changerait, c'est le
mapping ». Encore faut-il que la couche existe — c'est l'objet de la phase 1.

## Pourquoi Knex plutôt qu'un ORM

| | Knex | Prisma / Drizzle |
|---|---|---|
| JavaScript simple, sans TypeScript | naturel | perd l'essentiel de son intérêt |
| Schéma existant, forgé à la main | on écrit des requêtes, c'est tout | introspection puis génération de client |
| Transactions | `knex.transaction()` | équivalent |
| PostgreSQL **et** SQL Server | tous deux de longue date | pris en charge, SQL Server plus récent |
| Codegen à l'exécution | aucun | oui |

Le projet est en JavaScript simple, le schéma existe déjà et a évolué à la main
pendant deux ans. Un ORM typé apporterait surtout de la friction : il faudrait
l'introspection, un second schéma source de vérité, et une étape de génération —
pour un bénéfice de typage que du JS sans types ne récolte pas.

Knex reste un constructeur de requêtes : il ne cache pas le SQL, il le rend
portable et paramétré. C'est ce dont cette couche a besoin.

## Ce que Knex ne règle PAS

Il serait malhonnête de laisser croire que passer à SQL Server se résume alors à
une ligne de configuration. Knex porte la **syntaxe** des requêtes, pas le
**dialecte** du schéma. Relevé sur le dump du 2026-11-18 :

| À reprendre | Quantité | Vers SQL Server |
|---|---|---|
| Colonnes `uuid`, défaut `gen_random_uuid()` | 31 colonnes, 14 défauts | `uniqueidentifier`, `NEWID()` |
| `timestamp with time zone` | 33 colonnes | `datetimeoffset` |
| `jsonb` | 7 colonnes | `nvarchar(max)` + fonctions JSON |
| Tableaux `text[]` | 15 colonnes | **aucun équivalent** : table de liaison ou chaîne délimitée |
| Fonctions `plpgsql` | 6 | réécriture en T-SQL |
| Déclencheurs | 4 | réécriture |
| Vues | 2 | syntaxe proche, à retester |
| `ILIKE` (recherche de la liste) | — | `LIKE` + collation insensible à la casse |
| Contraintes `CHECK` | 24 | portables pour la plupart |

Les tableaux `text[]` sont le point dur : il n'existe pas d'équivalent en SQL
Server, c'est un changement de modèle de données, pas de syntaxe.

Estimation honnête : Knex supprime l'essentiel de la peine côté requêtes —
syntaxe, paramétrage, transactions, pagination — et laisse entier le travail de
conversion du schéma. Utile, pas magique.

## Ce qui est déjà fait

`server/src/auth/policy.js` : le modèle d'autorisation en logique pure, sans
base ni serveur, avec 45 tests (`npm run test:api`). C'est la traduction des
44 politiques RLS relevées dans
[02-modele-autorisation.md](02-modele-autorisation.md).

Il est volontairement **sans dépendance** : la règle qui décide qui voit quoi ne
doit pas attendre qu'une base soit joignable pour être vérifiable. Écrire ces
tests a d'ailleurs déjà rapporté — ils ont mis au jour une contradiction dans la
matrice elle-même (un `viewer` ne peut pas créer d'occurrence, mais la règle le
laissait modifier celles dont il serait propriétaire).

## Ce qui vient ensuite

1. Installer Knex et câbler `server/src/db/knex.js` — **nécessite la chaîne de
   connexion** de la base actuelle ; sans elle on écrit du code qu'on ne peut
   pas exécuter.
2. Brancher `policy.js` dans un middleware d'autorisation, à la suite de
   `requireAuth` qui existe déjà.
3. Premier endpoint de référence : `PATCH /occurrences/:id`, parce que c'est
   celui qui souffre le plus de l'absence de transaction (lecture du snapshot,
   écriture, historique — trois allers-retours aujourd'hui).
4. Basculer le front zone par zone, l'API et les appels directs cohabitant le
   temps de la transition.

## Authentification pendant la transition

On garde l'authentification actuelle : `requireAuth` vérifie déjà le jeton avec
le secret JWT. La question Entra ID reste ouverte côté TI, et la couche API n'a
pas à l'attendre — c'est précisément l'intérêt d'avoir une couche.

À noter : ce secret JWT est dans `server/.env`, suivi par git dans un dépôt
**public**. À traiter avant que l'API en dépende davantage.
