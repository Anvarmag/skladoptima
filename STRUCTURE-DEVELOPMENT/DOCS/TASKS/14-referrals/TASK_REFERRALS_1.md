# TASK_REFERRALS_1 — Referral Links, Attribution Model и Lock Policy

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `14-referrals`
  - согласованы `01-auth`, `02-tenant`, `20-landing`
- Что нужно сделать:
  - завести `referral_links` и `referral_attributions`;
  - реализовать сохранение attribution на этапе `registration + tenant creation`;
  - зафиксировать attribution lock по `referred_tenant_id` без silent reassignment другим referrer;
  - хранить attribution context: `referral_code`, `utm_*`, `source_ip`, `user_agent`, `registration_attributed_at`;
  - реализовать `GET /api/v1/referrals/link`, `GET /api/v1/referrals/status`.
- Критерий закрытия:
  - referral attribution переживает весь signup flow без потери источника;
  - attribution lock воспроизводим и не допускает перезаписи;
  - referral link/code работает как отдельный доменный объект, а не как ad-hoc параметр.

**Что сделано**

- Не выполнено.
