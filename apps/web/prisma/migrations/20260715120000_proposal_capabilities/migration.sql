-- Capacidade detectada da conta ClickSign do tenant (probe na conexão).
-- Roteia o WhatsApp das propostas: assinatura (plano Plus+) vs Aceite via
-- WhatsApp. Null = ainda não probado. Aditivo e idempotente.
-- Ver lib/clicksign/capabilities.ts + lib/proposals/routing.ts.

ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "whatsappSignatureAvailable" BOOLEAN;
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "acceptanceWhatsappAvailable" BOOLEAN;
ALTER TABLE "OrgSignatureSettings" ADD COLUMN IF NOT EXISTS "capabilitiesCheckedAt" TIMESTAMP(3);
