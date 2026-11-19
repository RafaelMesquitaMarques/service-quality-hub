-- Migration 2026-11-19b : ajouter la politique UPDATE manquante sur meetings
--
-- A executer APRES migration_2026-11-19_rls_cleanup.sql, dont cette migration
-- reutilise la fonction public.app_role().
--
-- LE BOGUE
--
-- La table `meetings` avait des politiques RLS pour SELECT, INSERT et DELETE,
-- mais AUCUNE pour UPDATE. Sous RLS, un UPDATE qui ne correspond a aucune
-- politique ne leve pas d'erreur : il touche simplement zero ligne. Et
-- `Meetings/index.jsx` ne testait que `error` :
--
--     const { error } = await supabase.from('meetings').update({ notes, ... })
--     if (error) throw error        -- error est null, donc onSuccess
--
-- Resultat : l'ecran affichait « notes enregistrees » et rien ne l'etait.
--
-- CONSTAT SUR LES DONNEES DE PRODUCTION (2026-11-18)
--
--   24 reunions, de juin a novembre 2026
--    0 avec des notes non vides
--    0 avec updated_at different de created_at
--
-- Aucune reunion n'a donc jamais ete modifiee avec succes depuis que la
-- fonctionnalite existe.
--
-- POURQUOI CE N'ETAIT PAS DANS LA MIGRATION PRECEDENTE
--
-- Ajouter une politique est un ELARGISSEMENT de droits. La migration de
-- securite du meme jour ne faisait que resserrer, et melanger les deux aurait
-- rendu sa revue plus difficile. Ici il s'agit d'une fonctionnalite cassee,
-- pas d'une mesure de protection.
--
-- Les droits retenus sont ceux de la creation et de la suppression des
-- reunions : admin, manager, service_desk.
--
-- Cote front, les ecritures de Meetings/index.jsx verifient desormais le
-- NOMBRE DE LIGNES TOUCHEES (.select() puis controle), et plus seulement
-- l'absence d'erreur. Un UPDATE ou un DELETE refuse par la RLS devient donc
-- visible au lieu d'etre silencieux.

BEGIN;

CREATE POLICY "Managers and admins can update meetings" ON public.meetings
  FOR UPDATE TO authenticated
  USING      (public.app_role() = ANY (ARRAY['admin','manager','service_desk']))
  WITH CHECK (public.app_role() = ANY (ARRAY['admin','manager','service_desk']));

COMMIT;

-- VERIFICATION : meetings doit maintenant avoir 4 politiques
--   Authenticated users can delete meetings        DELETE
--   Managers and admins can create meetings        INSERT
--   Managers and admins can update meetings        UPDATE   <- ajoutee ici
--   Authenticated users can read meetings          SELECT
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'meetings'
--  ORDER BY cmd, policyname;
--
-- Test fonctionnel : ouvrir une reunion, saisir une note, enregistrer, puis
-- recharger la page. La note doit persister.

-- ROLLBACK
-- DROP POLICY "Managers and admins can update meetings" ON public.meetings;
