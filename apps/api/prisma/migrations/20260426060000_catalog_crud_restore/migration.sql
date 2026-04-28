-- TASK_CATALOG_2: CRUD Products, Soft Delete и Restore
--
-- Добавляет PRODUCT_RESTORED в ActionType enum.
-- PostgreSQL поддерживает ALTER TYPE ADD VALUE без пересоздания таблиц.

ALTER TYPE "ActionType" ADD VALUE 'PRODUCT_RESTORED' AFTER 'PRODUCT_DELETED';
