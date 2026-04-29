# CHANNEL CONTROLS — Task Pack

> Модуль: `21-channel-controls`
> Статус: [ ] Подготовлено
> Основание: `DOCS/TASKS/21-channel-controls/system-analytics.md`

---

## Состав

- `TASK_CHANNEL_1.md` — Модель данных: StockChannelLock и channel visibility settings (DB-миграции)
- `TASK_CHANNEL_2.md` — Backend API блокировок: CRUD StockChannelLock
- `TASK_CHANNEL_3.md` — Интеграция блокировок в push_stocks pipeline
- `TASK_CHANNEL_4.md` — Backend API улучшений маппинга (склейка): GET by productId, detach, audit
- `TASK_CHANNEL_5.md` — Backend API настроек видимости каналов
- `TASK_CHANNEL_6.md` — Frontend: UI блокировок, склейки и фильтра видимости
- `TASK_CHANNEL_7.md` — QA, regression и observability channel-controls

## Правила

- Каждый файл описывает отдельный инженерный блок.
- Чекбокс задачи закрывается только после заполнения блока `Что сделано`.
- Если задача переносится или дробится, это фиксируется внутри соответствующего файла.
- Порядок выполнения предполагается сверху вниз, если в файле не указано иное.
