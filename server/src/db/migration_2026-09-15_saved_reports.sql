-- ============================================================
-- Migration 2026-09-15 — Rapports enregistrés (module « Rapports »)
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================
--
-- Une ligne = une CONFIGURATION de rapport (colonnes, filtres, tri,
-- regroupements, période fixe ou relative). Elle ne contient aucune donnée :
-- chaque exécution relit les occurrences avec la session — donc la RLS — de la
-- personne qui l'ouvre. Partager une configuration n'ouvre l'accès à rien de plus.
--
-- Droits (miroir de client/src/pages/Reports/engine/permissions.js) :
--   * lire     : ses propres rapports + les rapports partagés ;
--   * créer    : pour soi ; en « partagé » seulement si admin / manager ;
--   * modifier : ses propres rapports (passer en « partagé » : admin / manager) ;
--                un admin peut aussi modifier un rapport partagé ;
--   * supprimer: ses propres rapports ; un admin, n'importe lequel.
-- Aucune modification des tables existantes. Idempotent.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(150) NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  visibility   varchar(10)  NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  template_id  varchar(50),
  config       jsonb        NOT NULL CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 262144),
  -- SET NULL : supprimer un utilisateur ne détruit pas les rapports partagés
  -- (un admin peut ensuite les gérer) et ne bloque pas admin_remove_user.
  owner_id     uuid DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_owner      ON public.saved_reports(owner_id);
CREATE INDEX IF NOT EXISTS idx_saved_reports_visibility ON public.saved_reports(visibility);

-- updated_at automatique ; propriétaire et date de création immuables (un admin
-- qui modifie un rapport partagé ne peut pas se l'approprier ni le réattribuer).
-- Le passage à NULL reste permis : c'est l'effet de ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.saved_reports_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  NEW.created_at = OLD.created_at;
  IF NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    NEW.owner_id = OLD.owner_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS saved_reports_touch ON public.saved_reports;
CREATE TRIGGER saved_reports_touch BEFORE UPDATE ON public.saved_reports
  FOR EACH ROW EXECUTE FUNCTION public.saved_reports_touch();

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_reports TO authenticated;

DROP POLICY IF EXISTS "saved_reports_select" ON public.saved_reports;
CREATE POLICY "saved_reports_select" ON public.saved_reports FOR SELECT
  USING (auth.role() = 'authenticated' AND (owner_id = auth.uid() OR visibility = 'shared'));

DROP POLICY IF EXISTS "saved_reports_insert" ON public.saved_reports;
CREATE POLICY "saved_reports_insert" ON public.saved_reports FOR INSERT
  WITH CHECK (
    owner_id = auth.uid() AND (
      visibility = 'private'
      OR EXISTS (SELECT 1 FROM public.user_profiles p
                 WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager') AND p.active IS NOT FALSE)
    )
  );

DROP POLICY IF EXISTS "saved_reports_update" ON public.saved_reports;
CREATE POLICY "saved_reports_update" ON public.saved_reports FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR (visibility = 'shared' AND EXISTS (SELECT 1 FROM public.user_profiles p
                                          WHERE p.id = auth.uid() AND p.role = 'admin' AND p.active IS NOT FALSE))
  )
  WITH CHECK (
    (owner_id = auth.uid() AND (
      visibility = 'private'
      OR EXISTS (SELECT 1 FROM public.user_profiles p
                 WHERE p.id = auth.uid() AND p.role IN ('admin', 'manager') AND p.active IS NOT FALSE)))
    OR (visibility = 'shared' AND EXISTS (SELECT 1 FROM public.user_profiles p
                                          WHERE p.id = auth.uid() AND p.role = 'admin' AND p.active IS NOT FALSE))
  );

DROP POLICY IF EXISTS "saved_reports_delete" ON public.saved_reports;
CREATE POLICY "saved_reports_delete" ON public.saved_reports FOR DELETE
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles p
               WHERE p.id = auth.uid() AND p.role = 'admin' AND p.active IS NOT FALSE)
  );

COMMIT;

-- ============================================================
-- Vérification (RLS) — à exécuter APRÈS, dans une transaction annulée :
-- rien n'est conservé. Remplacer <uuid-cpm>, <uuid-autre>, <uuid-manager>.
-- ============================================================
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<uuid-cpm>","role":"authenticated"}', true);
--   INSERT INTO saved_reports (name, visibility, config, owner_id) VALUES ('t perso', 'private', '{}', '<uuid-cpm>');   -- OK
--   INSERT INTO saved_reports (name, visibility, config, owner_id) VALUES ('t partagé', 'shared', '{}', '<uuid-cpm>');  -- ERREUR (cpm)
--   SELECT set_config('request.jwt.claims', '{"sub":"<uuid-autre>","role":"authenticated"}', true);
--   SELECT count(*) FROM saved_reports WHERE name = 't perso';                                                         -- 0
-- ROLLBACK;
