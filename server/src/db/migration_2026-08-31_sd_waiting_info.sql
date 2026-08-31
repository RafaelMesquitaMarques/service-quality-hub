-- ============================================================
-- Migration 2026-08-31 — Statut « Service Desk : info en attente »
-- ============================================================
-- Ajoute la valeur de statut `sd_waiting_info` : nouvelle étape du flux,
-- entre `service_desk` et `quality_meeting`, quand le Service Desk attend
-- une information avant de pouvoir avancer l'occurrence.
--
-- La contrainte CHECK d'origine (schema.sql) ne listait que
-- ('not_started','wip','completed','cancelled') alors que 'service_desk' et
-- 'quality_meeting' sont utilisés en production : on reconstruit donc la
-- contrainte avec la liste complète. Toute contrainte CHECK existante portant
-- sur `status` est d'abord supprimée — son nom peut différer selon
-- l'historique de la base. Idempotent : rejouable sans risque.
--
-- AVANT DE LANCER : vérifier qu'aucune ligne ne porte un statut hors liste,
-- sinon l'ajout de la contrainte échouera (et la transaction sera annulée) :
--   SELECT status, COUNT(*) FROM tickets GROUP BY status ORDER BY 2 DESC;
-- ============================================================

BEGIN;

-- 1. Supprimer les contraintes CHECK existantes sur `status`
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
     WHERE ns.nspname   = 'public'
       AND rel.relname  = 'tickets'
       AND con.contype  = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tickets DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Contrainte supprimée : %', c.conname;
  END LOOP;
END $$;

-- 2. Recréer la contrainte avec la liste complète des statuts
--    ('wip' est conservé : statut hérité présent dans les données importées)
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN (
    'not_started',
    'service_desk',
    'sd_waiting_info',
    'quality_meeting',
    'wip',
    'completed',
    'cancelled'
  ));

COMMIT;

-- ============================================================
-- Vérification
-- ============================================================
-- SELECT pg_get_constraintdef(oid) AS def
--   FROM pg_constraint WHERE conname = 'tickets_status_check';
--
-- Doit accepter la nouvelle valeur :
-- UPDATE tickets SET status = 'sd_waiting_info' WHERE id = '<uuid-de-test>';
