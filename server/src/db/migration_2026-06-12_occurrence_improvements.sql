-- ============================================================
-- Migration 2026-06-12 — Améliorations occurrence
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- ============================================================

-- 1. Nouveaux champs au header de l'occurrence (table tickets)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS delivery_date    DATE,
  ADD COLUMN IF NOT EXISTS installer_needed BOOLEAN,
  ADD COLUMN IF NOT EXISTS urgency          VARCHAR(20)
    CHECK (urgency IN ('overnight','urgent','normal')),
  ADD COLUMN IF NOT EXISTS comment          TEXT;

-- 2. Nouveaux champs au niveau de la ligne (table occurrence_lines)
ALTER TABLE occurrence_lines
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS root_cause  TEXT,
  ADD COLUMN IF NOT EXISTS total_qty   INTEGER;

-- 3. Original SO (header de l'occurrence)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS original_so VARCHAR(50);

-- 4. Numéro d'occurrence séquentiel (#)
--    Backfill des occurrences existantes par date de création,
--    puis numérotation automatique pour les nouvelles.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS occurrence_no INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM tickets
)
UPDATE tickets t
SET occurrence_no = n.rn
FROM numbered n
WHERE t.id = n.id AND t.occurrence_no IS NULL;

CREATE SEQUENCE IF NOT EXISTS tickets_occurrence_no_seq;
SELECT setval('tickets_occurrence_no_seq', COALESCE((SELECT MAX(occurrence_no) FROM tickets), 0));
ALTER TABLE tickets ALTER COLUMN occurrence_no SET DEFAULT nextval('tickets_occurrence_no_seq');
ALTER SEQUENCE tickets_occurrence_no_seq OWNED BY tickets.occurrence_no;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_occurrence_no ON tickets(occurrence_no);

-- 5. Mise à jour de la liste des usines → QS, QM, NL, NC
INSERT INTO plants (name, country, active)
SELECT v.name, 'Other', true
FROM (VALUES ('QS'),('QM'),('NL'),('NC')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM plants p WHERE p.name = v.name);

UPDATE plants SET active = true  WHERE name IN ('QS','QM','NL','NC');
UPDATE plants SET active = false WHERE name NOT IN ('QS','QM','NL','NC');
-- NB: les usines existantes (Canada, China, USA, Vietnam, QS…) ne sont pas
-- supprimées, seulement désactivées — les anciennes occurrences gardent leur
-- valeur. Pays/ville des nouvelles usines ajustables via la page Usines.

-- 6. IMPORTANT — recréer la vue tickets_with_cost (à faire EN DERNIER)
-- Les lectures du frontend passent par cette vue; elle n'expose PAS
-- automatiquement les nouvelles colonnes de `tickets`. Le bloc ci-dessous
-- enveloppe la définition existante et y ajoute les nouvelles colonnes.
-- (Exécuté en production le 2026-06-12.)
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_viewdef('public.tickets_with_cost'::regclass, true);
  def := regexp_replace(def, ';\s*$', '');
  EXECUTE 'DROP VIEW public.tickets_with_cost';
  EXECUTE 'CREATE VIEW public.tickets_with_cost AS
    SELECT v.*,
           t.delivery_date, t.installer_needed, t.urgency, t.comment,
           t.original_so, t.occurrence_no
    FROM (' || def || ') v
    JOIN public.tickets t ON t.id = v.id';
END $$;
