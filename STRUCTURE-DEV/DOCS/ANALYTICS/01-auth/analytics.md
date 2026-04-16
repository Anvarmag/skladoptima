# Авторизация — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Понять, насколько стабильно и безопасно пользователи проходят путь от регистрации до первого входа в рабочий tenant. Метрики раздела используются для решений по UX auth-flow, anti-abuse защите, политике сессий и качеству онбординга пользователя без компании.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Registration Success Rate | Доля успешных регистраций | >= 92% | `successful_registrations / registration_attempts` |
| Email Verification Rate 24h | Доля пользователей, подтвердивших email в 24 часа | >= 75% | `verified_within_24h / new_registrations` |
| Login Success Rate | Доля успешных логинов | >= 95% | `successful_logins / login_attempts` |
| Password Reset Completion Rate | Завершение восстановления пароля | >= 70% | `password_reset_completed / password_reset_requested` |
| Users Without Tenant After 24h | Пользователи без membership спустя 24 часа | <= 20% | `users_without_tenant_24h / verified_new_users` |
| Session Revoke SLA | Скорость инвалидирования сессий после смены пароля | <= 60 сек p95 | `p95(time_revoke_done - password_changed_at)` |

---

## 3. Воронки и конверсии

```
Регистрация -> Подтверждение email -> Логин -> Выбор/создание tenant -> Первая активность
100%        -> 75%                -> 70%   -> 62%                  -> 55%
```

Дополнительно контролируется воронка восстановления пароля:

```
Запрос reset -> Переход по ссылке -> Новый пароль сохранен -> Успешный вход
100%         -> 80%               -> 72%                   -> 68%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Новый пользователь | Много ошибок валидации, высокий churn до verify | Ясный onboarding и повторная отправка verify |
| Пользователь без tenant | Входит, но не создает компанию | Быстрые CTA на создание/принятие инвайта |
| Мульти-tenant пользователь | Часто переключает компанию | Надежная логика `last used tenant` |
| Риск anti-abuse | Частые retry login/reset | Rate-limit и сигнализация security |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `auth_register_submitted` | Отправлена форма регистрации | `email_domain`, `has_phone`, `tenant_context` | High |
| `auth_register_succeeded` | Аккаунт создан | `user_id`, `verification_required=true` | High |
| `auth_email_verification_sent` | Отправлено verification письмо | `reason`, `resend_count` | High |
| `auth_email_verified` | Email подтвержден | `verification_latency_sec` | High |
| `auth_login_attempted` | Попытка входа | `channel=local`, `has_verified_email` | High |
| `auth_login_failed` | Ошибка входа | `reason_code`, `rate_limited` | High |
| `auth_login_succeeded` | Успешный вход | `tenants_count`, `selected_tenant` | High |
| `auth_password_reset_requested` | Запрошен reset | `source` | Med |
| `auth_password_reset_completed` | Пароль обновлен | `sessions_revoked_count` | High |
| `auth_company_selected` | Выбрана компания после login | `selection_mode=last_used/manual` | Med |

---

## 6. Текущее состояние (baseline)

- На 2026-04-15 нет единого продуктового auth-дашборда; baseline формируется с нуля.
- Целевой период первичного baseline: первые 14 дней после запуска событий.
- Отдельно требуется baseline по ошибкам: `invalid_credentials`, `email_not_verified`, `verification_link_expired`.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Кнопка `Resend verification` с таймером 60 секунд повысит verify | `Email Verification Rate 24h` | Идея |
| Автоподстановка email в login после verify снизит drop на входе | `Login Success Rate` | Идея |
| Экран выбора tenant с последней активной компанией по умолчанию сократит time-to-first-action | `time_to_first_action_after_login` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Auth Health: регистрации, verify, login success/fail, reset flow.
- [ ] Security Panel: rate-limit, brute-force паттерны, массовые failed login.
- [ ] Tenant Entry Report: распределение `no tenant / single tenant / multi tenant`.
- [ ] Session Control Report: revoke после смены пароля, активные сессии по пользователю.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Резкое падение verification | `< 55% за сутки` | Проверить доставляемость email, токены и TTL ссылок |
| Рост failed login | `> 20% от попыток за 1ч` | Включить повышенный anti-abuse режим и алерт support |
| Рост reset without completion | `> 40% незавершенных reset` | Проверить UX reset и срок жизни ссылок |
| Медленная инвалидация сессий | `p95 > 60 сек` | Проверить механизм revoke и очереди auth-событий |

---

## 11. Источники данных и правила расчета

- Основной источник: события auth-flow (`register`, `verify`, `login`, `reset`, `session revoke`).
- Источник identity-правды: таблицы `users`, `auth_sessions`, `email_verification_tokens`, `password_reset_tokens`.
- Для расчета `Users Without Tenant After 24h` нужен join с membership/tenant слоем, а не только auth-события.
- Failed login и anti-abuse метрики должны агрегироваться по `email`, `ip`, `device fingerprint`, чтобы видеть brute-force, а не только общую долю ошибок.

---

## 12. Data Quality и QA-проверки

- У каждого auth-события должны быть `user_id` или анонимный correlation id, `timestamp`, `source_ip`, `request_id`.
- `auth_login_succeeded` не должен отправляться, если JWT не выдан или сессия не создана.
- Количество `auth_email_verified` не может превышать количество `auth_register_succeeded` на когорте.
- QA должна отдельно проверить сценарии: expired token, reused token, already verified, rate-limited resend, revoke after password change.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: conversion register -> verify -> login.
- Backend lead: session revoke SLA, auth error taxonomy, rate limiting.
- QA: regression pack на register/login/reset/verify.
- Data review: ежедневно для auth health, еженедельно для conversion trends и anti-abuse patterns.

---

## 14. Зависимости, допущения и границы

- Auth-аналитика обязана различать анонимный pre-auth этап и действия уже идентифицированного пользователя.
- Метрики безопасности и метрики продуктовой конверсии нельзя смешивать в один итоговый коэффициент без раздельной интерпретации.
- Внешние identity-провайдеры, social login или SSO, если появятся позже, должны быть выделены в отдельные cohort/каналы.
- Любой успешный login должен опираться на реально созданную сессию и валидный lifecycle токенов, а не только на фронтовый callback.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
