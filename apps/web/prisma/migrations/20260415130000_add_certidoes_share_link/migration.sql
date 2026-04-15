-- Share link for certidões (public read-only view with expiration)
CREATE TABLE "CertidoesShareLink" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CertidoesShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CertidoesShareLink_token_key" ON "CertidoesShareLink"("token");
CREATE INDEX "CertidoesShareLink_token_idx" ON "CertidoesShareLink"("token");
CREATE INDEX "CertidoesShareLink_dealId_revokedAt_idx" ON "CertidoesShareLink"("dealId", "revokedAt");

ALTER TABLE "CertidoesShareLink"
  ADD CONSTRAINT "CertidoesShareLink_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
