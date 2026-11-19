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

> **Correction du 2026-11-19.** Une première version de ce tableau annonçait
> 15 colonnes `text[]` « sans équivalent en SQL Server », présentées comme le
> point dur. C'était faux : le relevé avait compté les occurrences de la chaîne
> `text[]` dans tout le dump, qui apparaît surtout dans les expressions
> `= ANY (ARRAY[...])` des contraintes CHECK et des politiques RLS. En
> extrayant les définitions de colonnes, **il n'y a aucune colonne de type
> tableau**. Les chiffres ci-dessous viennent de l'inventaire corrigé :
> 15 tables, 183 colonnes.

| À reprendre | Quantité | Vers SQL Server |
|---|---|---|
| Colonnes `uuid` (dont les clés primaires) | 29 | `uniqueidentifier`, `NEWID()` |
| `timestamp with time zone` | 29 | `datetimeoffset` |
| `numeric(p,s)` | 11 | `decimal(p,s)` |
| `jsonb` | **1** — `saved_reports.config` | `nvarchar(max)` |
| Contraintes `CHECK` en `= ANY (ARRAY[...])` | 24 | `IN (...)` |
| Fonctions `plpgsql` | 6 | réécriture en T-SQL |
| Déclencheurs | 4 | réécriture |
| Vues | 2 | syntaxe proche, à retester |
| `ILIKE` (recherche de la liste) | — | `LIKE` + collation insensible à la casse |
| Colonnes de type tableau | **0** | — |

La conversion est donc nettement plus mécanique que ce que la première version
laissait croire. Le vrai travail tient dans les **6 fonctions et 4 déclencheurs
plpgsql**, qui demandent une réécriture et des tests ; les types se convertient
ligne à ligne. La seule colonne `jsonb` porte des configurations de rapport que
l'application lit et écrit d'un bloc, sans jamais interroger l'intérieur en SQL :
`nvarchar(max)` suffit.

Estimation honnête : Knex supprime l'essentiel de la peine côté requêtes —
syntaxe, paramétrage, transactions, pagination — et laisse le travail de
conversion du schéma, qui est réel mais borné. Utile, pas magique.

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
