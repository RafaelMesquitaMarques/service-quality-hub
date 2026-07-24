-- ============================================================
-- Migration 2026-07-24 — Suppression réelle d'utilisateurs
-- À exécuter dans le SQL Editor de Supabase AVANT de déployer
-- le frontend correspondant.
--
-- Problème: le bouton « corbeille » de la page Administration ne
-- supprimait jamais l'utilisateur — il mettait seulement
-- user_profiles.active = false. Le compte restait dans la liste
-- (« Inactif ») et dans Supabase Auth (email non réutilisable).
-- Une vraie suppression exige la clé service, impossible depuis
-- le client (clé anon).
--
-- Solution: fonction SECURITY DEFINER appelée par RPC depuis le
-- client (supabase.rpc('admin_remove_user', { target_id })):
--   * vérifie que l'appelant est un admin actif
--   * interdit l'auto-suppression
--   * DELETE FROM auth.users → cascade vers user_profiles
--   * si des enregistrements référencent l'utilisateur (occurrences,
--     photos, historique, réunions…) la suppression violerait leurs
--     clés étrangères → on garde le compte pour l'attribution et on
--     le désactive seulement; la fonction retourne 'deactivated'
--     au lieu de 'deleted'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_remove_user(target_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin' AND active IS NOT FALSE
  ) INTO caller_is_admin;

  IF NOT caller_is_admin THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  BEGIN
    DELETE FROM auth.users WHERE id = target_id;

    IF NOT FOUND THEN
      -- Profil sans compte auth (orphelin) → supprimer le profil directement
      DELETE FROM public.user_profiles WHERE id = target_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
      END IF;
    END IF;

    RETURN 'deleted';

  EXCEPTION WHEN foreign_key_violation THEN
    -- L'utilisateur est référencé ailleurs → désactivation seulement
    UPDATE public.user_profiles
    SET active = false, updated_at = now()
    WHERE id = target_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'user_not_found';
    END IF;

    RETURN 'deactivated';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_user(uuid) TO authenticated;

-- Vérification (après exécution):
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'admin_remove_user';
--   → 1 ligne, prosecdef = true
