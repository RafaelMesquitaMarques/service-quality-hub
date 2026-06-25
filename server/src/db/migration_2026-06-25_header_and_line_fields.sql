-- ============================================================
-- Migration 2026-06-25 (2) — Champs header + REF SO par ligne
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- (À exécuter en plus de migration_2026-06-25_line_classification.sql)
-- ============================================================
--
-- Changements :
--   - « Wish delivery date » ajoutée au header de l'occurrence ; la
--     « delivery_date » existante devient « Original delivery date »
--     (simple renommage de libellé côté UI, la colonne ne change pas).
--   - « REF SO » passe au niveau de la LIGNE (chaque ligne peut avoir un
--     REF SO différent). Backfill depuis l'occurrence parente.
--   - « Ship to » / « Sold to » ne sont plus utilisés dans l'UI ; les
--     colonnes sont CONSERVÉES (historique + import Excel), simplement
--     plus affichées.

-- 1. Header : date de livraison souhaitée
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS wish_delivery_date DATE;

-- 2. Ligne : REF SO
ALTER TABLE occurrence_lines
  ADD COLUMN IF NOT EXISTS ref_so VARCHAR(50);

-- 3. Backfill : recopier le REF SO de l'occurrence vers ses lignes existantes
UPDATE occurrence_lines l
SET ref_so = t.ref_so
FROM tickets t
WHERE l.occurrence_id = t.id
  AND (l.ref_so IS NULL OR l.ref_so = '')
  AND t.ref_so IS NOT NULL;

-- 4. IMPORTANT — recréer la vue tickets_with_cost (EN DERNIER).
--    Le frontend lit l'occurrence via cette vue ; elle n'expose pas
--    automatiquement la nouvelle colonne wish_delivery_date de `tickets`.
--    Même approche que les migrations précédentes : on enveloppe la
--    définition existante et on ajoute la colonne manquante.
--    (ref_so est lu directement depuis occurrence_lines — pas via la vue.)
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_viewdef('public.tickets_with_cost'::regclass, true);
  def := regexp_replace(def, ';\s*$', '');
  EXECUTE 'DROP VIEW public.tickets_with_cost';
  EXECUTE 'CREATE VIEW public.tickets_with_cost AS
    SELECT v.*, t.wish_delivery_date
    FROM (' || def || ') v
    JOIN public.tickets t ON t.id = v.id';
END $$;
