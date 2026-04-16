# Tasks — Sprint 5 — Worker Platform + Sync Engine

> Спринт: 5
> Даты: 27 мая – 9 июня 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-01 | Реализовать job model, queue consumer, retry/backoff policy | P0 | 12h | TODO |
| T5-02 | Реализовать scheduled jobs и lease/recovery model | P0 | 8h | TODO |
| T5-03 | Реализовать sync run API: start/list/detail/retry/full | P0 | 10h | TODO |
| T5-04 | Реализовать `sync_runs`, `sync_run_items`, `sync_conflicts` orchestration | P0 | 10h | TODO |
| T5-05 | Реализовать adapter contract и stage execution pipeline | P1 | 8h | TODO |
| T5-06 | Реализовать idempotency/dedup policy для run/event processing | P1 | 6h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-10 | Собрать UI истории sync-runs и деталей run | P0 | 10h | TODO |
| T5-11 | Собрать UI conflicts list и retry/full-sync actions | P0 | 8h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-20 | Создать таблицы jobs/queues/dead-letter или storage под runtime | P0 | 5h | TODO |
| T5-21 | Создать таблицы `sync_runs`, `sync_run_items`, `sync_conflicts` | P0 | 4h | TODO |
| T5-22 | Добавить индексы по account/status/started_at и conflict search | P0 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-30 | Поднять runtime конфиг worker/scheduler/queue | P0 | 4h | TODO |
| T5-31 | Настроить alerting по queue lag и failed jobs | P1 | 3h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T5-40 | Проверить retry/backoff/dead-letter и recovery после restart | P0 | 6h | TODO |
| T5-41 | Проверить manual run/retry/full sync API | P0 | 4h | TODO |
| T5-42 | Проверить conflict registration и partial success | P0 | 4h | TODO |
| T5-43 | Проверить concurrency guard на одинаковый sync | P1 | 3h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 54 | |
| Frontend | 18 | |
| БД | 12 | |
| Инфра | 7 | |
| Тестирование | 17 | |
| **Итого** | **108** | |
