# Tasks — Sprint 7 — Inventory Hardening + Notifications + Audit Search

> Спринт: 7
> Даты: 24 июня – 7 июля 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T7-01 | Реализовать low-stock rule engine и threshold settings | P0 | 8h | TODO |
| T7-02 | Реализовать inventory conflict detection/read model | P1 | 6h | TODO |
| T7-03 | Реализовать notification event/dispatch/delivery model | P0 | 10h | TODO |
| T7-04 | Реализовать delivery pipeline с retries/dedup/throttle | P0 | 10h | TODO |
| T7-05 | Реализовать in-app inbox API и read state | P1 | 6h | TODO |
| T7-06 | Расширить audit query API: filters/search/drilldown | P0 | 8h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T7-10 | Собрать inventory low-stock/conflicts UI | P0 | 8h | TODO |
| T7-11 | Собрать notification center/inbox UI | P0 | 8h | TODO |
| T7-12 | Собрать audit search/drilldown UI | P1 | 8h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T7-20 | Создать таблицы `notification_events`, `notification_dispatches`, `notification_reads`, `notification_preferences` | P0 | 5h | TODO |
| T7-21 | Добавить read-model и индексы для audit search / inventory conflicts | P0 | 4h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T7-30 | Настроить provider channel config и alerting по dispatch failures | P1 | 4h | TODO |
| T7-31 | Настроить dashboards для stock anomalies / notification SLA / audit failures | P1 | 4h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T7-40 | Проверить low-stock thresholds и conflicts | P0 | 4h | TODO |
| T7-41 | Проверить notification dispatch/delivery/retry/dedup | P0 | 6h | TODO |
| T7-42 | Проверить in-app inbox и read state | P1 | 3h | TODO |
| T7-43 | Проверить audit search visibility и immutable records | P0 | 5h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 48 | |
| Frontend | 24 | |
| БД | 9 | |
| Инфра | 8 | |
| Тестирование | 18 | |
| **Итого** | **107** | |
