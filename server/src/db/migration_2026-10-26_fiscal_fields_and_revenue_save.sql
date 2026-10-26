-- ============================================================
-- Migration 2026-10-26 — Champs fiscaux toujours dérivés de la date de
-- réception + enregistrement atomique des revenus mensuels
-- À exécuter dans le Supabase SQL Editor (projet kbunsdmpesivntujvuzi).
-- Le frontend fonctionne avec ou sans elle (voir chaque section), mais elle
-- seule protège les écritures qui ne passent pas par l'app.
-- ============================================================
--
-- 1. tickets.date_yyyy_mm / fiscal_year / fiscal_month sont stockés et lus par
--    le tableau de bord et la liste (mois et année fiscale d'une occurrence).
--    Ils n'étaient calculés qu'à la création : corriger la date de réception
--    depuis la fiche laissait l'occurrence dans son ancien mois — voire son
--    ancienne année fiscale si la correction franchit le 1er décembre. Le
--    frontend les recalcule désormais (ticketApi.update) ; ce déclencheur couvre
--    aussi les imports, scripts et éditions SQL — y compris une écriture directe
--    de date_yyyy_mm / fiscal_year / fiscal_month, aussitôt réalignée sur la date.
--    Calendrier Foliot : décembre = mois fiscal 1 de l'année SUIVANTE.
--    Date NULL : champs laissés tels quels.
--
-- 2. Rattrapage des occurrences dont les champs fiscaux ne correspondent pas à
--    la date de réception — 5 au 2026-10-26, toutes importées (FY2025 : #97 et
--    #98, #609, #1206 et #1208, mois fiscal = mois civil). Effet visible : les
--    barres FY2025 du graphique « Événements par mois » bougent de 1 ou 2
--    (déc −2 / jan +2, avr −1 / mai +1, août −2 / sept +2). Effet de bord :
--    le déclencheur tickets_updated_at met leur updated_at à l'heure de la
--    migration (champ visible dans les Rapports).
--
-- 3. save_revenue_year(année, lignes) : remplace les revenus d'une année fiscale
--    en UNE transaction. L'éditeur des Référentiels faisait DELETE puis INSERT
--    en deux requêtes : si l'insertion échouait, l'année entière était effacée
--    et le SC % du tableau de bord disparaissait. SECURITY INVOKER : la RLS de
--    monthly_revenue (écriture admin / manager) s'applique telle quelle — sans
--    droit, l'insertion échoue et la suppression est annulée avec elle.
--    Tant que la fonction n'existe pas, le frontend garde l'ancien chemin.
--
-- Idempotent : rejouable sans risque.
-- ============================================================

BEGIN;

-- 1. Déclencheur
CREATE OR REPLACE FUNCTION public.tickets_sync_fiscal_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  y int;
  m int;
BEGIN
  IF NEW.issue_reception_date IS NULL THEN
    RETURN NEW;
  END IF;
  y := EXTRACT(YEAR  FROM NEW.issue_reception_date)::int;
  m := EXTRACT(MONTH FROM NEW.issue_reception_date)::int;
  NEW.date_yyyy_mm  := to_char(NEW.issue_reception_date, 'YYYY-MM');
  NEW.fiscal_year   := CASE WHEN m = 12 THEN y + 1 ELSE y END;
  NEW.fiscal_month  := CASE WHEN m = 12 THEN 1 ELSE m + 1 END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_sync_fiscal_fields ON public.tickets;
CREATE TRIGGER tickets_sync_fiscal_fields
  BEFORE INSERT OR UPDATE OF issue_reception_date, date_yyyy_mm, fiscal_year, fiscal_month ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_sync_fiscal_fields();

-- 2. Rattrapage (aperçu possible avant : remplacer UPDATE … SET … par un SELECT
--    occurrence_no, issue_reception_date, date_yyyy_mm, fiscal_year, fiscal_month
--    avec le même WHERE)
UPDATE public.tickets t
SET date_yyyy_mm = to_char(t.issue_reception_date, 'YYYY-MM'),
    fiscal_year  = EXTRACT(YEAR FROM t.issue_reception_date)::int
                   + CASE WHEN EXTRACT(MONTH FROM t.issue_reception_date) = 12 THEN 1 ELSE 0 END,
    fiscal_month = CASE WHEN EXTRACT(MONTH FROM t.issue_reception_date) = 12 THEN 1
                        ELSE EXTRACT(MONTH FROM t.issue_reception_date)::int + 1 END
WHERE t.issue_reception_date IS NOT NULL
  AND (t.date_yyyy_mm IS DISTINCT FROM to_char(t.issue_reception_date, 'YYYY-MM')
    OR t.fiscal_year IS DISTINCT FROM EXTRACT(YEAR FROM t.issue_reception_date)::int
                   + CASE WHEN EXTRACT(MONTH FROM t.issue_reception_date) = 12 THEN 1 ELSE 0 END
    OR t.fiscal_month IS DISTINCT FROM CASE WHEN EXTRACT(MONTH FROM t.issue_reception_date) = 12 THEN 1
                        ELSE EXTRACT(MONTH FROM t.issue_reception_date)::int + 1 END);

-- 3. Enregistrement atomique des revenus d'une année
--    p_rows : [{ "fiscal_month": 1..12, "plant": "QS" | null, "revenue": > 0 }, …]
CREATE OR REPLACE FUNCTION public.save_revenue_year(p_fiscal_year int, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.monthly_revenue WHERE fiscal_year = p_fiscal_year;
  INSERT INTO public.monthly_revenue (fiscal_year, fiscal_month, plant, revenue, updated_at)
  SELECT p_fiscal_year, r.fiscal_month, NULLIF(btrim(r.plant), ''), r.revenue, now()
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(fiscal_month int, plant text, revenue numeric)
  WHERE r.revenue > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.save_revenue_year(int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_revenue_year(int, jsonb) TO authenticated;

COMMIT;

-- Vérifications après exécution :
--   SELECT count(*) FROM public.tickets
--   WHERE issue_reception_date IS NOT NULL
--     AND (date_yyyy_mm IS DISTINCT FROM to_char(issue_reception_date, 'YYYY-MM')
--       OR fiscal_year IS DISTINCT FROM EXTRACT(YEAR FROM issue_reception_date)::int
--                     + CASE WHEN EXTRACT(MONTH FROM issue_reception_date) = 12 THEN 1 ELSE 0 END
--       OR fiscal_month IS DISTINCT FROM CASE WHEN EXTRACT(MONTH FROM issue_reception_date) = 12 THEN 1
--                                             ELSE EXTRACT(MONTH FROM issue_reception_date)::int + 1 END);   -- attendu : 0
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tickets'::regclass AND NOT tgisinternal;      -- tickets_sync_fiscal_fields présent
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'save_revenue_year';                          -- prosecdef = false (invoker)
