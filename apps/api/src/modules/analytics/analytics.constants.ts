/**
 * TASK_ANALYTICS_1 — стабильные константы analytics domain.
 *
 * Зачем отдельный файл (а не magic strings в сервисах): §14 + §20 риск
 * «recommendation должна быть explainable и versioned». Если правило
 * закодировано строкой в одном месте, мы рано или поздно расходимся
 * между rule engine, UI рендером и тестами.
 *
 * Здесь же — единая `ANALYTICS_FORMULA_VERSION`, под которой пишутся
 * все три типа snapshot'ов: смена версии создаёт новые строки, не
 * перетирая исторические (§9 + §15).
 */

/** Стабильный идентификатор версии формул KPI и ABC. Меняется ТОЛЬКО
 * при пересмотре правил агрегации (avg_check, ABC accumulation, ...). */
export const ANALYTICS_FORMULA_VERSION = 'mvp-v1' as const;

/** §14 правило MVP: ABC строим по REVENUE_NET. */
export const ABC_GROUP_THRESHOLDS = {
    A: 0.8,
    B: 0.95,
} as const;

/** Ключи правил rule-based engine'а. UI маппит их в человекочитаемые
 * объяснения, тесты — в фикстуры. Никаких magic strings в сервисах. */
export const ANALYTICS_RULE_KEYS = {
    LOW_STOCK_HIGH_DEMAND: 'low_stock_high_demand',
    NEGATIVE_MARGIN: 'negative_margin',
    LOW_RATING: 'low_rating',
    STALE_ANALYTICS_SOURCE: 'stale_analytics_source',
    ABC_GROUP_C_LOW_TURNOVER: 'abc_group_c_low_turnover',
} as const;

export type AnalyticsRuleKey =
    (typeof ANALYTICS_RULE_KEYS)[keyof typeof ANALYTICS_RULE_KEYS];

/** Машинно-читаемые reason codes — фиксируют, ПОЧЕМУ правило сработало.
 * Один rule_key может иметь несколько reason_code (например, разные
 * пороги срочности у LOW_STOCK_HIGH_DEMAND). UI рендерит по reason_code. */
export const ANALYTICS_REASON_CODES = {
    STOCK_BELOW_7_DAYS: 'stock_below_7_days',
    STOCK_BELOW_14_DAYS: 'stock_below_14_days',
    PROFIT_NEGATIVE: 'profit_negative',
    RATING_BELOW_4: 'rating_below_4',
    SOURCE_STALE_OVER_24H: 'source_stale_over_24h',
    LOW_TURNOVER_30_DAYS: 'low_turnover_30_days',
} as const;

export type AnalyticsReasonCode =
    (typeof ANALYTICS_REASON_CODES)[keyof typeof ANALYTICS_REASON_CODES];

/** §18 SLA — допустимый возраст source-данных, после которого витрина
 * помечается `STALE`. Совпадает с `STALE_SOURCE_WINDOW_HOURS` из finance,
 * чтобы dashboard и unit-economics показывали одинаковую freshness-границу. */
export const ANALYTICS_STALE_SOURCE_WINDOW_HOURS = 48;

/** Максимальный диапазон периода для on-the-fly request (§10). За пределами
 * — клиент должен указать готовый snapshot или дождаться rebuild. */
export const ANALYTICS_MAX_PERIOD_DAYS = 366;
