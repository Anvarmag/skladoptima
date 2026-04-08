# TASK_LANDING_5 — Consent, Legal Compliance и Anti-Spam/Rate-Limit Policy

> Модуль: `20-landing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_LANDING_1`
  - `TASK_LANDING_2`
  - `TASK_LANDING_3`
- Что нужно сделать:
  - требовать явный `consent=true` под lead/demo form;
  - хранить `consent_doc_version` и связанный legal context;
  - развести consent для lead submit и consent для optional analytics/cookies;
  - ввести anti-spam/rate-limit по IP/email для lead submit;
  - не позволять маркетинговым экспериментам обходить legal/compliance flows.
- Критерий закрытия:
  - lead submit без consent невозможен;
  - legal/compliance state не зависит только от frontend local state;
  - anti-spam policy снижает abuse без ломки реального UX.

**Что сделано**

- Не выполнено.
