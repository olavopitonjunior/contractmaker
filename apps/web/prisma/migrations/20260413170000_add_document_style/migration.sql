-- CreateTable DocumentStyle
CREATE TABLE "DocumentStyle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fontFamily" TEXT NOT NULL DEFAULT 'Times New Roman',
    "fontSizeBase" INTEGER NOT NULL DEFAULT 12,
    "lineHeight" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "marginTopMm" INTEGER NOT NULL DEFAULT 25,
    "marginBottomMm" INTEGER NOT NULL DEFAULT 25,
    "marginLeftMm" INTEGER NOT NULL DEFAULT 25,
    "marginRightMm" INTEGER NOT NULL DEFAULT 25,
    "colorPrimary" TEXT NOT NULL DEFAULT '#000000',
    "colorAccent" TEXT NOT NULL DEFAULT '#C97B0A',
    "headerHtml" TEXT,
    "footerHtml" TEXT,
    "pageNumbers" BOOLEAN NOT NULL DEFAULT true,
    "includeToc" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentStyle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentStyle_orgId_idx" ON "DocumentStyle"("orgId");

ALTER TABLE "DocumentStyle" ADD CONSTRAINT "DocumentStyle_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
