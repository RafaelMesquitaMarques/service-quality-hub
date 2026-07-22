-- ============================================================
-- Migration 2026-07-22 — Référentiels Départements & Catégories
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT le déploiement du frontend.
-- ============================================================
--
-- Remplace les listes codées en dur de client/src/constants/taxonomy.js
-- par deux tables de référentiel gérées depuis la page « Référentiels »
-- (onglets Départements et Catégories), sur le même modèle que `brands`.
-- Pré-remplies avec les valeurs actuelles + « Logistics » (manquant).
--
-- Les occurrences stockent le département / la catégorie en texte libre :
-- désactiver ou supprimer une entrée du référentiel ne modifie pas les
-- occurrences existantes (les selects conservent la valeur héritée).
--
-- SÉCURITÉ : comme la clé anon est publique, toute table SANS RLS est
-- lisible/écrivable sans authentification. On reproduit le modèle de
-- `brands` : lecture pour les utilisateurs connectés, écriture admin.

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(100) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(100) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed des valeurs existantes (idempotent) — Logistics ajouté
INSERT INTO public.departments (name)
SELECT v.name
FROM (VALUES
  ('Production'),('Int. Sales'),('Ext. Sales'),('Purchasing'),('Supplier'),
  ('Product Dev.'),('Engineering'),('Client'),('Vietnam'),('Install'),
  ('Planning'),('NCW'),('Shipping'),('VC'),('Project Mgnt'),('EOI'),
  ('Logistics')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.name = v.name);

INSERT INTO public.categories (name)
SELECT v.name
FROM (VALUES
  ('Damaged'),('Cleaning'),('Electrical'),('Fitting/Adjustment'),('Hardware'),
  ('Metal'),('Missing Component'),('Missing Unit'),('Scratches'),('Stone'),
  ('Upholstery'),('Wood'),('Packaging'),('Bad production')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = v.name);

-- 3. RLS — departments
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read departments" ON public.departments;
CREATE POLICY "Authenticated can read departments"
  ON public.departments FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage departments" ON public.departments;
CREATE POLICY "Admins manage departments"
  ON public.departments FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4. RLS — categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read categories" ON public.categories;
CREATE POLICY "Authenticated can read categories"
  ON public.categories FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
CREATE POLICY "Admins manage categories"
  ON public.categories FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
