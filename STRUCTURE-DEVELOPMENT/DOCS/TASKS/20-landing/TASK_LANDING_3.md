# TASK_LANDING_3 — Lead Capture, CRM Sync и Controlled Fallback

> Модуль: `20-landing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_LANDING_1`
  - `TASK_LANDING_2`
- Что нужно сделать:
  - реализовать lead submit flow с `lead_type`, consent validation и persistence;
  - интегрировать CRM sync в MVP как обязательный контур;
  - при недоступности CRM сохранять lead локально и переводить его в `queued/failed` без ломки UX;
  - публиковать internal event `lead_created` для последующей доставки;
  - не терять lead при временном сбое внешней CRM.
- Критерий закрытия:
  - CRM входит в MVP, но не является single point of failure для lead capture;
  - lead submit юридически и технически надежен;
  - fallback controlled и наблюдаем.

**Что сделано**

- Не выполнено.
