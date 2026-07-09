-- ============================================================
-- Migration 2026-07-09 — Revenus mensuels par année fiscale
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT / au moment du déploiement du frontend.
-- ============================================================
--
-- Remplace la constante MONTHLY_REVENUE codée en dur dans le Dashboard par
-- une table éditable via la page Référentiels (onglet « Revenus »).
-- Le graphique « SC Cost % des revenus » n'affiche un mois que s'il a un revenu
-- > 0 : renseigner un mois le fait apparaître.
--
-- fiscal_month suit le calendrier fiscal de Foliot (déc = mois 1, …, nov = 12).

CREATE TABLE IF NOT EXISTS monthly_revenue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year   INTEGER NOT NULL,
  fiscal_month  INTEGER NOT NULL CHECK (fiscal_month BETWEEN 1 AND 12),
  revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (fiscal_year, fiscal_month)
);

ALTER TABLE monthly_revenue ENABLE ROW LEVEL SECURITY;

-- Lecture : tout utilisateur authentifié (le dashboard en a besoin).
CREATE POLICY "read monthly_revenue"
  ON monthly_revenue FOR SELECT USING (auth.role() = 'authenticated');

-- Écriture : admin / manager uniquement.
CREATE POLICY "manage monthly_revenue"
  ON monthly_revenue FOR ALL
  USING      (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin','manager')));

-- Seed FY2026 : valeurs jusqu'ici codées en dur (déc → mai).
INSERT INTO monthly_revenue (fiscal_year, fiscal_month, revenue) VALUES
  (2026, 1, 9998777),   -- December
  (2026, 2, 11129308),  -- January
  (2026, 3, 10260000),  -- February
  (2026, 4, 13754000),  -- March
  (2026, 5, 14690997),  -- April
  (2026, 6, 11000000)   -- May
ON CONFLICT (fiscal_year, fiscal_month) DO NOTHING;
