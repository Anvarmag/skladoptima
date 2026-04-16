# Подключения маркетплейсов — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Оценивать скорость активации интеграций, стабильность статусов `connected / invalid_credentials / needs_reconnect / sync_error / inactive` и влияние качества подключений на downstream sync. Цель — минимизировать downtime каналов и ускорить восстановление проблемных account.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Account Connection Success Rate | Успешность первого подключения account | >= 85% | `first_try_connected / first_try_connection_attempts` |
| Time to Connected | Время от создания до `connected` | <= 30 мин p50 | `median(connected_at - account_create_started_at)` |
| Reconnect Recovery Rate | Доля `needs_reconnect`, восстановленных в 24ч | >= 70% | `reconnected_24h / needs_reconnect_accounts` |
| Invalid Credentials Share | Доля account в `invalid_credentials` | <= 8% | `invalid_credentials_accounts / active_accounts` |
| Account Availability | Доля account в рабочем состоянии | >= 95% | `connected_accounts / active_accounts` |

---

## 3. Воронки и конверсии

```
Создание account -> Валидация credentials -> Статус connected -> Первый успешный sync
100%             -> 88%                   -> 80%              -> 72%
```

Воронка восстановления:

```
needs_reconnect -> credentials updated -> revalidation success -> connected
100%            -> 78%                 -> 72%                 -> 70%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Primary Owner | Создает и переключает подключения | Быстрый setup и диагностичные ошибки |
| Admin | Операционно поддерживает статусы | Ручная перепроверка и журнал изменений |
| Manager | Только смотрит статус | Прозрачные индикаторы здоровья канала |
| Multi-account tenant | Несколько аккаунтов одного MP | Ясные label и изоляция ошибок по account |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `mp_account_create_started` | Начато подключение | `marketplace`, `actor_role` | High |
| `mp_account_created` | Account сохранен | `marketplace`, `label`, `is_active` | High |
| `mp_account_validation_failed` | Валидация неуспешна | `marketplace`, `error_code` | High |
| `mp_account_connected` | Статус перешел в connected | `marketplace`, `time_to_connect_sec` | High |
| `mp_account_revalidation_requested` | Запрошена ручная перепроверка | `account_id`, `actor_role` | Med |
| `mp_account_status_changed` | Изменен статус account | `from_status`, `to_status`, `reason` | High |
| `mp_account_credentials_rotated` | Обновлены credentials | `marketplace`, `rotation_reason` | High |
| `mp_account_deactivated` | Подключение отключено | `account_id`, `reason` | High |
| `mp_account_sync_error_detected` | Связанный sync error | `account_id`, `error_code` | High |

---

## 6. Текущее состояние (baseline)

- Подключения уже используются, но baseline по `time_to_connected` и recovery не формализован.
- Требуется первичный baseline по каждому маркетплейсу отдельно (WB/Ozon/Я.Маркет).
- Важен baseline по доле account с `sync_error` несмотря на валидные credentials.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Контекстные подсказки по полям credentials повысят first-try success | `Account Connection Success Rate` | Идея |
| Авто-пинг после сохранения сократит время до `connected` | `Time to Connected` | Идея |
| Серия in-app+email напоминаний ускорит recovery из `needs_reconnect` | `Reconnect Recovery Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Integration Health: статус всех account, last validated, last sync.
- [ ] Connection Funnel: create -> validate -> connected.
- [ ] Error Diagnostics: invalid_credentials vs sync_error по MP.
- [ ] Recovery Report: скорость переподключения и downtime account.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост `invalid_credentials` | `> 12% active accounts` | Проверить UX, API требования, обновление токенов |
| Низкий first-try connection success | `< 70%` | Пересмотреть setup flow и валидации на форме |
| Длительный `needs_reconnect` | `> 24ч для 30% account` | Авто-эскалация owner/admin через уведомления |
| Ошибка одного account влияет на другие | Любой случай | Инцидент: нарушение изоляции каналов |

---

## 11. Источники данных и правила расчета

- Источник: `marketplace_accounts`, validation events, sync health events, reconnect actions.
- `Account Availability` считается только по `is_active=true` account.
- `Time to Connected` считается от первого create-attempt, а не от последнего credentials update.
- Ошибки валидации и ошибки sync должны храниться раздельно, иначе diagnostics теряет точность.

---

## 12. Data Quality и QA-проверки

- Статус account должен меняться только по разрешенной lifecycle логике.
- Секреты не должны попадать в analytics payload или фронтовые event-параметры.
- QA должна проверить create/update/validate/deactivate/reactivate, несколько account одного marketplace, masked secrets.
- `connected_accounts` не может превышать `active_accounts`.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: activation и recovery качества интеграций.
- Integration lead: validation errors, reconnect lag, isolation of account failures.
- QA: create/rotate/deactivate regression.
- Data review: ежедневно по проблемным account, еженедельно по connection funnel.

---

## 14. Зависимости, допущения и границы

- Учетная запись маркетплейса является доменной интеграционной сущностью, а не просто набором секретов.
- Процесс `created -> validating -> connected/failed -> disconnected` должен быть явным жизненным циклом, иначе support и аналитика теряют прозрачность.
- Проверка credentials и фактическая рабочая синхронизация должны оцениваться как разные уровни здоровья account.
- Секреты, токены и чувствительные ошибки никогда не должны попадать в аналитические payload или пользовательские отчеты.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
