-- ============================================================
-- Migration 2026-07-27 — Revenus mensuels ventilés par usine
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi)
-- AVANT / au moment du déploiement du frontend.
-- ============================================================
--
-- La table monthly_revenue passe d'une ligne par (année, mois) à une ligne par
-- (année, mois, usine), pour saisir les revenus comme dans le rapport
-- « Actual Sales per plant » (usines IR / NC / NL / QM / QS).
--   • plant NULL = montant « non ventilé » (anciennes saisies globales — l'UI
--     les affiche dans une colonne « Non ventilé » et le dashboard les somme).
--   • Le dashboard somme toutes les usines ; avec un filtre usine actif, il
--     n'utilise que le revenu de cette usine.
--
-- Seed : FY2026 (déc → juil) est remplacé par les chiffres réels par usine du
-- rapport. Anciennes valeurs globales, si besoin de les restaurer :
--   fm1 déc 9 998 777 · fm2 jan 11 129 308 · fm3 fév 10 260 000
--   fm4 mar 13 754 000 · fm5 avr 14 690 997 · fm6 mai 11 000 000
--   fm7 juin 25 730 000 · fm8 juil 20 220 000 · fm9→12 : 0

-- 1) Colonne usine (nom de l'usine, comme tickets.plant / occurrence_lines.plant).
ALTER TABLE monthly_revenue ADD COLUMN IF NOT EXISTS plant TEXT;

-- 2) Unicité par (année, mois, usine) — COALESCE pour que les lignes « non
--    ventilé » (plant NULL) restent uniques par mois quelle que soit la
--    version de Postgres.
ALTER TABLE monthly_revenue
  DROP CONSTRAINT IF EXISTS monthly_revenue_fiscal_year_fiscal_month_key;
DROP INDEX IF EXISTS monthly_revenue_fy_fm_plant_uniq;
CREATE UNIQUE INDEX monthly_revenue_fy_fm_plant_uniq
  ON monthly_revenue (fiscal_year, fiscal_month, COALESCE(plant, ''));

-- 3) Seed FY2026 : réels par usine (rapport « Sales per plant YTD », CAD).
--    Remplace les totaux globaux saisis à la main (conservés en commentaire
--    ci-dessus). Idempotent : delete + insert.
DELETE FROM monthly_revenue WHERE fiscal_year = 2026;
INSERT INTO monthly_revenue (fiscal_year, fiscal_month, plant, revenue) VALUES
  (2026,  1, 'IR',   753814.60),
  (2026,  1, 'NC',   512530.86),
  (2026,  1, 'NL',  4456315.59),
  (2026,  1, 'QM',   193403.38),
  (2026,  1, 'QS',  4002765.52),
  (2026,  2, 'IR',   239861.65),
  (2026,  2, 'NC',  1294577.29),
  (2026,  2, 'NL',  3846387.25),
  (2026,  2, 'QM',    55023.62),
  (2026,  2, 'QS',  5469337.34),
  (2026,  3, 'IR',   360384.82),
  (2026,  3, 'NC',   989945.94),
  (2026,  3, 'NL',  3775389.81),
  (2026,  3, 'QM',   144834.86),
  (2026,  3, 'QS',  5002696.11),
  (2026,  4, 'IR',   341969.60),
  (2026,  4, 'NC',  1307661.44),
  (2026,  4, 'NL',  4188133.96),
  (2026,  4, 'QM',   178298.63),
  (2026,  4, 'QS',  7811248.33),
  (2026,  5, 'IR',   755300.88),
  (2026,  5, 'NC',   812540.01),
  (2026,  5, 'NL',  5255730.34),
  (2026,  5, 'QM',   335416.75),
  (2026,  5, 'QS',  7666527.59),
  (2026,  6, 'IR',   299572.64),
  (2026,  6, 'NC',  1950371.91),
  (2026,  6, 'NL',  5372625.58),
  (2026,  6, 'QM',   387471.36),
  (2026,  6, 'QS',  8425634.56),
  (2026,  7, 'IR',    49438.47),
  (2026,  7, 'NC',  4571939.70),
  (2026,  7, 'NL',  6789610.98),
  (2026,  7, 'QM',   903575.18),
  (2026,  7, 'QS', 13511378.40),
  (2026,  8, 'IR',   177192.60),
  (2026,  8, 'NC',  4155006.37),
  (2026,  8, 'NL',  6649988.77),
  (2026,  8, 'QM',   572211.81),
  (2026,  8, 'QS', 11621163.31);

-- Vérification : totaux par mois — doivent correspondre à la ligne
-- « Grand Total » du rapport (déc 9 918 829.95 … juil 23 175 562.87,
-- total 125 187 277.81).
SELECT fiscal_month, SUM(revenue) AS total
FROM monthly_revenue WHERE fiscal_year = 2026
GROUP BY fiscal_month ORDER BY fiscal_month;
