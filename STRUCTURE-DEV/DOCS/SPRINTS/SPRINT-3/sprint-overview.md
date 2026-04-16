# Sprint 3 — Catalog Core + Files Storage — Обзор

> Даты: 29 апреля – 12 мая 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Построить мастер-каталог товаров и безопасное файловое хранилище для product media.

---

## Цель спринта

Поднять нормализованный product master, ручной CRUD, import preview/commit, mappings к внешним товарам и private file storage/signed URL модель для product media.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 05. Каталог товаров | [05-catalog](../../BUSINESS-REQUIREMENTS/05-catalog/requirements.md) | [05-catalog](../../SYSTEM-ANALYTICS/05-catalog/system-analytics.md) |
| 17. Файлы / S3 | [17-files-s3](../../BUSINESS-REQUIREMENTS/17-files-s3/requirements.md) | [17-files-s3](../../SYSTEM-ANALYTICS/17-files-s3/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Product CRUD и soft delete/restore
- [ ] Import preview/commit с валидацией, duplicates, auto/manual match
- [ ] Product media upload через object storage и file metadata model
- [ ] Signed URL/private access + replace/cleanup lifecycle
- [ ] UI каталога с таблицей, карточкой и import flow baseline

---

## Что НЕ входит в спринт

- расчет остатков и order side-effects
- marketplace sync
- финансовая аналитика и ABC

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Потеря целостности между product и external mapping | Med | High | Ввести явные уникальности и mapping policy |
| Orphan files после replace/delete | Med | Med | File lifecycle + cleanup pending state |
| Слишком тяжелый import commit | Med | Med | Preview и commit только асинхронно |

---

## Зависимости

- Sprint 1 foundation по auth/tenant scope
- Object storage credentials и окружение
- Согласованная product model и SKU policy

---

## Ссылки

- Задачи: [TASKS-SPRINT-3](../../TASKS/TASKS-SPRINT-3/tasks.md)
- Детальный план: [PLAN-SPRINT-3](../../PLAN/PLAN-SPRINT-3.md)
