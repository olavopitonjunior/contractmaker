-- Rollback for 20260505120000_add_action_intents.
-- APAGA todos os ActionIntents existentes (preview snapshots, etc).
-- Use apenas se a migration up causou problema imediato.

DROP TABLE IF EXISTS "ActionIntent";
