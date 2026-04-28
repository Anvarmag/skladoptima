-- TASK_ANALYTICS_1: Materialized Daily Layer и Analytics Data Model
-- (12-analytics system-analytics §8/§13/§14).
--
-- Что делает миграция:
-- 1. Добавляет 4 enum для analytics domain:
--    - AnalyticsAbcMetric (REVENUE_NET / UNITS) — §14 правило MVP: ABC
--      строим по REVENUE_NET, чтобы не смешивать gross с возвратным шумом.
--    - AnalyticsSnapshotStatus (READY / STALE / INCOMPLETE / FAILED) —
--      STALE и INCOMPLETE отделены (§19 stale-vs-incomplete board).
--    - AnalyticsRecommendationPriority (LOW / MEDIUM / HIGH).
--    - AnalyticsRecommendationStatus (ACTIVE / DISMISSED / APPLIED) —
--      DISMISSED/APPLIED зарезервированы под будущий workflow (§15).
--
-- 2. Создаёт таблицу `AnalyticsMaterializedDaily` — дневной KPI слой,
--    одна строка на (tenant, date). Источник для revenue dynamics и базы
--    под ABC. Идемпотентность daily aggregation через UNIQUE(tenantId, date).
--
-- 3. Создаёт таблицу `AnalyticsAbcSnapshot` — снапшот ABC за период,
--    payload JSONB + formulaVersion (§14 + §20 reproducibility).
--    Идемпотентность rebuild через UNIQUE(tenantId, periodFrom, periodTo,
--    metric, formulaVersion).
--
-- 4. Создаёт таблицу `AnalyticsRecommendation` — explainable rule-based
--    рекомендации (§9 + §20). Идемпотентность refresh через
--    UNIQUE(tenantId, productId, ruleKey).
--
-- Что НЕ делает (намеренно):
-- - Не трогает legacy `analytics.service.ts` — он продолжает считать
--   on-the-fly из MarketplaceOrder. Переключение читателей на новые
--   таблицы — TASK_ANALYTICS_4 (одновременно с появлением fast read API).
-- - Не реализует daily aggregation pipeline и ABC engine — TASK_ANALYTICS_2/3.
-- - Не создаёт REST endpoints `/api/v1/analytics/dashboard|abc|...` —
--   TASK_ANALYTICS_4.

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "AnalyticsAbcMetric" AS ENUM (
  'REVENUE_NET',
  'UNITS'
);

CREATE TYPE "AnalyticsSnapshotStatus" AS ENUM (
  'READY',
  'STALE',
  'INCOMPLETE',
  'FAILED'
);

CREATE TYPE "AnalyticsRecommendationPriority" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);

CREATE TYPE "AnalyticsRecommendationStatus" AS ENUM (
  'ACTIVE',
  'DISMISSED',
  'APPLIED'
);

-- ================================================================
-- 2. AnalyticsMaterializedDaily — дневной KPI слой
-- ================================================================

