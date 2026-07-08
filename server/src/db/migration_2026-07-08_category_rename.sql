-- ============================================================
-- Migration 2026-07-08 — Renommer les anciennes catégories
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi).
-- Data-only : aucune colonne ni vue à recréer.
-- ============================================================
--
-- Contexte : la liste des catégories a été mise à jour (commit 952c2c3).
-- On aligne les valeurs DÉJÀ enregistrées sur les nouveaux libellés.
--
-- Décision utilisateur (2026-07-08) : ne renommer QUE les correspondances
-- évidentes. Les autres anciennes valeurs (Wrong item, Assembly issue,
-- Finish defect, Measurement, Other) restent inchangées. AUCUN renommage
-- de département — « Logistics » est conservé tel quel.
--
-- La catégorie existe à la fois sur `tickets` (niveau occurrence) et
-- `occurrence_lines` (par ligne) : on met à jour les DEUX tables.

-- Damage → Damaged
UPDATE tickets          SET categories = 'Damaged' WHERE categories = 'Damage';
UPDATE occurrence_lines SET categories = 'Damaged' WHERE categories = 'Damage';

-- Missing parts → Missing Component
UPDATE tickets          SET categories = 'Missing Component' WHERE categories = 'Missing parts';
UPDATE occurrence_lines SET categories = 'Missing Component' WHERE categories = 'Missing parts';

-- (Packaging : inchangé. Départements : aucun renommage — « Logistics » gardé.)

-- Vérification optionnelle après exécution :
--   SELECT categories, count(*) FROM tickets          GROUP BY categories ORDER BY 2 DESC;
--   SELECT categories, count(*) FROM occurrence_lines GROUP BY categories ORDER BY 2 DESC;
