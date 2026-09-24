-- ============================================================
-- Migration 2026-09-24 — Case « Notification envoyée » (Service Desk)
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================
--
-- Le Service Desk coche sur la fiche de l'occurrence (carte Service Desk, sous
-- le SC#) que la notification a été envoyée ; la liste des occurrences affiche
-- l'état de la case dans une colonne à cloche (filtre Oui / Non).
--
-- 1. tickets.notification_sent — BOOLEAN NOT NULL DEFAULT false : les
--    occurrences existantes valent « non envoyée », aucune donnée à reprendre.
--    Qui a coché et quand : piste d'audit (ticket_history), comme tout champ
--    modifié depuis la fiche.
-- 2. Vue tickets_with_cost : la liste et la fiche lisent l'occurrence par cette
--    vue, qui n'expose pas d'elle-même une nouvelle colonne de `tickets`. Même
--    enveloppe que les migrations 2026-06-12 / 06-17 / 06-25, mais en
--    CREATE OR REPLACE plutôt que DROP + CREATE : la vue garde ses privilèges.
--    CREATE OR REPLACE remet en revanche ses options à zéro, d'où
--    WITH (security_invoker = true), puis REVOKE anon rejoué par précaution
--    (cf. migration_2026-09-15_security_view_profiles.sql).
--
-- Idempotent : rejouable sans risque.
-- ============================================================

BEGIN;

-- 1. Colonne
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tickets.notification_sent IS
  'Service Desk : notification envoyée (case de la fiche, colonne cloche de la liste).';

-- 2. Vue (EN DERNIER)
DO $$
DECLARE
  def text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.tickets_with_cost'::regclass
       AND attname  = 'notification_sent'
       AND NOT attisdropped
  ) THEN
    RAISE NOTICE 'tickets_with_cost expose déjà notification_sent : vue inchangée';
  ELSE
    def := pg_get_viewdef('public.tickets_with_cost'::regclass, true);
    def := regexp_replace(def, ';\s*$', '');
    EXECUTE 'CREATE OR REPLACE VIEW public.tickets_with_cost
      WITH (security_invoker = true) AS
      SELECT v.*, t.notification_sent
      FROM (' || def || ') v
      JOIN public.tickets t ON t.id = v.id';
  END IF;
END $$;

ALTER VIEW public.tickets_with_cost SET (security_invoker = true);
REVOKE ALL ON public.tickets_with_cost FROM anon;

-- PostgREST : recharger le cache de schéma (envoyé au COMMIT)
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Vérification (après exécution)
-- ============================================================
-- • Colonne et valeur par défaut :
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'tickets' AND column_name = 'notification_sent';
-- • Vue : nouvelle colonne, security_invoker conservé, aucun SELECT anonyme :
--   SELECT c.reloptions, has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
--     FROM pg_class c WHERE c.oid = 'public.tickets_with_cost'::regclass;
--   → {security_invoker=true} | false | true
--   SELECT COUNT(*), COUNT(*) FILTER (WHERE notification_sent) FROM public.tickets_with_cost;
--   → même total qu'avant la migration ; 0 cochée
