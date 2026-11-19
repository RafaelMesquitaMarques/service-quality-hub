-- ============================================================================
--  RECONNAISSANCE DU SERVEUR SQL — 100 % LECTURE SEULE
-- ============================================================================
--
--  À exécuter sur le serveur de base fourni par le TI, sur la base Checkmate.
--  Ce script ne CRÉE rien, ne MODIFIE rien, ne SUPPRIME rien : uniquement des
--  SELECT sur les vues système. Il peut être lancé sans précaution.
--
--  POURQUOI CE SCRIPT
--
--  L'accès direct à la base depuis le poste n'étant pas ouvert, chaque
--  question posée au serveur coûte un aller-retour humain. Plutôt que de
--  découvrir les réponses une par une au fil de la conversion du schéma, on
--  les demande toutes en une fois.
--
--  La question 5 est la plus importante : le choix de SQL Server comme cible
--  repose entièrement sur le fait que ces bases sont sauvegardées, alors que
--  les VM ne le sont pas. Autant le vérifier plutôt que le supposer.
--
--  COMMENT RÉPONDRE : renvoyer la sortie des 6 blocs, même partielle. Si l'un
--  échoue faute de droits (le bloc 5 lit msdb), passer au suivant — chaque
--  bloc est indépendant.
--
--  IMPORTANT — le premier passage du 2026-11-19 a été exécuté dans le contexte
--  d'une AUTRE base (MicroServices) : les blocs 2, 3 et 4 décrivaient donc une
--  application qui n'est pas la nôtre. Le USE ci-dessous évite que ça se
--  reproduise. Le bloc 2 affiche DB_NAME() précisément pour qu'on puisse le
--  vérifier d'un coup d'œil.
-- ============================================================================

USE Checkmate;
GO


-- ── 1. Version et édition ───────────────────────────────────────────────────
-- Détermine ce qui est disponible : les fonctions JSON existent depuis 2016,
-- STRING_AGG depuis 2017. La conversion s'écrit différemment selon la réponse.
SELECT
    'Bloc 1 : serveur'                     AS bloc,
    SERVERPROPERTY('ProductVersion')       AS version_produit,
    SERVERPROPERTY('ProductLevel')         AS niveau_correctif,
    SERVERPROPERTY('Edition')              AS edition,
    SERVERPROPERTY('EngineEdition')        AS edition_moteur,
    SERVERPROPERTY('Collation')            AS collation_serveur;


-- ── 2. Collation de la base, et sensibilité à la casse ──────────────────────
-- Décisif pour la recherche de la liste des occurrences. En PostgreSQL elle
-- utilise ILIKE (insensible à la casse). Si la collation est « CI »
-- (case-insensitive), LIKE suffit et la traduction est gratuite ; si elle est
-- « CS », il faudra un COLLATE explicite sur chaque comparaison.
SELECT
    'Bloc 2 : collation'                                    AS bloc,
    DB_NAME()                                               AS base,
    CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation_base,
    CASE WHEN 'a' = 'A' THEN 'INSENSIBLE a la casse'
         ELSE 'SENSIBLE a la casse' END                     AS comparaison_texte,
    CASE WHEN 'e' = N'é' THEN 'INSENSIBLE aux accents'
         ELSE 'SENSIBLE aux accents' END                    AS comparaison_accents;


-- ── 3. État de la base Checkmate ────────────────────────────────────────────
-- Attendu : vide. Si des objets existent déjà, il faut le savoir avant de
-- charger quoi que ce soit.
SELECT
    'Bloc 3 : contenu'            AS bloc,
    s.name                        AS schema_nom,
    t.name                        AS table_nom,
    p.rows                        AS lignes
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
ORDER BY s.name, t.name;

-- Si le bloc 3 ne renvoie aucune ligne, la base est vide — c'est le cas attendu.


-- ── 4. Droits du compte applicatif ──────────────────────────────────────────
-- Il doit pouvoir créer des tables, des vues, des fonctions et des
-- déclencheurs, puis écrire dedans. Sans CREATE FUNCTION ni CREATE TRIGGER,
-- la conversion des 6 fonctions et 4 déclencheurs plpgsql est bloquée.
SELECT
    'Bloc 4 : droits'             AS bloc,
    dp.name                       AS compte,
    dp.type_desc                  AS type_compte,
    perm.permission_name          AS permission,
    perm.state_desc               AS etat
