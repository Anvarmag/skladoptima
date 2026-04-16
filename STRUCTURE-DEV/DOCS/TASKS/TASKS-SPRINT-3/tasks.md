# Tasks — Sprint 3 — Catalog Core + Files Storage

> Спринт: 3
> Даты: 29 апреля – 12 мая 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T3-01 | Реализовать product CRUD + soft delete/restore API | P0 | 10h | TODO |
| T3-02 | Реализовать import preview job и import commit API | P0 | 12h | TODO |
| T3-03 | Реализовать auto-match/manual-match и mapping constraints | P0 | 8h | TODO |
| T3-04 | Реализовать files API: create file record, signed upload, signed read | P0 | 8h | TODO |
| T3-05 | Реализовать replace flow и cleanup pending lifecycle | P1 | 5h | TODO |

## Frontend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T3-10 | Собрать каталог: список, фильтры, product card, create/edit forms | P0 | 14h | TODO |
| T3-11 | Собрать import preview/commit UI с ошибками и duplicates | P0 | 10h | TODO |
| T3-12 | Подключить upload/replace product image UI | P1 | 6h | TODO |

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T3-20 | Создать таблицы `products`, `product_channel_mappings`, `catalog_import_jobs`, `catalog_import_job_items` | P0 | 5h | TODO |
| T3-21 | Создать таблицы `files`, `file_links`, индексы tenant/product scope | P0 | 4h | TODO |
| T3-22 | Добавить уникальности SKU и mapping uniqueness | P0 | 3h | TODO |

## Инфраструктура / DevOps

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T3-30 | Подключить object storage bucket и policy для private media | P0 | 4h | TODO |
| T3-31 | Настроить cleanup worker config для obsolete files | P1 | 2h | TODO |

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T3-40 | Протестировать product CRUD и soft delete/restore | P0 | 4h | TODO |
| T3-41 | Протестировать import preview/commit, duplicates, invalid rows | P0 | 6h | TODO |
| T3-42 | Протестировать upload/access/replace file flow | P0 | 5h | TODO |
| T3-43 | Протестировать tenant isolation на files и products | P1 | 3h | TODO |

## Перенесено из предыдущего спринта

| ID (оригинал) | Задача | Причина переноса |
|--------------|--------|----------------|
| - | - | - |

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 43 | |
| Frontend | 30 | |
| БД | 12 | |
| Инфра | 6 | |
| Тестирование | 18 | |
| **Итого** | **109** | |
