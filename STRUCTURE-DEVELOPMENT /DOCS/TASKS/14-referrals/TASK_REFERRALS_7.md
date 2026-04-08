# TASK_REFERRALS_7 — QA, Regression и Observability Referrals

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_2`
  - `TASK_REFERRALS_3`
  - `TASK_REFERRALS_4`
  - `TASK_REFERRALS_5`
  - `TASK_REFERRALS_6`
- Что нужно сделать:
  - покрыть тестами успешную attribution, self-referral block, duplicate first-payment webhook, locked attribution;
  - проверить, что reward триггерится первой успешной оплатой любого paid плана;
  - покрыть promo expiry, max uses, not applicable plan, promo+bonus conflict;
  - проверить, что bonus spend и reward crediting не ломают ledger/idempotency;
  - завести метрики и алерты по referral funnel, duplicate reward attempts, fraud blocks, promo reject spikes.
- Критерий закрытия:
  - регрессии по attribution, reward idempotency и stack rules ловятся автоматически;
  - observability показывает состояние referral funnel, bonus ledger и anti-fraud;
  - QA matrix покрывает утвержденную MVP growth policy.

**Что сделано**

- Не выполнено.
