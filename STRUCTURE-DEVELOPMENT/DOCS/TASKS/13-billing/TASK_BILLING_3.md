# TASK_BILLING_3 — Subscription-to-Access Mapping и Grace/Suspended Policy

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_BILLING_1`
  - `TASK_BILLING_2`
  - согласован `02-tenant`
- Что нужно сделать:
  - реализовать mapping `subscription state -> tenant access state`;
  - закрепить `TRIAL_ACTIVE`, `TRIAL_EXPIRED`, `ACTIVE_PAID`, `GRACE_PERIOD`, `SUSPENDED`;
  - зафиксировать `GRACE_PERIOD = 3 дня` только для paid nonpayment;
  - обеспечить immediate transition в `TRIAL_EXPIRED` после завершения trial без оплаты;
  - не позволять billing UI напрямую менять tenant access state в обход policy transition engine.
- Критерий закрытия:
  - subscription/access mapping воспроизводим и не спорит с tenant policy;
  - `TRIAL_EXPIRED` и `GRACE_PERIOD` семантически разделены;
  - переходы в `SUSPENDED` происходят централизованно и предсказуемо.

**Что сделано**

- Не выполнено.
