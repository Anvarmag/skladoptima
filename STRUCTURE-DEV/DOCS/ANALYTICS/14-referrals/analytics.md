# Рефералы и промокоды — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Оценивать эффективность реферального канала и промокодов: атрибуция, конверсия в первую оплату, стоимость бонусов и антифрод-качество. Аналитика помогает управлять growth-механикой без потери юнит-экономики.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Referral Link Activation Rate | Переходы и регистрации по реферальным ссылкам | Рост WoW | `referral_registrations / referral_link_clicks` |
| Referral-to-First-Paid Conversion | Конверсия реферала в первую оплату | >= 20% | `referred_tenants_first_paid / referred_tenants_registered` |
| Bonus Cost Ratio | Доля бонусных начислений от привлеченной выручки | <= 25% | `total_bonus_credited / revenue_from_referred_first_payments` |
| Promo Redemption Rate | Использование промокодов | 10-30% | `promo_redeemed / promo_eligible_checkouts` |
| Fraud Block Effectiveness | Заблокированные self-referral/дубли | >= 99% | `blocked_fraud_cases / detected_fraud_cases` |
| Bonus Utilization Rate | Использование начисленного бонуса в оплате | >= 40% | `bonus_spent / bonus_credited` |

---

## 3. Воронки и конверсии

```
Referral link click -> Registration -> Tenant created -> First payment -> Bonus credited
100%                -> 35%          -> 30%           -> 20%          -> 20%
```

Воронка промокода:

```
Promo shown -> Promo entered -> Promo valid -> Payment success
100%        -> 45%          -> 38%         -> 34%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Активный реферер (Owner) | Часто делится ссылкой | Прозрачный статус приглашений и бонусов |
| Пассивный реферер | Имеет ссылку, но мало переходов | Подсказки по распространению/каналам |
| Новый реферал | Быстро проходит регистрацию/оплату | Понятная связь выгоды и активации |
| Promo-only пользователь | Использует промокод без реферальной связи | Понятные условия и срок действия |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `referral_link_generated` | Сгенерирована/показана ссылка | `owner_id`, `tenant_id` | Med |
| `referral_link_clicked` | Клик по реферальной ссылке | `channel`, `utm_source` | High |
| `referral_attributed` | Реферал атрибутирован | `referrer_id`, `new_tenant_id` | High |
| `referral_first_payment_success` | Первая оплата реферала успешна | `payment_amount`, `plan` | High |
| `referral_bonus_credited` | Начислен бонус рефереру | `bonus_amount`, `credit_reason` | High |
| `referral_bonus_spent` | Бонус использован в оплате | `spent_amount`, `tenant_id` | High |
| `referral_self_referral_blocked` | Заблокирован self-referral | `actor_id`, `rule_id` | High |
| `promo_applied` | Промокод применен | `promo_code`, `discount_type`, `discount_value` | High |
| `promo_rejected` | Промокод отклонен | `promo_code`, `reject_reason` | High |

---

## 6. Текущее состояние (baseline)

- Модуль отсутствует в текущей реализации, baseline будет собран после запуска referral/promo flow.
- Критичные baseline-данные: CAC через реферал, бонусная нагрузка, доля fraud-block кейсов.
- Нужно разделить baseline по источникам трафика (UTM) для оценки quality referral-каналов.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Публичный блок «как работает бонус» повысит конверсию в share ссылки | `Referral Link Activation Rate` | Идея |
| Ограниченные по времени промокоды повысят completion checkout | `Promo Redemption Rate` | Идея |
| Индикатор “ожидаемый бонус” до оплаты увеличит доведение реферала до first paid | `Referral-to-First-Paid Conversion` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Referral Funnel: click -> registration -> paid -> bonus.
- [ ] Bonus Ledger: начисления, списания, остатки по owner.
- [ ] Promo Performance: применимость, отказы, выручка после скидок.
- [ ] Fraud Monitor: self-referral и дубли атрибуции.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Резкий рост self-referral попыток | `> 2% referral-attempts` | Усилить anti-fraud правила и verification |
| Высокая стоимость бонусов | `Bonus Cost Ratio > 35%` | Пересмотреть бонусные параметры |
| Низкая конверсия реферала в оплату | `< 12%` | Проверить onboarding и paywall для referral cohort |
| Высокий reject по промокодам | `> 20% вводов` | Улучшить UX правил и валидаторы формы |

---

## 11. Источники данных и правила расчета

- Источники: referral attribution records, first payment events, wallet/bonus transactions, promo redemptions.
- Referral funnel строится по `referred_tenant_id`, а не только по `referred_user_id`, потому что reward привязан к tenant оплате.
- Bonus cost ratio считается только на оплаченных рефералах, где reward реально начислен.
- Promo redemption нужно считать отдельно для first-payment и retention-сценариев.

---

## 12. Data Quality и QA-проверки

- Один referred tenant не может иметь более одного reward-credit события.
- Self-referral блок должен отрабатывать до начисления и до отображения “ожидаемого бонуса”.
- QA должна проверить: attribution, first-payment trigger, duplicate webhook, wallet debit, expired promo, maxUses promo.
- В кошельке owner сумма credit/debit должна всегда сходиться с текущим balance.

---

## 13. Владельцы метрик и ритм ревью

- Growth/Product owner: referral activation и promo performance.
- Backend lead: attribution consistency, idempotent rewarding, anti-fraud.
- Finance/Data owner: bonus cost ratio и discount impact.
- QA: referral/promo regression на checkout и billing webhook flows.

---

## 14. Зависимости, допущения и границы

- Атрибуция реферала должна фиксироваться один раз и хранить источник/окно атрибуции, иначе история кампаний станет нерепродуцируемой.
- Reward считается только после подтвержденной первой оплаты по правилам billing, а не после создания tenant или старта trial.
- Промокоды и referral-benefits нельзя безоговорочно суммировать без явно описанных stack-rules и ограничений.
- Anti-fraud правила должны покрывать self-referral, мультиаккаунты, повторное использование бонуса и аномальные паттерны трафика.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
