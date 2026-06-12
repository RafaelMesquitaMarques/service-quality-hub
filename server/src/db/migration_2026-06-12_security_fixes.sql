-- ============================================================
-- Migration sécurité 2026-06-12 — À exécuter dans le Supabase SQL Editor
-- ============================================================
-- Problème confirmé: les vues tickets_with_cost et tickets_with_users
-- sont lisibles SANS authentification (la clé anon est publique dans le
-- bundle JS). Les tables brutes sont protégées par RLS, mais les vues
-- s'exécutent avec les droits de leur propriétaire (postgres) et la
-- contournent. security_invoker force l'application de la RLS de
-- l'utilisateur appelant.

-- 1. Vues: appliquer la RLS de l'appelant
ALTER VIEW public.tickets_with_cost  SET (security_invoker = true);
ALTER VIEW public.tickets_with_users SET (security_invoker = true);

-- 2. Table plants: actuellement lisible sans authentification.
--    Lecture pour les utilisateurs connectés, écriture pour les admins.
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read plants" ON public.plants;
CREATE POLICY "Authenticated can read plants"
  ON public.plants FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage plants" ON public.plants;
CREATE POLICY "Admins manage plants"
  ON public.plants FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. Vérification (à exécuter après): ces deux requêtes doivent
--    retourner 0 ligne / une erreur quand on n'est pas connecté:
--      curl "<SUPABASE_URL>/rest/v1/tickets_with_cost?select=id&limit=1" -H "apikey: <ANON_KEY>"
--      curl "<SUPABASE_URL>/rest/v1/plants?select=id&limit=1"            -H "apikey: <ANON_KEY>"

-- NB résiduel (non corrigé ici): le bucket Storage "ticket-photos" est
-- public — toute personne possédant l'URL d'une photo peut la voir.
-- Le passer en privé exigerait des URLs signées partout dans le code.
