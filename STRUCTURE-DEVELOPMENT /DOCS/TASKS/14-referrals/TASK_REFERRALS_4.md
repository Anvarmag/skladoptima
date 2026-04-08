# TASK_REFERRALS_4 — Promo Validation/Apply и Stack Rules

> Модуль: `14-referrals`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_REFERRALS_2`
  - `TASK_REFERRALS_3`
  - согласован `13-billing`
- Что нужно сделать:
  - завести `promo_codes` и правила их применимости;
  - реализовать `POST /api/v1/promos/validate` и `POST /api/v1/promos/apply`;
  - валидировать `is_active`, `expires_at`, `used_count < max_uses`, applicable plans;
  - закрепить MVP stack rule: `promo` и `bonus` взаимно исключаемы;
  - возвращать понятный conflict при `PROMO_BONUS_STACK_NOT_ALLOWED`.
- Критерий закрытия:
  - promo validation/apply работает предсказуемо и быстро;
  - promo и bonus не комбинируются в обход коммерческих правил;
  - checkout получает прозрачный discount preview и причину отказа.

**Что сделано**

- Не выполнено.
