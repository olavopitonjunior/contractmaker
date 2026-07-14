-- Branding canônico na org (BrandingSettings), migrando o que vivia por conta
-- Asaas (OrgFinancialSettings.brand*). Idempotente: pode reaplicar sem estrago.

-- 1. Campos de identidade que só existiam no lado financeiro.
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "supportPhone" TEXT;

-- 2. Toda org precisa de uma linha (a row só nascia via painel admin).
INSERT INTO "BrandingSettings" ("id", "orgId", "poweredBy", "createdAt", "updatedAt")
SELECT
  'bs_' || substr(md5(random()::text || o."id"), 1, 22),
  o."id",
  TRUE,
  NOW(),
  NOW()
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "BrandingSettings" b WHERE b."orgId" = o."id"
);

-- 3. Recupera o branding que estava preso na conta Asaas mais antiga da org.
--    Só preenche onde o destino está vazio — nunca sobrescreve o que já existe.
WITH src AS (
  SELECT DISTINCT ON (f."orgId")
    f."orgId",
    f."brandLogoUrl",
    f."brandPrimaryColor",
    f."brandDisplayName",
    f."brandSupportEmail",
    f."brandSupportPhone"
  FROM "OrgFinancialSettings" f
  ORDER BY f."orgId", f."createdAt" ASC
)
UPDATE "BrandingSettings" b
SET
  "logoUrl"      = COALESCE(b."logoUrl", NULLIF(src."brandLogoUrl", '')),
  "primaryColor" = COALESCE(b."primaryColor", NULLIF(src."brandPrimaryColor", '')),
  "displayName"  = COALESCE(b."displayName", NULLIF(src."brandDisplayName", '')),
  "supportEmail" = COALESCE(b."supportEmail", NULLIF(src."brandSupportEmail", '')),
  "supportPhone" = COALESCE(b."supportPhone", NULLIF(src."brandSupportPhone", '')),
  "updatedAt"    = NOW()
FROM src
WHERE b."orgId" = src."orgId";

-- 4. Materializa os derivados pros tenants já entregues, pra o dono abrir a tela
--    e encontrar preenchido (o resolver deriva em runtime, mas queremos o valor
--    gravado e editável). Nome de exibição = nome FANTASIA da org ("RE/MAX Ativa"),
--    não a razão social: é ele que assina e-mail e página de pagamento. Suporte =
--    e-mail do dono. Logo fica nulo — não dá pra inventar.
WITH owner_email AS (
  SELECT DISTINCT ON (m."orgId") m."orgId", u."email"
  FROM "OrgMembership" m
  JOIN "User" u ON u."id" = m."userId"
  WHERE m."role" = 'owner'
  ORDER BY m."orgId", m."invitedAt" ASC
)
UPDATE "BrandingSettings" b
SET
  "displayName"  = COALESCE(b."displayName", NULLIF(o."name", ''), o."legalName"),
  "supportEmail" = COALESCE(b."supportEmail", oe."email"),
  "updatedAt"    = NOW()
FROM "Organization" o
LEFT JOIN owner_email oe ON oe."orgId" = o."id"
WHERE b."orgId" = o."id"
  AND (b."displayName" IS NULL OR b."supportEmail" IS NULL);
