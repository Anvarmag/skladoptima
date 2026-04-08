# TASK_REFERRALS_3 — First-Payment Trigger, Reward Crediting и Idempotency

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_2`
  - согласован `13-billing`
- Что нужно сделать:
  - реализовать internal trigger `POST /api/v1/referrals/webhook/first-payment` или equivalent internal contract;
  - начислять reward только по первой успешной оплате любого paid плана referred tenant;
  - перевести attribution через состояния `attributed -> paid -> rewarded`;
  - обеспечить идемпотентность reward crediting при повторных billing events/webhooks;
  - отправлять notification после успешного credit.
- Критерий закрытия:
  - reward logic зависит только от подтвержденного first payment, а не от UI/callback шумов;
  - один eligible tenant не получает reward дважды;
  - reward flow согласован с billing и bonus ledger.

**Что сделано**

- Не выполнено.
