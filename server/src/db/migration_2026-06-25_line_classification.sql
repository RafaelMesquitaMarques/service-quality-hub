-- ============================================================
-- Migration 2026-06-25 — Classification & coût par ligne
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================
--
-- Contexte : la catégorie, le département, la cause racine, l'action
-- corrective et le coût approx. doivent pouvoir être renseignés POUR CHAQUE
-- LIGNE (différentes causes peuvent être identifiées pour différentes lignes),
-- en plus du niveau occurrence qui est conservé tel quel.
--
-- Déjà présents sur occurrence_lines : root_cause (migration 2026-06-12)
-- et cost_approx. On n'ajoute donc que les 3 colonnes manquantes.
--
-- Visibilité côté UI (rappel, géré dans le frontend, pas en base) :
--   - coût approx. par ligne : étapes Service Desk ET Réunion qualité ;
--   - catégorie / département / cause racine / action corrective par ligne :
--     étape Réunion qualité uniquement.

ALTER TABLE occurrence_lines
  ADD COLUMN IF NOT EXISTS categories         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS department         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS corrective_action  TEXT;

-- NB : aucune recréation de la vue tickets_with_cost n'est nécessaire — le
-- frontend lit occurrence_lines directement (supabase.from('occurrence_lines')),
-- pas à travers la vue. Les rapports (Dashboard / révision hebdo) continuent
-- d'utiliser les champs au niveau occurrence et le real_cost existant.
