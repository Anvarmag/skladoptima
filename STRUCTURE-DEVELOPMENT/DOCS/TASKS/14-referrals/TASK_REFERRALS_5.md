# TASK_REFERRALS_5 — Anti-Fraud, Self-Referral Guard и Audit

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_3`
  - `TASK_REFERRALS_4`
- Что нужно сделать:
  - реализовать self-referral guard по owner/identity связям;
  - блокировать duplicate reward и suspicious attribution cases;
  - ввести `rejected` и `fraud_review` сценарии attribution;
  - писать audit на attribution decisions, reward credit/debit, promo apply/reject и fraud triggers;
  - подготовить anti-fraud recheck job для спорных кейсов.
- Критерий закрытия:
  - self-referral и очевидный duplicate abuse блокируются до reward crediting;
  - fraud-related решения воспроизводимы по audit/logs;
  - модуль не позволяет вручную начислять бонусы без ledger/audit следа.

**Что сделано**

- Не выполнено.
