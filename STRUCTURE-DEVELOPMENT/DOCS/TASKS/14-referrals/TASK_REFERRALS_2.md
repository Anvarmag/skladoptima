# TASK_REFERRALS_2 — Bonus Wallet, Transactions и Reward Ledger

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_REFERRALS_1`
- Что нужно сделать:
  - завести `bonus_wallets` и `bonus_transactions`;
  - реализовать ledger-модель `credit/debit` без direct balance mutation вне transaction log;
  - обеспечить `UNIQUE(wallet_id, reason_code, referred_tenant_id)` для защиты от двойного reward;
  - реализовать `GET /api/v1/referrals/bonus-balance` и `GET /api/v1/referrals/bonus-transactions`;
  - подготовить reason codes и metadata для reward credit/spend traceability.
- Критерий закрытия:
  - бонусный баланс прозрачно восстанавливается из ledger;
  - reward/spend операции трассируемы и идемпотентны;
  - direct balance update без ledger невозможен.

**Что сделано**

- Не выполнено.
