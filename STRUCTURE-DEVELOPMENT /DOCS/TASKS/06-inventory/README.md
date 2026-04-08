# INVENTORY — Task Pack

> Модуль: `06-inventory`
> Статус: [x] Подготовлено
> Основание: `DOCS/SYSTEM-ANALYTICS/06-inventory/system-analytics.md`

---

## Состав

- `TASK_INVENTORY_1.md` — Data model, balances, movements и settings
- `TASK_INVENTORY_2.md` — Manual adjustments, history и low-stock settings
- `TASK_INVENTORY_3.md` — Reserve, release, deduct contracts с orders
- `TASK_INVENTORY_4.md` — Idempotency locks, reconciliation и conflict handling
- `TASK_INVENTORY_5.md` — Tenant-state guards, FBS/FBO boundaries и sync handoff
- `TASK_INVENTORY_6.md` — Frontend inventory UX и diagnostics
- `TASK_INVENTORY_7.md` — QA, regression и observability inventory

## Правила

- Каждый файл описывает отдельный инженерный блок.
- Чекбокс задачи закрывается только после заполнения блока `Что сделано`.
- Если задача переносится или дробится, это фиксируется внутри соответствующего файла.
- Порядок выполнения предполагается сверху вниз, если в файле не указано иное.
