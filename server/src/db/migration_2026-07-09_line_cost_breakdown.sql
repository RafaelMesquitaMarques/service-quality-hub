-- ============================================================
-- Migration 2026-07-09 (2) — Coût par ligne en 3 catégories
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT / au moment du déploiement du frontend.
-- ============================================================
--
-- Le coût d'une ligne (occurrence_lines.cost_approx) se décompose désormais en
-- 3 postes : mobilier / transport / installation. `cost_approx` reste le TOTAL
-- (= somme des 3) et demeure la source de vérité de tous les agrégats
-- (liste, dashboard, réunions) — donc rien d'autre ne change.

ALTER TABLE occurrence_lines
  ADD COLUMN IF NOT EXISTS cost_furniture NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cost_freight   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cost_install   NUMERIC(10,2);

-- Backfill : l'ancien coût de la ligne devient « mobilier » (poste par défaut),
-- pour que le total (cost_approx) reste strictement inchangé.
UPDATE occurrence_lines
  SET cost_furniture = cost_approx
  WHERE cost_approx IS NOT NULL AND cost_furniture IS NULL;
