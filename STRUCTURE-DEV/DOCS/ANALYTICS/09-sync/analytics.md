# Синхронизация (Marketplace Sync) — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять надежность и скорость pull/push/order-sync процессов, долю частичных и неуспешных запусков, а также влияние конфликтов и lock/override на бизнес-результат. Основная задача — обеспечить предсказуемый и наблюдаемый sync-контур tenant.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Sync Success Rate | Доля `success` запусков | >= 92% | `sync_runs_success / sync_runs_total` |
| Partial/Failed Rate | Доля `partial_success + failed` | <= 8% | `(partial + failed) / total_runs` |
| Mean Sync Duration | Средняя длительность sync run | <= 120 сек | `avg(finished_at - started_at)` |
| Freshness SLA | Актуальность ключевых данных после sync | <= 5 мин p95 | `p95(data_updated_at - source_event_at)` |
| Conflict Incidence | Конфликты устаревших событий | <= 2% | `conflict_detected / processed_external_events` |
| Manual Retry Effectiveness | Успех после ручного retry | >= 60% | `manual_retry_success / manual_retry_started` |

---

## 3. Воронки и конверсии

```
Sync scheduled/manual -> Run started -> External API processed -> Run finalized -> Data reflected in UI
100%                 -> 98%         -> 94%                   -> 92%           -> 89%
```

Для ошибок:

```
Run failed -> Retry queued -> Retry completed -> Success after retry
100%       -> 85%          -> 78%             -> 60%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Tenant с 1 account | Более линейный sync | Базовый health-monitor |
| Multi-account tenant | Разнотипные ошибки по каналам | Отдельная диагностика на account |
| Tenant с lock/override | Нестандартный push-поток | Ясная визуализация исключений |
| High-volume tenant | Высокая нагрузка и rate-limit риски | Устойчивая очередь и backoff |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `sync_run_started` | Старт sync run | `tenant_id`, `account_id`, `run_type=pull/push/order` | High |
| `sync_run_finished` | Завершение run | `status`, `duration_sec`, `processed_count` | High |
| `sync_run_failed` | Run завершен ошибкой | `error_code`, `error_stage` | High |
| `sync_run_partial_success` | Частичный успех | `success_count`, `error_count` | High |
| `sync_manual_retry_started` | Пользователь запустил retry | `account_id`, `actor_role` | Med |
| `sync_manual_retry_finished` | Retry завершен | `status`, `duration_sec` | Med |
| `sync_conflict_detected` | Зафиксирован конфликт события | `entity_type`, `entity_id`, `channel` | High |
| `sync_lock_override_applied` | Учтен lock/override | `sku`, `channel` | Med |
| `sync_rate_limit_hit` | Получен rate-limit ответ API | `marketplace`, `retry_after` | High |
| `sync_last_success_updated` | Обновлен `lastSyncAt` | `account_id`, `timestamp` | Med |

---

## 6. Текущее состояние (baseline)

- Sync работает, но целевой baseline по `success/partial/failed` не согласован и должен быть зафиксирован в едином отчете.
- Нужен отдельный baseline по конфликтам после ручных корректировок inventory.
- Важно сразу вести baseline по каждому `run_type` (pull/push/order), так как профили ошибок разные.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Разделение очередей pull/push снизит длительность и failures | `Mean Sync Duration`, `Sync Success Rate` | Идея |
| Адаптивный backoff по marketplace уменьшит `rate_limit_hit` | `Partial/Failed Rate` | Идея |
| UI-алерт с точной причиной ошибки увеличит успешность manual retry | `Manual Retry Effectiveness` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Sync Operations: runs, statuses, duration, throughput.
- [ ] Account Health: last sync, error state, reconnect needed.
- [ ] Conflict & Override: конфликты, lock/override coverage.
- [ ] Retry Performance: auto/manual retry и их эффективность.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение success rate | `< 85%` | Incident review, разбор по marketplace/account |
| Рост `failed` в одном account | `> 3 подряд` | Авто-эскалация и рекомендация reconnect |
| Длительный run duration | `p95 > 300 сек` | Проверить очередь worker и внешние API лимиты |
| Массовые конфликты после inventory updates | `> 5% событий` | Ревизия event ordering и idempotency |

---

## 11. Источники данных и правила расчета

- Источник: `sync_runs`, `sync_run_items`, `sync_conflicts`, account health events, queue metrics.
- Success rate считается по run-level статусу, а не по количеству обработанных item.
- Freshness SLA должна измеряться отдельно по `stocks`, `orders`, `metadata`, потому что у них разные бизнес-ожидания.
- Retry effectiveness считается только для повторных запусков после `failed/partial`, а не для штатных scheduled runs.

---

## 12. Data Quality и QA-проверки

- Каждый run обязан иметь `account_id`, `trigger_type`, `started_at`, `status`.
- `duration_ms` не должен быть отрицательным или null для завершенных run.
- QA должна проверить: manual run, scheduled run, partial success, retry, rate limit, duplicate event, conflict registration.
- Conflict events должны коррелироваться с конкретным entity/run, а не жить как анонимные ошибки.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: user-visible sync health.
- Integration/Backend lead: success rate, partial/failure taxonomy, retry behavior.
- QA: sync regression matrix на happy path и degradation path.
- Data review: ежедневно по failures/conflicts, еженедельно по freshness/SLA.

---

## 14. Зависимости, допущения и границы

- Sync не является одним действием: stocks, orders, catalog metadata и справочники имеют разные триггеры, SLA и влияние на бизнес.
- Успешный run не гарантирует отсутствие пропущенных item, поэтому аналитика должна видеть и run-level, и item-level качество.
- Webhook и polling должны анализироваться раздельно, иначе невозможно понять источник деградации или задержки.
- Конфликты синхронизации должны быть объяснимыми и привязанными к сущности, иначе их нельзя ни чинить, ни использовать в продукте.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
