# ABOUT ALL

> Единый обзор продукта, архитектуры, инфраструктуры и логики системы
> Основание: `DOCS/BUSINESS-REQUIREMENTS`, `DOCS/SYSTEM-ANALYTICS`, `DOCS/TASKS`
> Актуальность: после полной синхронизации модулей `01-20`

---

## 1. Что это за продукт

Это SaaS-платформа для продавцов на маркетплейсах. Система помогает:

- зарегистрировать и завести компанию в продукте;
- подключить кабинеты маркетплейсов;
- управлять единым каталогом товаров;
- вести остатки и складской reference layer;
- синхронизировать заказы, остатки и справочники;
- считать управленческую прибыльность и аналитику;
- управлять подпиской, ограничениями и доступом;
- работать с командой, аудитом, уведомлениями и support-контуром.

Продукт строится как **multi-tenant B2B система**, где одна учетная запись пользователя может иметь доступ к нескольким компаниям (`tenant`), а вся бизнес-логика работает строго в tenant-контексте.

---

## 2. Главная бизнес-идея

Система является **центром управления операциями продавца** между несколькими слоями:

- **публичный acquisition слой**: лендинг, лиды, демо, маркетинговая атрибуция;
- **identity/access слой**: auth, сессии, tenant membership, роли;
- **операционный слой**: catalog, inventory, orders, warehouses, marketplace accounts, sync;
- **управленческий слой**: finance, analytics, notifications, audit;
- **коммерческий слой**: billing, referrals, promo;
- **внутренний control plane**: worker, admin panel, support actions.

Система не является:

- полноценной ERP/WMS;
- бухгалтерией;
- CRM для конечных покупателей;
- enterprise BI-конструктором;
- публичной CMS-платформой.

---

## 3. Ключевые сущности системы

### Пользователь и доступ
- `user` — глобальный аккаунт пользователя.
- `tenant` — компания/рабочее пространство.
- `membership` — связь пользователя с tenant и ролью.
- Роли MVP в tenant: `OWNER`, `ADMIN`, `MANAGER`, `STAFF`.

### Интеграции и операции
- `marketplace_account` — подключение конкретного маркетплейса.
- `warehouse` — внешний reference-склад в scope marketplace account.
- `product` — master-карточка товара tenant.
- `order` — нормализованный заказ маркетплейса.
- `inventory balance/movement` — остатки и изменения остатков.
- `sync_run` — фоновый запуск синхронизации.

### Управленческие и сервисные сущности
- `finance_snapshot`, `analytics_snapshot`
- `notification_event`, `notification_dispatch`, `notification_inbox`
- `audit_log`, `security_event`
- `worker_job`
- `file`
- `subscription`, `payment`, `billing_usage_counter`
- `referral_attribution`, `bonus_wallet`, `promo_code`
- `landing_lead`, `registration_handoff`

---

## 4. Модульная карта продукта

### Identity и core access
1. `01-auth` — регистрация, verify email, login, sessions, password recovery, security hardening.
2. `02-tenant` — tenant lifecycle, access state, active tenant context, tenant isolation.
3. `03-team` — команда, роли, invite flow, membership lifecycle.
4. `04-onboarding` — user bootstrap и tenant activation onboarding.

### Core operations
5. `05-catalog` — master catalog, import preview/commit, mappings, soft delete/restore.
6. `06-inventory` — остатки, manual adjustments, reserve/release/deduct, low stock.
7. `07-warehouses` — внешний справочник складов, alias/labels, lifecycle reference layer.
8. `08-marketplace-accounts` — credentials, lifecycle account, validation, diagnostics.
9. `09-sync` — orchestration pull/push sync, runs, conflicts, retries.
10. `10-orders` — normalized orders, internal state machine, inventory side-effects.

### Management layer
11. `11-finance` — unit economics, cost profile, warnings, snapshots.
12. `12-analytics` — dashboard, revenue dynamics, ABC, recommendations.
13. `13-billing` — plans, subscription, payments, limits, access-state mapping.
14. `14-referrals` — referral attribution, promo, bonus wallet, anti-fraud.
15. `15-notifications` — in-app/email notifications, preferences, dedup/throttle.
16. `16-audit` — immutable audit trail, security events, redaction, RBAC.
17. `17-files-s3` — media upload, signed access, replace/cleanup lifecycle.
18. `18-worker` — background jobs, queues, retry, dead-letter, schedules.
19. `19-admin` — internal support/admin control plane.
20. `20-landing` — public landing, leads, CRM sync, legal/consent, registration handoff.

---

## 5. Главные архитектурные инварианты

Это самые важные правила всей системы.

### 5.1 Tenant isolation
- Любая бизнес-сущность живет в tenant scope.
- Tenant context должен браться только из trusted auth/session claims.
- Нельзя подменять tenant через query/body.
- Межтенантный доступ к данным, файлам, job metadata и audit запрещен.

