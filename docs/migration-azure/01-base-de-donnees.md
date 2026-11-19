# Migration Azure — ce que l'application attend de la base de données

Document destiné au TI. État au 2026-11-18.

## Contexte

L'application (CheckMate / Service Quality Hub) tourne aujourd'hui sur une base
**PostgreSQL** infogérée chez Supabase. L'objectif est de la rapatrier sur
l'infrastructure Azure de Foliot. Le serveur de base de données et la base `Checkmate` ont été créés par le TI
le 2026-11-18. Les noms de machines et adresses internes ne sont pas repris
ici : ce dépôt est public.

## Point à trancher en premier : le moteur

**L'application est écrite pour PostgreSQL**, pas pour SQL Server. Ce n'est pas
une préférence : le code en dépend sur plusieurs points structurants.

| Élément utilisé | Pourquoi ça compte |
|---|---|
| Type `uuid` + `gen_random_uuid()` | Toutes les clés primaires des 15 tables |
| Type `timestamp with time zone` | Toutes les dates ; l'app a déjà eu des bogues de fuseau |
| Row Level Security PostgreSQL | 36 politiques portent les permissions des 5 rôles |
| Fonctions et déclencheurs `plpgsql` | 6 fonctions, 4 déclencheurs (année fiscale, historique, garde-fou privilèges) |
| Vues `tickets_with_cost`, `tickets_with_users` | Toutes les lectures d'occurrences passent par une vue, pas par la table |

Si le serveur fourni est un **SQL Server**, il faut convertir le schéma, réécrire les
fonctions et déclencheurs, retyper les colonnes (`uniqueidentifier`,
`datetimeoffset`) et refaire les politiques de sécurité. C'est un chantier
nettement plus lourd, et sans gain fonctionnel pour l'application.

**Décision du 2026-11-19 : la cible est SQL Server**, et non une instance
PostgreSQL.

Le facteur décisif n'est pas technique, il est opérationnel : le TI n'a
**aucune sauvegarde des VM**, et refond tout son dispositif de sauvegarde —
alors que ses bases SQL Server sont déjà dans sa rotation. Une base PostgreSQL
en conteneur sur le VM serait bien plus simple à atteindre, et sans aucune
sauvegarde : une régression de durabilité sur deux ans d'historique qualité.

Le coût de conversion listé ci-dessus reste entier. Il se paie en deux temps :
d'abord la couche API, qui doit exister de toute façon (voir
[03-endpoints-api.md](03-endpoints-api.md)) ; ensuite le changement de moteur
sous elle, où le dialecte devient une ligne de configuration (voir
[04-choix-query-builder.md](04-choix-query-builder.md)).

## Volumes actuels

Relevé sur la base de production le 2026-11-18.

| Table | Lignes |
|---|---|
| ticket_history | 12 640 |
| occurrence_lines | 2 817 |
| tickets | 2 565 |
| ticket_photos | 1 546 (métadonnées ; les images sont hors base) |
| meeting_tickets | 406 |
| monthly_revenue | 120 |
| user_profiles | 25 |
| meetings | 24 |
| brands / departments | 18 / 18 |
| categories | 14 |
| meeting_actions | 10 |
| plants | 4 |
| saved_reports | 2 |
| clients | 0 |

**Total : 20 209 lignes, 15 tables, 2 vues, 266 colonnes, 18 clés étrangères.**

Taille des données exportées : ~11 Mo en JSON, soit de l'ordre de **30 à 50 Mo**
une fois en base avec les index.

## Croissance observée

- Occurrences : ~114 par mois sur les 6 derniers mois
- Historique : ~1 000 lignes par mois
- Photos : ~258 par mois, ~1,06 Mo en moyenne, soit **~275 Mo par mois**

La base reste donc petite (bien moins de 1 Go à 5 ans). **Ce sont les photos qui
pèsent** — de l’ordre de 3,3 Go par an — et elles ne vont pas en base : il faut un
compte de stockage séparé.

## Besoins

### Base de données
- PostgreSQL 15 ou plus récent
- Extension `pgcrypto` (ou `uuid-ossp`) pour `gen_random_uuid()`
- Encodage UTF-8, données en français et en anglais
- Sauvegarde quotidienne avec rétention — la base porte l'historique qualité depuis 2024-11
- Un compte propriétaire par environnement (DEV, QA, PROD)

