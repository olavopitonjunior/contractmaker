-- iList/RexAPI (Gryphtech RE/MAX): conexão por org + espelho de listings +
-- cache de geodata. Aditivo e idempotente (padrão do repo).

-- IListConnection
CREATE TABLE IF NOT EXISTS "IListConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "regionId" INTEGER NOT NULL,
    "officeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastCursor" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IListConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IListConnection_orgId_key" ON "IListConnection"("orgId");

DO $$ BEGIN
    ALTER TABLE "IListConnection"
        ADD CONSTRAINT "IListConnection_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- IListListing
CREATE TABLE IF NOT EXISTS "IListListing" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "ilistId" TEXT NOT NULL,
    "externalId" TEXT,
    "listingCode" TEXT,
    "officeId" INTEGER NOT NULL,
    "associateId" INTEGER,
    "transactionType" INTEGER NOT NULL,
    "listingStatus" INTEGER NOT NULL,
    "propertyTypeUid" INTEGER,
    "price" DECIMAL(14,2),
    "currency" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "builtArea" DOUBLE PRECISION,
    "lotSizeM2" DOUBLE PRECISION,
    "parkingSpaces" INTEGER,
    "yearBuilt" INTEGER,
    "comTotalPct" DOUBLE PRECISION,
    "comBuyAgentPct" DOUBLE PRECISION,
    "streetName" TEXT,
    "streetNumber" TEXT,
    "postalCode" TEXT,
    "cityId" INTEGER,
    "city" TEXT,
    "uf" TEXT,
    "associateName" TEXT,
    "associateCreci" TEXT,
    "coverImageUrl" TEXT,
    "searchText" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "modifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IListListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IListListing_orgId_ilistId_key" ON "IListListing"("orgId", "ilistId");
CREATE INDEX IF NOT EXISTS "IListListing_orgId_transactionType_listingStatus_deletedAt_idx"
    ON "IListListing"("orgId", "transactionType", "listingStatus", "deletedAt");
CREATE INDEX IF NOT EXISTS "IListListing_orgId_listingCode_idx" ON "IListListing"("orgId", "listingCode");

DO $$ BEGIN
    ALTER TABLE "IListListing"
        ADD CONSTRAINT "IListListing_connectionId_fkey" FOREIGN KEY ("connectionId")
        REFERENCES "IListConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "IListListing"
        ADD CONSTRAINT "IListListing_orgId_fkey" FOREIGN KEY ("orgId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- IListGeoCity (cache global, PK composta)
CREATE TABLE IF NOT EXISTS "IListGeoCity" (
    "regionId" INTEGER NOT NULL,
    "cityId" INTEGER NOT NULL,
    "cityName" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "uf" TEXT,

    CONSTRAINT "IListGeoCity_pkey" PRIMARY KEY ("regionId", "cityId")
);

-- Property: origem externa (import iList)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "crmId" TEXT;
CREATE INDEX IF NOT EXISTS "Property_orgId_source_crmId_idx" ON "Property"("orgId", "source", "crmId");
