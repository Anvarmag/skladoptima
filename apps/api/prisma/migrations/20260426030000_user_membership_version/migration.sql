-- Добавляем счётчик версии memberships на пользователя.
-- Инкрементируется при каждом изменении состава memberships (создание, отзыв, смена роли).
-- JWT access token кеширует activeTenantId; при несовпадении membershipVersion
-- guard сбрасывается к DB-lookup, не доверяя закешированному значению.
ALTER TABLE "User" ADD COLUMN "membershipVersion" INTEGER NOT NULL DEFAULT 0;
