# Уведомления — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять своевременность и надежность доставки уведомлений по критичным событиям (auth, billing, sync, inventory, referral), а также баланс между информированием и антиспам-режимом. Данные используются для SLA каналов и настройки политик delivery.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Delivery Success Rate | Успешная доставка по всем каналам | >= 97% | `delivered_notifications / send_attempts` |
| Critical Notification Latency | Время доставки критичных instant-уведомлений | <= 60 сек p95 | `p95(delivered_at - event_occurred_at)` |
| Dedup Effectiveness | Эффективность дедупликации повторов | >= 90% | `suppressed_duplicates / duplicate_candidates` |
| Digest Engagement Rate | Открытие daily digest уведомлений | >= 35% | `digest_opened / digest_delivered` |
| Channel Misconfig Rate | Ошибки из-за неверной настройки канала | <= 5% | `failed_due_to_channel_config / send_attempts` |
| Alert-to-Action Rate | Доля уведомлений, после которых выполнено целевое действие | >= 30% | `notifications_with_followup_action / delivered_notifications` |

---

## 3. Воронки и конверсии

```
Business event -> Notification queued -> Sent -> Delivered -> User action
100%           -> 99%                -> 98%  -> 97%       -> 30%
```

Отдельная воронка критичных sync/billing alerts:

```
Critical alert delivered -> Alert viewed -> Corrective action done
100%                     -> 65%          -> 42%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Primary Owner | Чувствителен к billing/sync рискам | Надежный multi-channel и понятные CTA |
| Admin/Manager | Операционный фокус (sync, low stock) | Быстрые actionable alerts |
| Staff | Ограниченный набор адресных уведомлений | Минимум шума, только релевантное |
| Tenant с внешними каналами (TG/Max) | Риск misconfiguration | Пошаговая настройка и health-check канала |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `notification_event_created` | Сформировано событие уведомления | `category`, `severity`, `tenant_id` | High |
| `notification_queued` | Сообщение поставлено в очередь | `channel`, `delivery_policy` | High |
| `notification_sent` | Канал принял отправку | `provider`, `channel` | High |
| `notification_delivered` | Подтверждена доставка | `channel`, `latency_sec` | High |
| `notification_failed` | Ошибка отправки/доставки | `channel`, `error_code` | High |
| `notification_deduplicated` | Уведомление подавлено как дубль | `dedup_window`, `signature` | High |
| `notification_digest_generated` | Сформирована сводка digest | `digest_type`, `items_count` | Med |
| `notification_preference_updated` | Обновлены настройки уведомлений | `actor_role`, `changed_categories` | Med |
| `notification_channel_config_warning` | Проблема настройки Telegram/Max | `channel`, `warning_type` | High |

---

## 6. Текущее состояние (baseline)

- Модуль как полноценный слой уведомлений еще не внедрен; baseline будет нулевым на момент запуска.
- Сразу после запуска требуется baseline по instant latency и delivery success отдельно для email/in-app/TG/Max.
- Для антиспам-правил нужен baseline по количеству подавленных дублей и false-positive dedup.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Шаблоны с четким CTA увеличат Alert-to-Action по sync/billing | `Alert-to-Action Rate` | Идея |
| Объединение низкоприоритетных alert в digest снизит раздражение без потери действий | `unsubscribe_or_disable_notifications_rate` | Идея |
| In-app + email дублирование только для critical снизит missed incidents | `critical_incident_missed_rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Notification Delivery SLA: success/fail/latency по каналам.
- [ ] Critical Alerts Monitor: billing/sync/stock критичные события.
- [ ] Dedup & Spam Control: подавленные дубли и точность правил.
- [ ] Preferences & Channel Health: активность и ошибки конфигурации каналов.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение delivery success | `< 94%` | Проверка провайдера и retry-цепочки |
| Рост latency критичных alert | `p95 > 120 сек` | Проверка worker очередей и channel provider |
| Слишком много дублей пользователю | `> 3 одинаковых alert/час` | Усилить dedup/throttle |
| Массовые channel misconfig errors | `> 10% tenant` | Улучшить setup-инструкции и preflight checks |

---

## 11. Источники данных и правила расчета

- Источники: notification events, dispatch logs, provider delivery callbacks, inbox read events, channel config status.
- Delivery success считается по каналу, не по бизнес-событию: один event может дать несколько dispatch записей.
- Alert-to-action нужно считать по типу алерта и привязанному follow-up событию, иначе метрика неинтерпретируема.
- Dedup effectiveness должен учитывать false suppressions, а не только количество подавленных дублей.

---

## 12. Data Quality и QA-проверки

- Каждая dispatch запись обязана иметь `event_id`, `channel`, `policy`, `status`, `attempt`.
- QA должна проверить instant, digest, scheduled, throttled scenarios; provider temporary failure; channel misconfiguration; in-app read flow.
- Сумма `delivered + failed + skipped` должна совпадать с количеством созданных dispatch для закрытых batch/jobs.
- In-app уведомление не должно считаться delivered до появления в inbox пользователя.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: user-facing alert usefulness и spam balance.
- Backend/Platform lead: dispatch SLA, retries, provider health.
- QA: multi-channel regression и misconfiguration scenarios.
- Data review: ежедневно по critical channels, еженедельно по digest engagement и dedup quality.

---

## 14. Зависимости, допущения и границы

- Один бизнес-event может породить несколько уведомлений по каналам, поэтому аналитика должна разделять `event`, `dispatch` и `delivery`.
- Каналы с внешним подтверждением доставки и каналы без него нельзя сравнивать одной метрикой без нормализации статусов.
- Пользовательские preferences и системные mandatory-alert правила должны храниться отдельно, чтобы критичные уведомления не терялись из-за opt-out.
- Digest-метрики должны считаться по сформированным пакетам, а не по отдельным элементам внутри digest.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
