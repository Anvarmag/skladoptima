-- TASK_CATALOG_5: Source-of-Change Policy — новый ActionType IMPORT_COMMITTED
--
-- Добавляет значение для аудита завершённых import-коммитов.
-- PostgreSQL поддерживает ALTER TYPE ADD VALUE без пересоздания таблиц.

ALTER TYPE "ActionType" ADD VALUE 'IMPORT_COMMITTED' AFTER 'PRODUCT_MERGED';