### 5.2 Access state как единая политика
У tenant есть централизованное состояние доступа:

- `TRIAL_ACTIVE`
- `TRIAL_EXPIRED`
- `ACTIVE_PAID`
- `GRACE_PERIOD`
- `SUSPENDED`
- `CLOSED`

Именно это состояние определяет, какие действия разрешены в модулях.

Ключевое правило MVP:
- `TRIAL_EXPIRED` = сразу `read-only`
- `GRACE_PERIOD` = только для paid nonpayment, `3 дня`
- `SUSPENDED` = блокировка write и внешних runtime действий
- `CLOSED` = tenant закрыт, но может быть восстановлен в retention window

### 5.3 Никаких скрытых override
- Нельзя делать hidden support override для billing/policy.
- Admin-panel не должна обходить доменные сервисы.
- Worker не должен превращать `blocked by policy` в `failed`.

### 5.4 Source of truth разделен
- `catalog` — source of truth по master product.
- `orders` — source of truth по normalized order state.
- `inventory` — source of truth по управляемому stock контуру.
- `finance feeds` — source of truth по комиссиям/логистике.
- `billing provider` — source of truth по payment result.
- `landing` — source of truth по lead/marketing handoff на публичной стороне.

### 5.5 Асинхронность обязательна
Все тяжелые процессы вынесены из HTTP:

- sync
- notifications
- snapshot rebuild
- file cleanup
- billing reminders
- CRM retries

---

## 6. Архитектура приложения

Архитектурно система делится на несколько слоев.

### 6.1 Public layer
Публичный слой вне tenant-контекста:

- landing pages;
- pricing / faq / legal docs;
- lead forms;
- UTM/referral collection;
- registration handoff.

Этот слой не должен использовать tenant auth/session context.

### 6.2 Application/API layer
Основной backend API:

- auth endpoints;
- tenant/team/catalog/inventory/orders;
- finance/analytics/billing;
- audit/notifications;
- admin internal endpoints.

API возвращает read models и запускает async процессы, но не исполняет тяжелую работу прямо в запросе.

### 6.3 Domain layer
Доменные модули со своими правилами:

- catalog / inventory / orders / finance / billing / referrals / audit и т.д.

Support/admin и worker обязаны работать через эти контракты, а не мимо них.

### 6.4 Integration layer
Адаптеры внешних систем:

- marketplace APIs
- payment provider
- email provider
- CRM
- S3-compatible storage

### 6.5 Background execution layer
Worker + scheduler:

- очереди `critical`, `default`, `bulk`
- retry/backoff
- dead-letter
- schedule registry
- policy-aware preflight

### 6.6 Read-model / snapshot layer
Для управленческих экранов используются агрегаты и snapshots:

- finance snapshots
- analytics materialized daily
- tenant 360 summaries
- sync history
- audit read model

---

## 7. Инфраструктура системы

На уровне инфраструктуры система предполагает следующий стек.

### Обязательные компоненты
- **Frontend web app** — публичный слой + product cabinet + internal admin UI
- **Backend API** — основной прикладной контур
- **Worker process** — отдельный runtime для background jobs
- **PostgreSQL** — основная БД
- **Redis / queue broker** — очереди и scheduler orchestration
- **S3-compatible storage** — файлы и product images

### Внешние интеграции
- **Marketplace APIs** — Ozon / WB / Yandex Market
- **Payment provider** — биллинг и платежные webhook
- **Email provider** — auth, notifications, billing reminders
- **CRM** — лиды из лендинга

### Наблюдаемость
- application logs
- metrics / alerts
- dashboards по sync, worker, billing, audit, files, notifications

---

## 8. Как пользователь проходит систему

### 8.1 Публичный вход
1. Пользователь приходит на landing.
2. UTM/referral сохраняются.
3. Пользователь идет в `/register` или в lead/demo form.

### 8.2 Auth
1. Регистрация.
2. Подтверждение email.
3. Login.

В MVP login до verify запрещен полностью.

### 8.3 Tenant creation / onboarding
1. Пользователь может создать tenant.
2. Получает owner membership.
3. Входит в onboarding.
4. `setup_company` рекомендован, но не обязателен.

### 8.4 Подключение интеграций
1. Owner/Admin подключает marketplace account.
2. Проходит validation credentials.
3. Sync подтягивает склады, заказы, справочники.

### 8.5 Операционная работа
1. Ведется каталог.
2. Сопоставляются SKU и external items.
3. Orders приходят через sync.
4. Inventory получает reserve/release/deduct.
5. Finance и analytics читают snapshots.

