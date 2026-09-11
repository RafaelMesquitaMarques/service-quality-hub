-- ============================================================
-- Migration 2026-09-08 — Crédit fournisseur par ligne
-- ============================================================
-- Les crédits obtenus des fournisseurs pour un service call se saisissent
-- désormais sur la ligne, sous « Coût installation ». Le coût approximatif de
-- la ligne devient : (mobilier + transport + installation) − crédit.
--
-- Rien à recalculer : les lignes existantes n'ont pas de crédit, leur
-- `cost_approx` est déjà la somme des trois postes.
--
-- Idempotent : rejouable sans risque.
-- ============================================================

BEGIN;

ALTER TABLE public.occurrence_lines
  ADD COLUMN IF NOT EXISTS supplier_credit NUMERIC(10,2);

COMMENT ON COLUMN public.occurrence_lines.supplier_credit IS
  'Crédit reçu du fournisseur pour ce défaut. Se soustrait des trois postes de coût pour donner cost_approx.';

COMMIT;

-- ============================================================
-- Diagnostic — un crédit supérieur aux coûts donne un `cost_approx` NÉGATIF
-- ============================================================
-- `occurrence_lines` a été créée hors de ce dossier de migrations : ses
-- contraintes ne sont pas connues du dépôt. Ce bloc ne modifie rien, il
-- signale toute contrainte CHECK qui interdirait un coût net négatif — auquel
-- cas la saisie d'un crédit > coûts serait rejetée à l'écran.
DO $$
DECLARE c record; trouvee boolean := false;
BEGIN
  FOR c IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
     WHERE ns.nspname  = 'public'
       AND rel.relname = 'occurrence_lines'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%cost%'
  LOOP
    trouvee := true;
    RAISE WARNING 'Contrainte CHECK sur les coûts : % — %', c.conname, c.def;
  END LOOP;

  IF NOT trouvee THEN
    RAISE NOTICE 'Aucune contrainte CHECK sur les coûts : un cost_approx négatif (crédit > coûts) sera accepté.';
  END IF;
END $$;

-- ============================================================
-- Vérification
-- ============================================================
-- SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--  WHERE table_name = 'occurrence_lines' AND column_name = 'supplier_credit';
