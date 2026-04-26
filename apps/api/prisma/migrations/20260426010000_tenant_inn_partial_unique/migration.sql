-- Удаляем глобальный UNIQUE constraint на inn (блокировал CLOSED tenant от переиспользования ИНН)
ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_inn_key";

-- Создаём partial unique index: уникальность ИНН только среди ACTIVE tenant
CREATE UNIQUE INDEX "tenant_inn_unique_active" ON "Tenant" (inn) WHERE status = 'ACTIVE' AND inn IS NOT NULL;