### 8.6 Коммерческий цикл
1. Tenant живет на trial или paid plan.
2. Billing управляет access state и лимитами.
3. Referrals/promo влияют на acquisition и оплату, но по отдельным правилам.

---

## 9. Логика ключевых модулей

### Catalog
- master product на tenant;
- минимальный MVP: `name + sku`;
- soft delete без потери истории;
- новый товар с SKU от deleted товара возможен только через warning + confirm;
- manual duplicate merge разрешен.

### Inventory
- отрицательный остаток запрещен;
- channel lock/override не входят в MVP;
- FBS и FBO не смешиваются в одном управляемом stock контуре.

### Orders
- ingestion только через sync;
- duplicate/out-of-order события не создают повторный эффект;
- FBS critical states: `RESERVED / CANCELLED / FULFILLED`;
- returns только логируются, без auto-restock.

### Finance
- обязательное ядро расчета: `base_cost + marketplace fees + logistics`;
- `ads / tax / returns` optional, но при отсутствии строка `incomplete`;
- manual input только в product cost profile.

### Analytics
- dashboard только на agreed MVP-KPI;
- ABC по `revenue_net`;
- recommendations только `rule-based read-only`.

### Notifications
- MVP-каналы: `in-app + email`;
- digest не входит в MVP;
- mandatory `AUTH / BILLING / SYSTEM` alerts нельзя выключить полностью.

### Files
- доступ через `signed URL`;
- `single main image per product`;
- retention replaced/orphaned/deleted files = `7 дней`.

---

## 10. RBAC и внутренние роли

### Tenant-side roles
- `OWNER`
- `ADMIN`
- `MANAGER`
- `STAFF`

### Internal roles
- `SUPPORT_ADMIN`
- `SUPPORT_READONLY`

Ключевые правила:
- `SUPPORT_READONLY` не делает mutating actions;
- `SUPPORT_ADMIN` не видит plaintext credentials и не может impersonate user в MVP;
- billing override / special access в MVP запрещены.

---

## 11. Security модель

### Auth и sessions
- verify before login
- logout / logout-all
- reset password TTL = `24 часа`
- soft-lock: `5` неудачных попыток / `15 минут`
- CAPTCHA не используется

### Secrets и sensitive data
- marketplace credentials хранятся только encrypted
- audit не хранит password/token/apiKey/refreshToken/plain secrets
- files изолированы tenant-aware object keys

### Admin / support
- только через отдельный internal control plane
- все high-risk actions требуют `reason`
- все действия пишутся в audit

---

## 12. Асинхронные процессы

### Worker jobs
- `SYNC`
- `NOTIFICATION`
- `BILLING_REMINDER`
- `FILE_CLEANUP`
- `ANALYTICS_REBUILD`
- `AUDIT_MAINTENANCE`

### Поведение
- retries с backoff
- dead-letter
- recovery после рестарта
- replay только для `failed / dead_lettered` retryable jobs и только support/admin

---

## 13. Наблюдаемость и auditability

Система проектируется как расследуемая.

Это значит:
- у каждого критичного действия есть audit trail;
- у фоновых задач есть lifecycle и correlation;
- у sync есть run history, conflicts и blocked reasons;
- у billing есть subscription/payment events;
- у files есть lifecycle events;
- у leads есть CRM delivery status;
- у support действий есть отдельный internal trace.

---

## 14. Что не входит в MVP

Осознанно вынесено за пределы первой версии:

- multiple active marketplace accounts одного marketplace на tenant
- channel inventory overrides
- digest notifications
- свободное комбинирование promo + bonus
- support billing override / special access
- impersonation
- multi-image product gallery
- tenant full sync как обычная пользовательская функция
- task-management workflow поверх analytics recommendations
- cold storage / long-term archival для audit

---

## 15. Итоговая архитектурная картина

Это **tenant-aware SaaS платформа для продавцов маркетплейсов**, где:

- публичный маркетинговый вход отделен от продуктового кабинета;
- auth, tenant, team и onboarding создают безопасный access layer;
- catalog, inventory, orders, sync и marketplace accounts дают операционное ядро;
- finance, analytics, notifications и audit дают управленческий слой;
- billing управляет коммерческим доступом и лимитами;
- referrals и landing дают growth контур;
- worker и admin формируют внутреннюю платформу исполнения и поддержки;
- все тяжелые процессы асинхронны, все критичные действия расследуемы, а все ключевые ограничения задаются не UI, а централизованными policy и domain contracts.

---

## 16. Где смотреть детали

- Бизнес-требования: `DOCS/BUSINESS-REQUIREMENTS/*`
- Системная аналитика: `DOCS/SYSTEM-ANALYTICS/*/system-analytics.md`
- Декомпозиция реализации: `DOCS/TASKS/01-auth` ... `DOCS/TASKS/20-landing`

