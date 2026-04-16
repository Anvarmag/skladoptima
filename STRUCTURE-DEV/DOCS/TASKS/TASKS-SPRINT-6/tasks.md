# Tasks — Sprint 6 — Orders + Inventory Core

> Спринт: 6
> Даты: 10–23 июня 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T6-01 | Реализовать order ingestion/service и duplicate detection | P0 | 10h | TODO |
| T6-02 | Реализовать internal order state machine и status history | P0 | 8h | TODO |
| T6-03 | Реализовать inventory balance service и movement model | P0 | 10h | TODO |
| T6-04 | Реализовать reserve/release/deduct через доменные события | P0 | 10h | TODO |
| T6-05 | Реализовать manual inventory adjust API и negative stock guard | P1 | 6h | TODO |
| T6-06 | Реализовать orders list/detail API и inventory list/detail API | P1 | 8h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T6-10 | Собрать UI списка/деталей заказов | P0 | 10h | TODO |
| T6-11 | Собрать UI inventory balances/movements/manual adjust | P0 | 10h | TODO |
| T6-12 | Отобразить state transitions и stock side-effects в карточках | P1 | 5h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T6-20 | Создать таблицы `orders`, `order_items`, `order_events` | P0 | 5h | TODO |
| T6-21 | Создать таблицы `stock_balances`, `stock_movements`, `stock_overrides` | P0 | 5h | TODO |
| T6-22 | Добавить индексы на external order keys, product/warehouse scope, movement time | P0 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T6-30 | Настроить background processing policy для order/inventory side-effects | P1 | 3h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T6-40 | Проверить new/cancel/fulfill order lifecycle | P0 | 5h | TODO |
| T6-41 | Проверить duplicate/out-of-order order events | P0 | 4h | TODO |
| T6-42 | Проверить reserve/release/deduct и negative stock guard | P0 | 6h | TODO |
| T6-43 | Проверить manual adjust и inventory calculations | P1 | 4h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 52 | |
| Frontend | 25 | |
| БД | 13 | |
| Инфра | 3 | |
| Тестирование | 19 | |
| **Итого** | **112** | |
