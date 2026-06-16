-- ============================================================
-- CORRECTIF SÉCURITÉ URGENT — 2026-06-16
-- À exécuter MAINTENANT dans le Supabase SQL Editor
-- (projet kbunsdmpesivntujvuzi → SQL Editor → coller → Run)
-- ============================================================
-- Problème confirmé: la clé "anon" est publique (présente dans le bundle JS),
-- et les objets suivants sont lisibles SANS authentification:
--   * vue  tickets_with_cost   — 2025 occurrences (clients, coûts, problèmes)
--   * vue  tickets_with_users  — 2025 occurrences + noms des utilisateurs
--   * table plants
--   * table meeting_tickets
-- Les tables de base (tickets, user_profiles, ...) sont déjà protégées par RLS,
-- mais les VUES tournent avec les droits de leur propriétaire et contournent la
-- RLS. security_invoker force l'application de la RLS de l'appelant.
-- ============================================================

-- 1. VUES : appliquer la RLS de l'utilisateur appelant.
--    Anon (aucun accès à tickets) → 0 ligne. Authentifié → inchangé.
ALTER VIEW public.tickets_with_cost  SET (security_invoker = true);
ALTER VIEW public.tickets_with_users SET (security_invoker = true);

-- 2. PLANTS : lecture pour authentifiés, écriture réservée aux admins.
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plants_read"  ON public.plants;
DROP POLICY IF EXISTS "plants_write" ON public.plants;
CREATE POLICY "plants_read"  ON public.plants FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "plants_write" ON public.plants FOR ALL
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. MEETING_TICKETS : table de liaison réunion↔occurrence.
--    Lecture + écriture pour tout utilisateur authentifié
--    (les permissions de réunion sont déjà gérées côté application).
ALTER TABLE public.meeting_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meeting_tickets_all" ON public.meeting_tickets;
CREATE POLICY "meeting_tickets_all" ON public.meeting_tickets FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 4. MEETING_ACTIONS : actions de réunion (RLS préventive — table vide
--    aujourd'hui mais sans RLS, donc exposée dès qu'on y écrit).
ALTER TABLE public.meeting_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meeting_actions_all" ON public.meeting_actions;
CREATE POLICY "meeting_actions_all" ON public.meeting_actions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- VÉRIFICATION (à faire après exécution, NON connecté) — chacune doit
-- renvoyer un tableau VIDE [] :
--   curl "https://kbunsdmpesivntujvuzi.supabase.co/rest/v1/tickets_with_cost?select=id&limit=1"   -H "apikey: <ANON_KEY>"
--   curl "https://kbunsdmpesivntujvuzi.supabase.co/rest/v1/plants?select=id&limit=1"              -H "apikey: <ANON_KEY>"
--   curl "https://kbunsdmpesivntujvuzi.supabase.co/rest/v1/meeting_tickets?select=meeting_id&limit=1" -H "apikey: <ANON_KEY>"
-- (ou dites-moi quand c'est fait et je revérifie automatiquement.)
--
-- NB: pas besoin de changer la clé anon — elle est CONÇUE pour être publique;
-- la sécurité repose sur la RLS, pas sur le secret de la clé.
-- Résiduel connu (non bloquant): le bucket Storage "ticket-photos" est public
-- (photos accessibles par URL). Le rendre privé nécessiterait des URLs signées.
-- ============================================================
