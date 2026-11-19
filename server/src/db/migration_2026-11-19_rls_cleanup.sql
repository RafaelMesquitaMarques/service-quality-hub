-- Migration 2026-11-19 : corriger les politiques RLS
--
-- PARTIE A : retirer les politiques larges qui neutralisaient les strictes
-- PARTIE B : rendre le role « viewer » reellement en lecture seule
--
-- Contexte : les politiques PostgreSQL « permissives » (toutes celles-ci) se
-- combinent en OU. Deux politiques sur la meme table et la meme commande ne se
-- restreignent donc jamais l'une l'autre : la plus large gagne.
--
-- Effet reel AVANT cette migration :
--   - tout compte connecte pouvait SUPPRIMER n'importe quelle occurrence
--   - tout compte connecte pouvait MODIFIER n'importe quelle occurrence
--   - tout compte connecte pouvait creer/modifier/supprimer une USINE
--   - un compte `viewer` pouvait creer des occurrences et editer les lignes,
--     donc les COUTS ; son caractere « lecture seule » n'existait que dans
--     l'interface (hook usePermissions), pas dans la base
--
-- Impact mesure sur les 12 640 lignes de ticket_history (2026-11-19) :
--   4 849 modifications par le createur de l'occurrence   -> inchange
--   7 364 par un role encadrant sur l'occurrence d'autrui -> inchange
--      45 par un cpm/viewer sur l'occurrence d'autrui     -> desormais refusees
--   soit 0,37 %. Sur ces 45, 36 viennent de comptes `viewer`.
--
-- NOTE : si ces comptes `viewer` devaient en realite etre `cpm` ou
-- `service_desk`, c'est leur role qu'il faut corriger — cette migration ne le
-- fait pas.
--
-- NON TRAITE VOLONTAIREMENT : `meetings` n'a aucune politique UPDATE, donc
-- modifier une reunion echoue aujourd'hui pour tout compte non service_role.
-- En ajouter une serait un ELARGISSEMENT ; a verifier sur la page Reunions
-- avant de le faire, hors de cette migration qui ne fait que resserrer.
--
-- Reversible : section ROLLBACK en fin de fichier.

BEGIN;

-- ===========================================================================
-- PARTIE A — retirer les politiques qui annulaient les restrictions
-- ===========================================================================

DROP POLICY IF EXISTS "delete tickets"   ON public.tickets;  -- annulait « Only admins can delete »
DROP POLICY IF EXISTS "update tickets"   ON public.tickets;  -- annulait la regle createur/encadrant
DROP POLICY IF EXISTS authenticated_all  ON public.plants;   -- annulait plants_write (admin)

-- doublons sans effet sur le comportement
DROP POLICY IF EXISTS "insert tickets"   ON public.tickets;
DROP POLICY IF EXISTS "read tickets"     ON public.tickets;

-- ===========================================================================
-- PARTIE B — « viewer » en lecture seule
-- ===========================================================================

-- Role du compte courant, ou NULL s'il n'a pas de profil ou s'il est desactive.
-- Volontairement SANS security definer : la lecture de user_profiles est deja
-- ouverte aux comptes connectes par « users can read profiles ».
-- NULL fait echouer les comparaisons ci-dessous, donc un compte desactive perd
-- aussi le droit d'ecrire — ce qui est voulu.
CREATE OR REPLACE FUNCTION public.app_role() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = public
AS $fn$
  SELECT role::text FROM public.user_profiles
   WHERE id = auth.uid() AND active IS NOT FALSE
$fn$;

-- tickets : creation interdite au viewer
DROP POLICY IF EXISTS "Authenticated users can insert tickets" ON public.tickets;
CREATE POLICY "Authenticated users can insert tickets" ON public.tickets
  FOR INSERT TO authenticated WITH CHECK (public.app_role() <> 'viewer');

-- occurrence_lines : lecture ouverte, ecriture interdite au viewer
-- (ces lignes portent les couts)
DROP POLICY IF EXISTS "Authenticated users can insert occurrence_lines" ON public.occurrence_lines;
CREATE POLICY "Authenticated users can insert occurrence_lines" ON public.occurrence_lines
  FOR INSERT TO authenticated WITH CHECK (public.app_role() <> 'viewer');

DROP POLICY IF EXISTS "Authenticated users can update occurrence_lines" ON public.occurrence_lines;
CREATE POLICY "Authenticated users can update occurrence_lines" ON public.occurrence_lines
  FOR UPDATE TO authenticated USING (public.app_role() <> 'viewer');

