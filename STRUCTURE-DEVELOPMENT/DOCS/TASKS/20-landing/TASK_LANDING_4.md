# TASK_LANDING_4 — Registration Handoff, UTM/Referral Continuity и Attribution Persistence

> Модуль: `20-landing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_LANDING_1`
  - `TASK_LANDING_2`
  - согласованы `01-auth`, `14-referrals`
- Что нужно сделать:
  - сохранять `utm bundle`, `referral code`, `landing_path`, `session_id`, `anonymous_id`;
  - реализовать TTL и cleanup для `registration_handoff`;
  - передавать handoff в auth flow без потери attribution;
  - не конфликтовать с `referral attribution lock` на этапе signup/tenant creation;
  - обеспечить end-to-end continuity от landing до registration start.
- Критерий закрытия:
  - UTM/referral не теряются при переходе в регистрацию;
  - handoff не живет бесконечно и не допускает reuse вне policy;
  - auth/referrals получают только допустимый marketing context.

**Что сделано**

- Не выполнено.
