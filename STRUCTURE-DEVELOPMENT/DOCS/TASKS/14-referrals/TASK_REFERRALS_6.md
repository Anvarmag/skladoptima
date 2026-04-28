# TASK_REFERRALS_6 — Frontend Referral Center, Promo UX и Bonus Visibility

> Модуль: `14-referrals`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_REFERRALS_1`
  - `TASK_REFERRALS_2`
  - `TASK_REFERRALS_3`
  - `TASK_REFERRALS_4`
  - `TASK_REFERRALS_5`
- Что нужно сделать:
  - собрать referral center с персональной ссылкой, stats и bonus history;
  - показать пользователю, что reward начисляется только после первой успешной оплаты приглашенного tenant;
  - реализовать promo input UX с preview и explainable reject reasons;
  - заранее объяснять stack rule `promo vs bonus`;
  - показать прозрачную историю бонусных начислений и списаний.
- Критерий закрытия:
  - growth UX объясняет правила, а не только показывает ссылку и баланс;
  - promo/reward ограничения читаются без двусмысленности;
  - UI соответствует bonus ledger и stack policy.

**Что сделано**

Создан frontend Referral Center (`apps/web/src/pages/ReferralCenter.tsx`) — полная страница реферальной программы для владельца аккаунта.

**Реализовано:**

1. **Реферальная ссылка** — персональная ссылка `/register?ref=CODE` с кнопкой «Копировать» (clipboard API + fallback). Отображает код приглашения и полный URL.

2. **Воронка статистики** — 4 карточки: Зарегистрировались / Оплатили / Бонус начислен / Отклонено. Данные из `GET /referrals/status`.

3. **Блок «Как работает»** — growth UX объясняет правила без двусмысленности:
   - бонус только после первой успешной оплаты, регистрация не считается;
   - по каждому приглашённому — один раз;
   - атрибуция фиксируется на момент создания аккаунта;
   - self-referral заблокирован;
   - promo и bonus не совмещаются (stack rule MVP).

4. **Бонусный баланс и история** — текущий баланс из `GET /referrals/bonus-balance`, cursor-based пагинация истории из `GET /referrals/bonus-transactions`. Иконки ↑ (CREDIT, зелёный) / ↓ (DEBIT, красный). Читаемые метки reasonCode.

5. **Promo-валидатор** — инпут с debounce 600 мс, вызывает `POST /promos/validate`. Показывает:
   - превью скидки (% или фиксированная сумма) при valid=true;
   - понятное сообщение об ошибке для каждого conflictCode (7 кейсов);
   - предупреждение о stackPolicy=EXCLUSIVE прямо в превью.
   - нижняя подсказка о правиле совместимости всегда видна.

6. **Права доступа** — страница доступна только для роли OWNER. Non-owner видит заглушку. Навигационный пункт «Рефералы» (Gift-иконка) тоже появляется только у Owner — в desktop sidebar и мобильной нижней панели.

7. **Маршрутизация** — добавлен маршрут `/app/referrals` в `App.tsx`, импорт `ReferralCenter`.
