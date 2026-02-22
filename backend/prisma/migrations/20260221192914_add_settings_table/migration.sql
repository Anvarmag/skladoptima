-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "stock_master" INTEGER NOT NULL DEFAULT 0,
    "stock_wb" INTEGER NOT NULL DEFAULT 0,
    "stock_ozon" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "wbToken" TEXT,
    "wbWarehouseId" TEXT,
    "ozonClientId" TEXT,
    "ozonApiKey" TEXT,
    "ozonWarehouseId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
