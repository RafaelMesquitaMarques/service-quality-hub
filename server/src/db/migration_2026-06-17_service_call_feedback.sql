-- ============================================================
-- Migration 2026-06-17 — Retours utilisateur sur l'outil service call
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================

-- 1. « Project name » au header de l'occurrence (texte libre)
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS project_name TEXT;

-- 2. « Complete product / Parts only » au niveau de la ligne
ALTER TABLE occurrence_lines
  ADD COLUMN IF NOT EXISTS completion_type VARCHAR(20)
    CHECK (completion_type IN ('complete','parts'));

-- 3. Prise en charge des vidéos : distinguer image / vidéo dans ticket_photos
--    (les anciennes lignes restent des images par défaut).
ALTER TABLE ticket_photos
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) NOT NULL DEFAULT 'image';

-- 4. Bucket de stockage : relever la limite de taille pour accepter les vidéos.
--    NB: la limite GLOBALE du projet (Dashboard → Storage → Settings →
--    "Upload file size limit") doit être >= cette valeur, sinon l'upload
--    sera refusé même si le bucket l'autorise. Si `allowed_mime_types` est
--    défini (non NULL) sur ce bucket, il faut y ajouter les types vidéo
--    (video/mp4, video/quicktime, video/webm, ...). NULL = tous types permis.
UPDATE storage.buckets
SET file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 52428800)  -- 50 Mo
WHERE id = 'ticket-photos';

-- 5. IMPORTANT — recréer la vue tickets_with_cost (à faire EN DERNIER).
--    Les lectures du frontend passent par cette vue; elle n'expose PAS
--    automatiquement la nouvelle colonne `project_name` de `tickets`.
--    Même approche que la migration 2026-06-12 : on enveloppe la définition
--    existante et on ajoute la colonne manquante.
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_viewdef('public.tickets_with_cost'::regclass, true);
  def := regexp_replace(def, ';\s*$', '');
  EXECUTE 'DROP VIEW public.tickets_with_cost';
  EXECUTE 'CREATE VIEW public.tickets_with_cost AS
    SELECT v.*, t.project_name
    FROM (' || def || ') v
    JOIN public.tickets t ON t.id = v.id';
END $$;