DROP POLICY IF EXISTS "Authenticated users can delete occurrence_lines" ON public.occurrence_lines;
CREATE POLICY "Authenticated users can delete occurrence_lines" ON public.occurrence_lines
  FOR DELETE TO authenticated USING (public.app_role() <> 'viewer');

-- ticket_photos : depot interdit au viewer
-- (modification/suppression l'excluaient deja)
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON public.ticket_photos;
CREATE POLICY "Authenticated users can upload photos" ON public.ticket_photos
  FOR INSERT TO authenticated WITH CHECK (public.app_role() <> 'viewer');

-- meetings : suppression alignee sur la creation (admin/manager/service_desk)
DROP POLICY IF EXISTS "Authenticated users can delete meetings" ON public.meetings;
CREATE POLICY "Authenticated users can delete meetings" ON public.meetings
  FOR DELETE TO authenticated
  USING (public.app_role() = ANY (ARRAY['admin','manager','service_desk']));

-- meeting_tickets / meeting_actions : lecture ouverte, ecriture interdite au viewer
DROP POLICY IF EXISTS meeting_tickets_all ON public.meeting_tickets;
CREATE POLICY meeting_tickets_read ON public.meeting_tickets
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY meeting_tickets_write ON public.meeting_tickets
  FOR ALL USING (public.app_role() <> 'viewer') WITH CHECK (public.app_role() <> 'viewer');

DROP POLICY IF EXISTS meeting_actions_all ON public.meeting_actions;
CREATE POLICY meeting_actions_read ON public.meeting_actions
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY meeting_actions_write ON public.meeting_actions
  FOR ALL USING (public.app_role() <> 'viewer') WITH CHECK (public.app_role() <> 'viewer');

COMMIT;

-- ===========================================================================
-- VERIFICATION (a executer apres)
-- ===========================================================================
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('tickets','plants','occurrence_lines','ticket_photos',
--                      'meetings','meeting_tickets','meeting_actions')
--  ORDER BY tablename, cmd, policyname;
--
-- Attendu : tickets 4 politiques (insert non-viewer, select authentifie,
-- update createur/encadrant, delete admin) ; plants 2 (plants_read, plants_write).
--
-- Test fonctionnel conseille : se connecter avec un compte `viewer` et
-- verifier que la liste et le tableau de bord s'affichent toujours.

-- ===========================================================================
-- ROLLBACK (seulement pour revenir en arriere)
-- ===========================================================================
-- BEGIN;
-- CREATE POLICY "delete tickets" ON public.tickets FOR DELETE USING ((auth.role() = 'authenticated'::text));
-- CREATE POLICY "update tickets" ON public.tickets FOR UPDATE USING ((auth.role() = 'authenticated'::text));
-- CREATE POLICY authenticated_all ON public.plants TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "insert tickets" ON public.tickets FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));
-- CREATE POLICY "read tickets" ON public.tickets FOR SELECT USING ((auth.uid() IS NOT NULL));
-- DROP POLICY "Authenticated users can insert tickets" ON public.tickets;
-- CREATE POLICY "Authenticated users can insert tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
-- DROP POLICY "Authenticated users can insert occurrence_lines" ON public.occurrence_lines;
-- CREATE POLICY "Authenticated users can insert occurrence_lines" ON public.occurrence_lines FOR INSERT TO authenticated WITH CHECK (true);
-- DROP POLICY "Authenticated users can update occurrence_lines" ON public.occurrence_lines;
-- CREATE POLICY "Authenticated users can update occurrence_lines" ON public.occurrence_lines FOR UPDATE TO authenticated USING (true);
-- DROP POLICY "Authenticated users can delete occurrence_lines" ON public.occurrence_lines;
-- CREATE POLICY "Authenticated users can delete occurrence_lines" ON public.occurrence_lines FOR DELETE TO authenticated USING (true);
-- DROP POLICY "Authenticated users can upload photos" ON public.ticket_photos;
-- CREATE POLICY "Authenticated users can upload photos" ON public.ticket_photos FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));
-- DROP POLICY "Authenticated users can delete meetings" ON public.meetings;
-- CREATE POLICY "Authenticated users can delete meetings" ON public.meetings FOR DELETE TO authenticated USING (true);
-- DROP POLICY meeting_tickets_read ON public.meeting_tickets;
-- DROP POLICY meeting_tickets_write ON public.meeting_tickets;
-- CREATE POLICY meeting_tickets_all ON public.meeting_tickets USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
-- DROP POLICY meeting_actions_read ON public.meeting_actions;
-- DROP POLICY meeting_actions_write ON public.meeting_actions;
-- CREATE POLICY meeting_actions_all ON public.meeting_actions USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
-- DROP FUNCTION IF EXISTS public.app_role();
-- COMMIT;
