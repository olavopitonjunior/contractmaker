-- Segurança do link do formulário público: travamento (lock) + auto-lock no finalize.
-- Aditiva e idempotente.
--
-- SalesForm.lockedAt / lockedById: quando setado, os endpoints de escrita
-- (PATCH do token principal, PATCH do subtoken, uploads de anexo) retornam 403
-- e as páginas públicas renderizam somente-leitura. Congela as informações do
-- negócio num marco. Destravar = voltar a NULL.
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "SalesForm" ADD COLUMN IF NOT EXISTS "lockedById" TEXT;

-- OrgFormSettings.autoLockFormOnFinalize: quando true, o SalesForm trava sozinho
-- no momento em que o cliente finaliza o formulário. Default false preserva o
-- comportamento atual (form reabrível por quem tiver o link).
ALTER TABLE "OrgFormSettings" ADD COLUMN IF NOT EXISTS "autoLockFormOnFinalize" BOOLEAN NOT NULL DEFAULT false;
