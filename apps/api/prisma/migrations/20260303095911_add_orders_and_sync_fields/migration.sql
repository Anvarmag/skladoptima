/*
  Warnings:

  - You are about to drop the `MarketplaceAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductMarketplaceLink` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[wbBarcode]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "ActionType" ADD VALUE 'ORDER_DEDUCTED';

-- DropForeignKey
ALTER TABLE "ProductMarketplaceLink" DROP CONSTRAINT "ProductMarketplaceLink_accountId_fkey";

-- DropForeignKey
ALTER TABLE "ProductMarketplaceLink" DROP CONSTRAINT "ProductMarketplaceLink_productId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ozonFbo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ozonFbs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wbBarcode" TEXT,
ADD COLUMN     "wbFbo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wbFbs" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "MarketplaceAccount";

-- DropTable
DROP TABLE "ProductMarketplaceLink";

-- CreateTable
CREATE TABLE "MarketplaceOrder" (
    "id" TEXT NOT NULL,
    "marketplaceOrderId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "productSku" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSettings" (
    "id" TEXT NOT NULL DEFAULT 1,
    "ozonClientId" TEXT,
    "ozonApiKey" TEXT,
    "ozonWarehouseId" TEXT,
    "wbApiKey" TEXT,
    "wbWarehouseId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrder_marketplaceOrderId_key" ON "MarketplaceOrder"("marketplaceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSettings_id_key" ON "MarketplaceSettings"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_wbBarcode_key" ON "Product"("wbBarcode");
