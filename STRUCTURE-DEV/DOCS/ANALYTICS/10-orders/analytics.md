# Заказы — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Отслеживать качество импорта заказов из маркетплейсов, корректность влияния FBS-заказов на reserved/on_hand и полноту дедупликации по `marketplaceOrderId`. На основе данных принимаются решения по надежности order-flow и связке с inventory.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Order Ingestion Success | Заказы успешно сохранены в системе | >= 98% | `ingested_orders / received_order_events` |
| Deduplication Accuracy | Корректная дедупликация заказов | >= 99.9% | `deduped_without_double_effect / duplicate_event_candidates` |
| FBS Effect Correctness | Корректное влияние FBS на остаток | >= 99% | `correct_fbs_stock_effect / total_fbs_effect_events` |
| FBO Isolation Accuracy | FBO заказы без влияния на master stock | 100% | `fbo_no_stock_effect / total_fbo_orders` |
| Status Mapping Completeness | Наличие внешнего и внутреннего статуса | >= 99% | `orders_with_both_statuses / total_orders` |
| Order Search Success | Успех пользовательского поиска заказа | >= 90% | `search_results_non_empty / search_queries` |

---

## 3. Воронки и конверсии

```
Order event received -> Order persisted -> Status normalized -> Stock effect applied (FBS only)
100%                 -> 98%             -> 96%               -> 95%
```

Воронка жизненного цикла FBS-заказа:

```
new -> reserved -> fulfilled/cancelled -> inventory finalized
100% -> 92%     -> 88%                -> 87%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Owner/Admin | Контроль полноты и корректности заказов | Прозрачный статус и связь с inventory |
| Manager | Ежедневная операционная работа с заказами | Быстрый поиск и фильтры |
| Tenant с высоким order volume | Больше дублей и обновлений статусов | Сильная дедупликация и идемпотентность |
| Multi-marketplace tenant | Разные внешние статусы | Нормализация статусов в единый слой |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `order_event_received` | Получено внешнее order-событие | `marketplace`, `marketplace_order_id`, `fulfillment_mode` | High |
| `order_ingested` | Заказ сохранен | `order_id`, `items_count`, `marketplace` | High |
| `order_duplicate_detected` | Найден дубль по `marketplaceOrderId` | `duplicate_source`, `idempotency_key` | High |
| `order_status_mapped` | Внешний статус преобразован во внутренний | `external_status`, `internal_status` | High |
| `order_fbs_reserved` | Создан резерв по FBS | `order_id`, `sku_count`, `qty_total` | High |
| `order_fbs_reserve_released` | Снят резерв (cancelled) | `order_id`, `qty_total` | High |
| `order_fbs_deducted` | Финальное списание on_hand | `order_id`, `qty_total` | High |
| `order_fbo_display_only` | FBO заказ сохранен без stock-effect | `order_id`, `marketplace` | High |
| `order_return_logged` | Зафиксирован возврат | `order_id`, `return_type` | Med |
| `order_search_performed` | Выполнен поиск | `query_type`, `result_count` | Low |

---

## 6. Текущее состояние (baseline)

- Раздел работает, но baseline по дедупликации и корректности FBS-effect не вынесен в SLA.
- Нужно раздельно фиксировать baseline для FBS и FBO потоков.
- На старте важно получить baseline по задержке статуса от marketplace до UI.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Явный бейдж “влияет на остаток” в списке повысит операционную точность работы менеджеров | `order_handling_mistakes_rate` | Идея |
| Приоритетная обработка новых FBS-событий снизит лаг reserve | `time_to_reserve_after_event` | Идея |
| Унификация словаря внутренних статусов сократит ручные проверки support | `order_status_clarification_tickets` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Orders Ingestion: объем, ошибки, лаги, дедупликация.
- [ ] FBS Stock Effect: reserve/release/deduct и точность.
- [ ] Status Mapping: внешний vs внутренний статус по marketplace.
- [ ] Operational Orders View: фильтры, поиск, распределение FBS/FBO.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Повторный stock-effect одного order | Любой случай | Критичный инцидент идемпотентности |
| Доля немаппленных статусов | `> 2%` | Обновить mapping-таблицу и fallback-логику |
| Рост order ingestion errors | `> 2%` | Проверить sync pipeline и schema compatibility |
| Ошибочное влияние FBO на stock | Любой случай | Блокирующий дефект бизнес-логики |

---

## 11. Источники данных и правила расчета

- Источник: `orders`, `order_items`, `order_events`, inventory effect events, sync ingestion logs.
- Order ingestion success должен считаться по внешним order events, а не по уже нормализованным заказам.
- FBS/FBO accuracy считается по полю `fulfillment_mode` после нормализации, а не по сырому внешнему статусу.
- Deduplication accuracy должна проверяться по уникальному `marketplaceOrderId + marketplace + tenant`.

---

## 12. Data Quality и QA-проверки

- Заказ не должен иметь дважды примененный reserve или deduct.
- Для каждого заказа обязаны храниться `external_status`, `internal_status`, `marketplace`, `processed_at`.
- QA должна проверить new/cancel/fulfill flows, duplicate event, unmatched SKU, FBO display-only, return event.
- Расчет `affectsStock=true` должен быть невозможен для FBO сценария.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: видимость и удобство order operations.
- Backend lead: идемпотентность, status mapping, stock side-effects.
- QA: order lifecycle regression и edge-cases ingestion.
- Data review: ежедневно по ingestion errors и duplicate handling, еженедельно по status coverage.

---

## 14. Зависимости, допущения и границы

- Заказы являются внешне инициируемой сущностью, поэтому ingestion и normalization должны быть устойчивы к дублям, задержкам и out-of-order событиям.
- Внутренний статус заказа не обязан зеркалировать внешний 1-в-1, но обязан иметь прозрачные правила маппинга.
- Влияние заказа на остатки должно быть детерминированным и зависеть от fulfillment mode и стадии жизненного цикла заказа.
- Исторические заказы нельзя пересчитывать “задним числом” без фиксации причины и audit trail, иначе ломаются финансы и операционная аналитика.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