### Réseau
Le VM applicatif (celui qui publie l'app sur le port 15105) doit joindre la base.
**Aujourd'hui le poste de travail ne joint ni 1433 ni 5432 sur le serveur de
base de données** :
les deux ports sont filtrés. Il faut soit ouvrir un accès depuis le poste pour
faire la migration, soit exécuter la migration depuis le VM applicatif.

### Stockage des photos
1 539 fichiers récupérés, **1,6 Go** aujourd'hui, ~275 Mo de plus par mois.

7 lignes de `ticket_photos` pointent vers des fichiers absents du bucket
(6 en erreur 400, 1 vers `https://test.com/test.jpg`) : métadonnées orphelines
à purger plutôt qu’à migrer.
**Réglé le 2026-11-19.** Pas de compte Blob : le TI a fourni un dossier sur le
serveur de fichiers interne, que le VM applicatif joint déjà.

- un **compte de service dédié** y a les droits d'écriture, et lui seul ;
- l'**héritage des permissions est cassé** : le groupe « utilisateurs
  authentifiés », qui a *Modify* sur la racine du partage, n'a plus aucun accès
  au dossier — vérifié le 2026-11-19 ;
- un **sous-dossier par environnement** (dev, qa, prod), créés et vérifiés, pour
  que tester ne touche jamais aux photos réelles ;
- écriture testée de bout en bout depuis le poste.

Les photos seront servies par notre nginx derrière l'authentification de
l'application, donc l'exposition publique disparaît quel que soit l'état des
droits du partage.

> À noter : chez Supabase ces photos sont dans un bucket **public** — n'importe
> qui ayant l'URL voit les photos de réclamation client. La migration est
> l'occasion de fermer ça.

### Comptes utilisateurs
25 comptes, authentification courriel + mot de passe.
Si le TI préfère **Entra ID (SSO Foliot)**, l'application peut s'y brancher et
les 25 comptes locaux disparaissent. Décision à prendre avec le TI.

## Sauvegardes : état au 2026-11-19

Le TI a confirmé qu'**il n'y a aujourd'hui aucune sauvegarde des VM**, et que
tout le dispositif de sauvegarde est en cours de révision — rien n'est prévu à
court terme.

Conséquence directe : une base PostgreSQL en conteneur sur le VM applicatif ne
serait couverte par rien, alors que l'hébergeur actuel sauvegarde
automatiquement. La base porte l'historique qualité depuis 2024-11.

**Règle retenue :** le DEV peut basculer tout de suite, il n'y a rien à y
perdre. La **PROD ne bascule pas** tant que les trois conditions suivantes ne
sont pas remplies :

1. un `pg_dump` planifié quotidiennement ;
2. déposé **hors du VM** (sur un partage de fichiers, par exemple), car un dump
   qui reste sur la machine qu'il protège ne protège rien ;
3. une **restauration testée** au moins une fois, pas seulement un fichier qui
   se crée.

La base faisant 30 à 50 Mo, un dump quotidien compressé est négligeable : une
année de rétention tient dans quelques centaines de Mo.

## Questions au TI — état au 2026-11-19

**Répondu :**

1. ~~Quel moteur ?~~ **SQL Server, et c'est la cible retenue.** Le TI envisage
   PostgreSQL « dans le futur » mais rien n'est acté. Il proposait en attendant
   un conteneur portant notre propre base : écarté le 2026-11-19, parce que les
   VM ne sont pas sauvegardées et les bases SQL Server le sont. La base
   `Checkmate` déjà créée par le TI est donc la destination — à conserver.
2. ~~Accès réseau ?~~ Le VM applicatif joint la base sans problème. Depuis le
   poste de travail il faudrait faire ouvrir le flux.
3. ~~Stockage des photos ?~~ Pas de compte Blob : le TI propose un dossier sur
   le serveur de fichiers interne, avec un compte de service dédié et un
   sous-dossier par environnement (DEV, QA, PROD).
4. ~~Sauvegarde des VM ?~~ **Il n'y en a aucune**, et le dispositif de
   sauvegarde est en cours de révision. Voir la section ci-dessus : la PROD ne
   bascule pas tant que le pg_dump hors VM n'est pas en place et testé.

**En attente :**

5. Le serveur de fichiers interne est-il lui-même sauvegardé ? S'il ne l'est
   pas non plus, il faut une troisième destination pour les dumps.
6. L'authentification doit-elle passer par **Entra ID**, ou l'app garde-t-elle
   ses propres comptes ?
7. Pour QA et PROD, réplique-t-on le même montage sur chaque VM ?

> Le TI rappelle que l'infrastructure actuelle est provisoire, le temps qu'une
> architecture pérenne soit définie, et que l'application devra sans doute être
> réajustée ensuite. C'est l'argument principal pour bâtir une couche de
> persistance propre plutôt que de se lier à un moteur précis.
