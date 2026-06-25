-- ============================================================
-- Migration 2026-06-25 (3) — Référentiels Clients & Marques
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================
--
-- Crée deux tables de référentiel gérées depuis la nouvelle page
-- « Clients & Marques » :
--   - clients : registre de clients (autonome pour l'instant, pas encore
--     rattaché aux occurrences).
--   - brands  : remplace la liste de marques codée en dur dans les
--     formulaires ; pré-remplie avec les 7 marques actuelles.
--
-- SÉCURITÉ : comme la clé anon est publique, toute table SANS RLS est
-- lisible/écrivable sans authentification. On reproduit donc exactement le
-- modèle de `plants` (migration sécurité 2026-06-12) : lecture pour les
-- utilisateurs connectés, écriture réservée aux admins.

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(200) NOT NULL,
  contact_name  varchar(200),
  contact_email varchar(200),
  contact_phone varchar(50),
  city          varchar(120),
  notes         text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(100) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed des marques existantes (idempotent)
INSERT INTO public.brands (name)
SELECT v.name
FROM (VALUES ('HIEX'),('HOME 2'),('INDEP'),('ResHall'),('SBG'),('STWD'),('Other')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.name = v.name);

-- 3. RLS — clients
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read clients" ON public.clients;
CREATE POLICY "Authenticated can read clients"
  ON public.clients FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage clients" ON public.clients;
CREATE POLICY "Admins manage clients"
  ON public.clients FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4. RLS — brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read brands" ON public.brands;
CREATE POLICY "Authenticated can read brands"
  ON public.brands FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage brands" ON public.brands;
CREATE POLICY "Admins manage brands"
  ON public.brands FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
