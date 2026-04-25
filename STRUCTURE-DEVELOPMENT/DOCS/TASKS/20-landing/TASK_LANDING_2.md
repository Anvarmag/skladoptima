# TASK_LANDING_2 — Public API: Pricing, FAQ, Legal, Leads и Track Endpoints

> Модуль: `20-landing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_LANDING_1`
- Что нужно сделать:
  - реализовать `GET /api/v1/public/pricing`, `GET /api/v1/public/faq`, `GET /api/v1/public/legal/:docType`;
  - реализовать `POST /api/v1/public/leads`, `POST /api/v1/public/track`, `POST /api/v1/public/registration-handoff`;
  - обеспечить public-only middleware без tenant-scoped auth assumptions;
  - поддержать legal docs active version retrieval;
  - валидировать payloads для leads/track/handoff.
- Критерий закрытия:
  - public API покрывает acquisition и legal нужды MVP;
  - pricing/faq/legal отдаются предсказуемо и быстро;
  - public endpoints изолированы от tenant APIs и product auth context.

**Что сделано**

- Не выполнено.
