-- CreateEnum
CREATE TYPE "ProductNoteCategory" AS ENUM ('PRICE', 'CARD', 'SUPPLY', 'OTHER');

-- CreateTable
CREATE TABLE "ProductNote" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "category"  "ProductNoteCategory" NOT NULL DEFAULT 'OTHER',
    "title"     VARCHAR(255) NOT NULL,
    "body"      TEXT,
    "date"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductNote_tenantId_productId_idx" ON "ProductNote"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "ProductNote_tenantId_category_idx" ON "ProductNote"("tenantId", "category");

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNote" ADD CONSTRAINT "ProductNote_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
