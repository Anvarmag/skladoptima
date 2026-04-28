-- TASK_CATALOG_4: Mapping и Merge — новые ActionType
--
-- Добавляет три новых значения в enum ActionType для аудита операций
-- маппинга и ручного merge дублей. PostgreSQL поддерживает
-- ALTER TYPE ADD VALUE без пересоздания таблиц.

ALTER TYPE "ActionType" ADD VALUE 'MAPPING_CREATED' AFTER 'PRODUCT_RESTORED';
ALTER TYPE "ActionType" ADD VALUE 'MAPPING_DELETED' AFTER 'MAPPING_CREATED';
ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_MERGED'  AFTER 'MAPPING_DELETED';