FROM sys.database_principals dp
LEFT JOIN sys.database_permissions perm ON perm.grantee_principal_id = dp.principal_id
WHERE dp.name = 'checkmate' OR dp.name = USER_NAME()
ORDER BY dp.name, perm.permission_name;

-- Appartenance aux rôles (db_owner couvre tout ce qui précède).
SELECT
    'Bloc 4b : roles'             AS bloc,
    membre.name                   AS compte,
    role.name                     AS role_nom
FROM sys.database_role_members drm
JOIN sys.database_principals role   ON role.principal_id   = drm.role_principal_id
JOIN sys.database_principals membre ON membre.principal_id = drm.member_principal_id
WHERE membre.name = 'checkmate' OR membre.name = USER_NAME();


-- ── 5. Sauvegardes et mode de restauration ──────────────────────────────────
-- Renseigné depuis : l'infra sauvegarde bien ces bases, via un outil qui
-- n'écrit pas dans msdb — seules les nouvelles VM Azure ne sont pas encore
-- couvertes, et le serveur de fichiers a son propre plan (TI, 2026-11-19).
--
-- Ces requêtes restent utiles pour deux choses : connaître le mode de
-- restauration (SIMPLE = retour à la dernière complète, pas à un instant
-- choisi), et disposer d'un point de repère si la question se repose.
--
-- Lit msdb : si les droits manquent, passer au bloc suivant, ce n'est plus
-- bloquant.
SELECT
    'Bloc 5 : mode de restauration'  AS bloc,
    name                             AS base,
    recovery_model_desc              AS mode_restauration,
    state_desc                       AS etat
FROM sys.databases
WHERE database_id > 4            -- hors bases système
ORDER BY name;

SELECT TOP (25)
    'Bloc 5b : sauvegardes recentes' AS bloc,
    bs.database_name                 AS base,
    CASE bs.type WHEN 'D' THEN 'complete'
                 WHEN 'I' THEN 'differentielle'
                 WHEN 'L' THEN 'journal'
                 ELSE bs.type END    AS type_sauvegarde,
    bs.backup_start_date             AS debut,
    CAST(bs.backup_size / 1048576.0 AS decimal(12,2)) AS taille_mo
FROM msdb.dbo.backupset bs
ORDER BY bs.backup_start_date DESC;

-- Âge de la dernière sauvegarde complète, par base. Une date seule se lit mal ;
-- un nombre de jours saute aux yeux.
--
-- RÉSOLU le 2026-11-19 : au premier passage, l'entrée la plus récente de msdb
-- datait du 2025-10-08 et le gros du 2025-03-27. Ce n'est pas le signe d'une
-- absence de sauvegarde — l'infra passe par un outil qui n'écrit pas dans
-- msdb. Le TI a précisé que seules les nouvelles VM Azure ne sont pas encore
-- couvertes, que le reste tourne à ~90 %, et que le serveur de fichiers a son
-- propre plan. La requête reste utile pour surveiller, pas pour soupçonner.
SELECT
    'Bloc 5c : age des sauvegardes'  AS bloc,
    d.name                           AS base,
    MAX(bs.backup_finish_date)       AS derniere_complete,
    DATEDIFF(day, MAX(bs.backup_finish_date), GETDATE()) AS jours_depuis
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset bs
       ON bs.database_name = d.name AND bs.type = 'D'
WHERE d.database_id > 4
GROUP BY d.name
ORDER BY jours_depuis DESC;


-- ── 6. Fonctionnalités dont dépend la conversion ────────────────────────────
-- NEWSEQUENTIALID remplace gen_random_uuid() pour les 29 colonnes uuid, avec
-- l'avantage de ne pas fragmenter les index comme le ferait NEWID().
-- ISJSON existe depuis 2016 et servira à la seule colonne jsonb
-- (saved_reports.config).
SELECT
    'Bloc 6 : fonctionnalites'                                          AS bloc,
    TRY_CONVERT(int, SERVERPROPERTY('ProductMajorVersion'))             AS version_majeure,
    CASE WHEN TRY_CONVERT(int, SERVERPROPERTY('ProductMajorVersion')) >= 13
         THEN 'JSON disponible (2016+)' ELSE 'PAS de JSON natif' END    AS json_natif,
    CASE WHEN TRY_CONVERT(int, SERVERPROPERTY('ProductMajorVersion')) >= 14
         THEN 'STRING_AGG disponible (2017+)' ELSE 'PAS de STRING_AGG' END AS string_agg;

-- ============================================================================
--  FIN — aucune écriture n'a été effectuée.
-- ============================================================================
