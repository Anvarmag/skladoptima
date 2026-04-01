# Sprint 3 — Worker + S3 — Обзор

> Даты: 29 апреля – 12 мая 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Выделить Worker, перейти на S3 для файлов

---

## Цель спринта

Вынести синхронизацию и email в отдельный Worker-процесс. Перевести хранение фото с локального диска на S3.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований |
|--------|----------------|
| Worker | [18-worker](../../BUSINESS-REQUIREMENTS/18-worker/requirements.md) |
| Файлы S3 | [17-files-s3](../../BUSINESS-REQUIREMENTS/17-files-s3/requirements.md) |
| Синхронизация | [09-sync](../../BUSINESS-REQUIREMENTS/09-sync/requirements.md) |

---

## Ключевые deliverables

- [ ] apps/worker как отдельный NestJS app
- [ ] Sync перенесён из API в Worker
- [ ] Redis очередь для email-задач
- [ ] Фото товаров загружаются в S3
- [ ] Миграция существующих локальных файлов в S3

---

## Зависимости

- Sprint 1 завершён

---

## Ссылки

- Задачи: [TASKS-SPRINT-3](../../TASKS/TASKS-SPRINT-3/tasks.md)
- Детальный план: [PLAN-SPRINT-3](../../PLAN/PLAN-SPRINT-3.md)
