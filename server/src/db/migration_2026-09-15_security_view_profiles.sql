-- ============================================================
-- Migration 2026-09-15 (2) — CORRECTIFS SÉCURITÉ
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi).
-- Aucun changement de frontend requis. Idempotent.
-- ============================================================
--
-- 1. tickets_with_cost lisible SANS authentification (constaté le 2026-09-15 :
--    requête anonyme → 2 434 occurrences). La migration 2026-06-16 avait posé
--    security_invoker = true, mais les migrations qui RECRÉENT la vue
--    (DROP VIEW + CREATE VIEW : 2026-06-12 occurrence_improvements, 2026-06-17,
--    2026-06-25 header_and_line_fields) ont perdu l'option : la vue, détenue par
--    postgres, contournait de nouveau la RLS de tickets / occurrence_lines.
--    ⚠ Toute future recréation de la vue — DROP + CREATE comme CREATE OR REPLACE,
--      qui remet aussi les options à zéro — DOIT s'écrire
--      CREATE VIEW ... WITH (security_invoker = true) ... puis rejouer
--      REVOKE ALL ... FROM anon (les privilèges par défaut de Supabase rendent
--      SELECT/INSERT/DELETE à anon sur toute nouvelle relation).
--
-- 2. Élévation de privilèges : la politique « users can update own profile »
--    (USING auth.uid() = id, sans WITH CHECK ni restriction de colonnes)
--    permettait à tout utilisateur connecté de se donner role = 'admin', de
--    réactiver son compte ou de s'accorder des perm_*. Les politiques de
--    saved_reports, monthly_revenue, plants, référentiels… s'appuient sur ce rôle.
--    Correctif : un déclencheur n'autorise un non-administrateur qu'à modifier,
--    sur SA propre ligne, les champs réellement utilisés par l'application :
--    language (sélecteur FR/EN) et must_change_password (changement de mot de
--    passe), plus updated_at. Ne sont pas restreints : les administrateurs actifs
--    (politique « admins can update any profile »), la clé service (serveur,
--    fonctions invite-user / reset-password) et les connexions sans JWT (SQL
--    Editor, service d'authentification). La RPC admin_remove_user, appelée par
--    un admin actif, reste permise.
--    Vérifié avant application (2026-09-15) : les 3 admins actifs ont
--    active = true ; aucun non-admin n'a perm_admin ; aucune colonne générée ;
--    aucun déclencheur sur auth.users.
--    NB : le déclencheur ne couvre que UPDATE — aucune politique INSERT n'existe
--    pour authenticated. Toute future politique INSERT sur user_profiles devra
--    s'accompagner d'une garde équivalente.
-- ============================================================

BEGIN;

-- ── 1. Vues : RLS de l'appelant, aucun accès anonyme ─────────────────────────
ALTER VIEW public.tickets_with_cost SET (security_invoker = true);
REVOKE ALL ON public.tickets_with_cost FROM anon;
-- tickets_with_users est déjà en security_invoker ; défense en profondeur
-- (seul le serveur, avec la clé service, la lit).
REVOKE ALL ON public.tickets_with_users FROM anon;

-- ── 2. user_profiles : champs de privilège réservés aux administrateurs ─────
CREATE OR REPLACE FUNCTION public.user_profiles_guard_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- lit user_profiles sans repasser par sa RLS
SET search_path = ''
AS $$
DECLARE
  jwt_role text := auth.role();
  caller   uuid := auth.uid();
  self_editable text[] := ARRAY['language', 'must_change_password', 'updated_at'];
  forbidden text[];
BEGIN
  -- Sans JWT utilisateur (SQL Editor, migrations, service d'authentification)
  -- ou avec la clé service : aucune restriction.
  IF jwt_role IS NULL OR jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Administrateur actif : autorisé (la RLS encadre déjà ce qu'il peut viser).
  IF caller IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = caller AND p.role = 'admin' AND p.active IS NOT FALSE
  ) THEN
    RETURN NEW;
  END IF;

  -- Tout autre appelant : uniquement sa propre ligne…
  IF caller IS NULL OR OLD.id IS DISTINCT FROM caller OR NEW.id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'user_profiles : modification réservée aux administrateurs'
      USING ERRCODE = '42501';
  END IF;

  -- … et seulement les champs self_editable (colonnes générées ignorées : elles
  -- valent NULL dans NEW pendant un BEFORE UPDATE).
  SELECT array_agg(n.key ORDER BY n.key) INTO forbidden
  FROM jsonb_each(to_jsonb(NEW)) AS n
  JOIN jsonb_each(to_jsonb(OLD)) AS o USING (key)
  WHERE n.value IS DISTINCT FROM o.value
    AND NOT (n.key = ANY (self_editable))
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = TG_RELID AND a.attname = n.key AND a.attgenerated <> ''
    );

  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'user_profiles : modification réservée aux administrateurs (%)', array_to_string(forbidden, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Le déclencheur s'exécute sans que l'appelant ait EXECUTE sur la fonction.
REVOKE ALL ON FUNCTION public.user_profiles_guard_privileges() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_profiles_guard_privileges ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_privileges
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_guard_privileges();

COMMIT;

-- ============================================================
-- Vérification (après exécution)
-- ============================================================
-- • Toutes les vues publiques : security_invoker = true et aucun SELECT anonyme.
--   SELECT c.relname, c.reloptions, has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
--   FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm');
-- • Anonyme, doit renvoyer 401 (permission denied) :
--   curl "<SUPABASE_URL>/rest/v1/tickets_with_cost?select=id&limit=1" -H "apikey: <ANON_KEY>"
-- • Rôles (cpm / manager / admin / service / postgres) : bloc DO terminé par
--   RAISE EXCEPTION, pour que rien ne soit conservé (fait le 2026-09-15).