CREATE TABLE "AnalyticsMaterializedDaily" (
  "id"              TEXT                       NOT NULL,
  "tenantId"        TEXT                       NOT NULL,

  "date"            DATE                       NOT NULL,

  -- NUMERIC(14,2) — суммы за день могут быть крупнее, чем per-SKU.
  "revenueGross"    DECIMAL(14,2)              NOT NULL DEFAULT 0,
  "revenueNet"      DECIMAL(14,2)              NOT NULL DEFAULT 0,
  "ordersCount"     INTEGER                    NOT NULL DEFAULT 0,
  "unitsSold"       INTEGER                    NOT NULL DEFAULT 0,
  "returnsCount"    INTEGER                    NOT NULL DEFAULT 0,
  "avgCheck"        DECIMAL(12,2)              NOT NULL DEFAULT 0,

  -- {"WB": {"revenueNet": 12345.67, "ordersCount": 12, "unitsSold": 18}, ...}
  "byMarketplace"   JSONB                      NOT NULL,
  -- {"orders": {"lastEventAt": "...", "isStale": false}, ...}
  "sourceFreshness" JSONB,

  "formulaVersion"  VARCHAR(32)                NOT NULL,
  "snapshotStatus"  "AnalyticsSnapshotStatus"  NOT NULL DEFAULT 'READY',

  "createdAt"       TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsMaterializedDaily_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AnalyticsMaterializedDaily"
  ADD CONSTRAINT "AnalyticsMaterializedDaily_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- §15 idempotency daily aggregation.
CREATE UNIQUE INDEX "AnalyticsMaterializedDaily_tenantId_date_key"
  ON "AnalyticsMaterializedDaily"("tenantId", "date");

-- Hot path: revenue dynamics window read.
CREATE INDEX "AnalyticsMaterializedDaily_tenantId_date_idx"
  ON "AnalyticsMaterializedDaily"("tenantId", "date");

-- §19 stale-vs-incomplete board.
CREATE INDEX "AnalyticsMaterializedDaily_tenantId_snapshotStatus_date_idx"
  ON "AnalyticsMaterializedDaily"("tenantId", "snapshotStatus", "date");

-- ================================================================
-- 3. AnalyticsAbcSnapshot — ABC-снапшот за период
-- ================================================================

CREATE TABLE "AnalyticsAbcSnapshot" (
  "id"              TEXT                       NOT NULL,
  "tenantId"        TEXT                       NOT NULL,

  "periodFrom"      DATE                       NOT NULL,
  "periodTo"        DATE                       NOT NULL,
  "metric"          "AnalyticsAbcMetric"       NOT NULL,

  "formulaVersion"  VARCHAR(32)                NOT NULL,
  "snapshotStatus"  "AnalyticsSnapshotStatus"  NOT NULL DEFAULT 'READY',

  "payload"         JSONB                      NOT NULL,
  "sourceFreshness" JSONB,

  "generatedAt"     TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsAbcSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AnalyticsAbcSnapshot"
  ADD CONSTRAINT "AnalyticsAbcSnapshot_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- §15 idempotency rebuild + историзация по (period, metric, formula).
CREATE UNIQUE INDEX "AnalyticsAbcSnapshot_tenantId_periodFrom_periodTo_metric_formulaVersion_key"
  ON "AnalyticsAbcSnapshot"("tenantId", "periodFrom", "periodTo", "metric", "formulaVersion");

CREATE INDEX "AnalyticsAbcSnapshot_tenantId_periodTo_generatedAt_idx"
  ON "AnalyticsAbcSnapshot"("tenantId", "periodTo", "generatedAt");

CREATE INDEX "AnalyticsAbcSnapshot_tenantId_snapshotStatus_generatedAt_idx"
  ON "AnalyticsAbcSnapshot"("tenantId", "snapshotStatus", "generatedAt");

-- ================================================================
-- 4. AnalyticsRecommendation — explainable rule-based сигналы
-- ================================================================

CREATE TABLE "AnalyticsRecommendation" (
  "id"             TEXT                                NOT NULL,
  "tenantId"       TEXT                                NOT NULL,
  "productId"      TEXT,

  "ruleKey"        VARCHAR(64)                         NOT NULL,
  "reasonCode"     VARCHAR(64)                         NOT NULL,
  "priority"       "AnalyticsRecommendationPriority"   NOT NULL,
  "status"         "AnalyticsRecommendationStatus"     NOT NULL DEFAULT 'ACTIVE',

  "message"        TEXT                                NOT NULL,
  "payload"        JSONB,

  "formulaVersion" VARCHAR(32)                         NOT NULL,

  "createdAt"      TIMESTAMP(3)                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)                        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"     TIMESTAMP(3),

  CONSTRAINT "AnalyticsRecommendation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AnalyticsRecommendation"
  ADD CONSTRAINT "AnalyticsRecommendation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- product SET NULL — soft-delete товара не должен ломать историю
-- рекомендаций (нужны для аналитики «какие сигналы были до удаления»).
ALTER TABLE "AnalyticsRecommendation"
  ADD CONSTRAINT "AnalyticsRecommendation_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- §15 idempotency recommendation refresh: один активный сигнал на
-- (tenant, product, ruleKey). NULLS DISTINCT (Postgres default) даёт нам
-- множественные tenant-wide правила без productId.
CREATE UNIQUE INDEX "AnalyticsRecommendation_tenantId_productId_ruleKey_key"
  ON "AnalyticsRecommendation"("tenantId", "productId", "ruleKey");

-- UI: топ активных рекомендаций.
CREATE INDEX "AnalyticsRecommendation_tenantId_status_priority_idx"
  ON "AnalyticsRecommendation"("tenantId", "status", "priority");

CREATE INDEX "AnalyticsRecommendation_tenantId_productId_idx"
  ON "AnalyticsRecommendation"("tenantId", "productId");
