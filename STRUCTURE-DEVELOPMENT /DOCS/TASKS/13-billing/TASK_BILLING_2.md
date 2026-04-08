# TASK_BILLING_2 — Payment Provider, Checkout и Webhook Lifecycle

> Модуль: `13-billing`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_BILLING_1`
- Что нужно сделать:
  - реализовать `GET /api/v1/billing/plans`, `GET /api/v1/billing/subscription`, `POST /api/v1/billing/payments`;
  - реализовать checkout/payment intent creation и хранение `provider_payment_id`;
  - реализовать `POST /api/v1/billing/payments/webhook` с signature verification;
  - сделать webhook processing идемпотентным и пригодным для reconciliation;
  - логировать payment lifecycle в `payments` и `subscription_events`.
- Критерий закрытия:
  - платежный lifecycle воспроизводим и безопасен;
  - webhook не дублирует бизнес-эффекты при повторной доставке;
  - provider integration не протекает в UI/доменный слой неструктурированными статусами.

**Что сделано**

- Не выполнено.
