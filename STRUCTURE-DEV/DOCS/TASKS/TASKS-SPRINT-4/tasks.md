# Tasks — Sprint 4 — Marketplace Connections + Warehouses

> Спринт: 4
> Даты: 13–26 мая 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T4-01 | Реализовать marketplace account CRUD API и status model | P0 | 10h | TODO |
| T4-02 | Реализовать credentials validation flow и reconnect/update API | P0 | 8h | TODO |
| T4-03 | Реализовать masked secret policy и response serializers | P0 | 4h | TODO |
| T4-04 | Реализовать warehouse fetch/upsert flow по account | P0 | 8h | TODO |
| T4-05 | Реализовать FBS/FBO normalization и inactive warehouse policy | P1 | 5h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T4-10 | Собрать UI списка account, create/edit/validate/reconnect | P0 | 12h | TODO |
| T4-11 | Собрать masked credentials UX и status diagnostics | P0 | 6h | TODO |
| T4-12 | Собрать UI справочника складов и фильтры по FBS/FBO | P1 | 6h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T4-20 | Создать таблицы `marketplace_accounts`, `marketplace_account_events` | P0 | 4h | TODO |
| T4-21 | Создать таблицы `warehouses` и индексы на account/external id | P0 | 4h | TODO |
| T4-22 | Добавить encrypted/masked storage поля и status enums | P0 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T4-30 | Подготовить secret encryption key management для account credentials | P0 | 3h | TODO |
| T4-31 | Настроить health-check job config для marketplace validation | P1 | 2h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T4-40 | Протестировать account lifecycle create/validate/update/disable | P0 | 5h | TODO |
| T4-41 | Протестировать masked secret visibility и security cases | P0 | 4h | TODO |
| T4-42 | Протестировать warehouse upsert и classification stability | P0 | 4h | TODO |
| T4-43 | Проверить многократные account одного marketplace и tenant isolation | P1 | 3h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 35 | |
| Frontend | 24 | |
| БД | 11 | |
| Инфра | 5 | |
| Тестирование | 16 | |
| **Итого** | **91** | |
