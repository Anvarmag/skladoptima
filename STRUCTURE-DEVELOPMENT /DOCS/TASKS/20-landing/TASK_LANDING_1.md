# TASK_LANDING_1 — Public Pages, Content Boundaries и Public Data Model

> Модуль: `20-landing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `20-landing`
  - согласованы `01-auth`, `04-onboarding`, `14-referrals`
- Что нужно сделать:
  - завести `landing_leads`, `landing_events`, `landing_registration_handoffs`, `legal_documents`;
  - закрепить границу public acquisition layer вне tenant-facing кабинета;
  - зафиксировать обязательные MVP pages: `home`, `pricing`, `faq`, `privacy`, `terms`, `cookies`, `register`, `request-demo/contact`;
  - предусмотреть отдельный `/demo` route;
  - согласовать public content boundaries между статическим frontend и public backend API.
- Критерий закрытия:
  - public data model покрывает leads, handoffs, legal docs и tracking;
  - landing отделен от tenant/product context;
  - page scope MVP выражен явно и без двусмысленности.

**Что сделано**

- Не выполнено.
