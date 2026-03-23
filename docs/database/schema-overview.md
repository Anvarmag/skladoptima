# SkladOptima — Схема базы данных (Database Schema Overview)

> **Версия:** v1.0  
> **Статус:** Draft  
> **PostgreSQL** — основная СУБД

---

## Содержание

1. [Принципы проектирования](#принципы-проектирования)
2. [Группы таблиц](#группы-таблиц)
3. [Identity & Tenant](#1-identity--tenant)
4. [Attribution & Referral](#2-attribution--referral)
5. [Access & Billing](#3-access--billing)
6. [Marketplace](#4-marketplace)
7. [Catalog & Inventory](#5-catalog--inventory)
8. [Finance](#6-finance)
9. [Audit & Security](#7-audit--security)
10. [Связи между таблицами (ERD)](#связи-между-таблицами)
11. [Что мы не забыли учесть](#что-мы-не-забыли-учесть)

---

## Принципы проектирования

- **User ≠ Tenant.** Физический пользователь и аккаунт компании — разные сущности.
- **Роль ≠ Доступ.** `role` (OWNER/MANAGER/STAFF) и `access_state` (trial/paid/suspended) хранятся отдельно.
- **Подписка принадлежит Tenant**, а не конкретному пользователю.
- **Tenant isolation** — каждая бизнес-сущность содержит `tenant_id`.
- **Soft delete** — удаление через `deleted_at`, а не физическое удаление строк.
- **UUID v4** для всех первичных ключей (`id UUID DEFAULT gen_random_uuid()`).
- **Временны́е метки** всегда в UTC, тип `TIMESTAMPTZ`.
- **API-ключи маркетплейсов** хранятся в зашифрованном виде (application-level encryption), никогда в plain text.

---

## Группы таблиц

| Группа | Таблицы |
|---|---|
| Identity / Tenant | `users`, `tenants`, `memberships`, `invitations` |
| Attribution / Referral | `registration_attributions`, `referral_links`, `referral_rewards` |
| Access / Billing | `access_grants`, `tariff_plans`, `subscriptions`, `promo_codes`, `promo_redemptions`, `bonus_wallet`, `bonus_transactions`, `waitlist_entries` |
| Marketplace | `marketplace_accounts`, `marketplace_warehouses`, `marketplace_credentials`, `marketplace_sync_runs` |
| Catalog / Inventory | `products`, `skus`, `warehouses`, `stock_balances`, `stock_movements`, `stock_adjustment_reasons` |
| Finance | `product_finance_profiles`, `product_profit_snapshots` |
| Audit / Security | `audit_logs`, `security_events`, `support_cases`, `store_reassignment_requests` |

---

## 1. Identity & Tenant

### `users` — Пользователи

Физические люди, которые регистрируются в системе. Один пользователь может быть членом нескольких тенантов.

```sql
users
├── id                     UUID PK
├── email                  VARCHAR(255) UNIQUE NOT NULL
├── phone                  VARCHAR(30) UNIQUE              -- необязательное, но уникальное если заполнено
├── first_name             VARCHAR(100)
├── last_name              VARCHAR(100)
├── password_hash          VARCHAR(255) NOT NULL           -- bcrypt/argon2, никогда plain text
├── status                 ENUM('active', 'blocked', 'deleted') DEFAULT 'active'
├── email_verified_at      TIMESTAMPTZ                     -- NULL = не подтвержден
├── last_login_at          TIMESTAMPTZ
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── deleted_at             TIMESTAMPTZ                     -- soft delete
```

**Индексы:**
- `UNIQUE (email)` — уникальность email
- `INDEX (phone)` — поиск по телефону
- `INDEX (status)` — фильтрация по статусу
- `INDEX (created_at)` — сортировка

**Зачем отдельно от Tenant?**  
Пользователь может управлять несколькими компаниями (Tenant) или быть сотрудником чужой. Физический человек — одна запись.

---

### `tenants` — Аккаунты компаний (рабочие пространства)

Tenant — это компания / рабочее пространство в SaaS. Подписка, данные, лимиты — всё принадлежит Tenant.

```sql
tenants
├── id                     UUID PK
├── name                   VARCHAR(255) NOT NULL           -- название компании
├── slug                   VARCHAR(100) UNIQUE NOT NULL    -- URL-friendly уникальный идентификатор
├── status                 ENUM('active', 'suspended', 'closed') DEFAULT 'active'
├── access_state           ENUM(
│                              'early_access',
│                              'trial_active',
│                              'trial_expired',
│                              'active_paid',
│                              'grace_period',
│                              'suspended',
│                              'closed'
│                          ) DEFAULT 'trial_active'
├── trial_started_at       TIMESTAMPTZ
├── trial_ends_at          TIMESTAMPTZ
├── owner_user_id          UUID FK → users.id             -- создатель/владелец тенанта
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── deleted_at             TIMESTAMPTZ
```

**Индексы:**
- `UNIQUE (slug)`
- `INDEX (status, access_state)`
- `INDEX (owner_user_id)`

> **Важно:** `access_state` на Tenant — это коммерческий статус. Роль пользователя внутри тенанта — это `memberships.role`. Это **две разные оси**.

---

### `memberships` — Роли пользователей внутри тенантов

Связывает пользователей с тенантами и задаёт их роль.

```sql
memberships
├── id                     UUID PK
├── user_id                UUID FK → users.id NOT NULL
├── tenant_id              UUID FK → tenants.id NOT NULL
├── role                   ENUM('owner', 'manager', 'staff') NOT NULL
├── status                 ENUM('active', 'suspended', 'left') DEFAULT 'active'
├── invited_by_user_id     UUID FK → users.id              -- кто пригласил
├── joined_at              TIMESTAMPTZ DEFAULT NOW()
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Индексы:**
- `UNIQUE (user_id, tenant_id)` — один пользователь = одна роль в одном тенанте
- `INDEX (tenant_id, role)`
- `INDEX (user_id)`

**Роли:**
| Роль | Возможности |
|---|---|
| `owner` | Полный доступ, управление подпиской, удаление тенанта |
| `manager` | Управление товарами, складами, синхронизацией |
| `staff` | Просмотр и базовые операции |

---

### `invitations` — Приглашения сотрудников

```sql
invitations
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── invited_by_user_id     UUID FK → users.id NOT NULL
├── email                  VARCHAR(255) NOT NULL           -- куда отправлено приглашение
├── role                   ENUM('manager', 'staff') NOT NULL
├── token                  VARCHAR(128) UNIQUE NOT NULL    -- одноразовый токен
├── status                 ENUM('pending', 'accepted', 'expired', 'cancelled') DEFAULT 'pending'
├── expires_at             TIMESTAMPTZ NOT NULL
├── accepted_at            TIMESTAMPTZ
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## 2. Attribution & Referral

### `registration_attributions` — Атрибуция регистрации

Фиксирует UTM, IP, гео и реферальный контекст при регистрации.

```sql
registration_attributions
├── id                     UUID PK
├── user_id                UUID FK → users.id UNIQUE NOT NULL   -- одна запись на пользователя
├── referrer_url           TEXT                            -- URL страницы, с которой пришёл
├── utm_source             VARCHAR(255)
├── utm_medium             VARCHAR(255)
├── utm_campaign           VARCHAR(255)
├── utm_term               VARCHAR(255)
├── utm_content            VARCHAR(255)
├── registration_ip        INET                            -- IP при регистрации
├── registration_country   VARCHAR(100)                   -- определяется по IP (MaxMind/ip-api)
├── registration_region    VARCHAR(100)
├── registration_city      VARCHAR(100)
├── referral_code_used     VARCHAR(100)                   -- реферальный код, если был
├── promo_code_used        VARCHAR(100)                   -- промокод, если был
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Почему отдельная таблица?**  
Атрибуция пишется один раз при регистрации и никогда не меняется. Хранить всё это в `users` — замусоривает основную таблицу.

---

### `referral_links` — Реферальные ссылки

Каждый пользователь может иметь свою реферальную ссылку.

```sql
referral_links
├── id                     UUID PK
├── user_id                UUID FK → users.id NOT NULL
├── tenant_id              UUID FK → tenants.id              -- к какому тенанту привязана
├── code                   VARCHAR(50) UNIQUE NOT NULL     -- уникальный код ссылки (напр. "IVAN2024")
├── url                    TEXT NOT NULL                   -- полная ссылка с кодом
├── click_count            INTEGER DEFAULT 0
├── registration_count     INTEGER DEFAULT 0
├── is_active              BOOLEAN DEFAULT TRUE
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор реферальной ссылки.
- `user_id` — кому принадлежит ссылка. Каждый пользователь может иметь свою персональную ссылку.
- `tenant_id` — к какому тенанту привязана ссылка. Нужен для корректного начисления бонусов и отслеживания конверсий в рамках конкретного аккаунта.
- `code` — уникальный короткий код, встраиваемый в URL (например, `IVAN2024`). Именно по нему система определяет, с чьей ссылки пришёл новый пользователь.
- `url` — полная ссылка вида `https://skladoptima.ru/?ref=IVAN2024`. Формируется автоматически. Это то, что пользователь копирует и распространяет.
- `click_count` — счётчик кликов по ссылке. Обновляется при каждом переходе. Полезен для оценки охвата канала.
- `registration_count` — сколько новых пользователей зарегистрировалось через эту ссылку. Ключевая метрика эффективности реферала.
- `is_active` — можно деактивировать ссылку без удаления (например, при блокировке пользователя).
- `created_at` — дата создания ссылки.
- `updated_at` — дата последнего изменения (например, деактивации).

---

### `referral_rewards` — Реферальные вознаграждения

```sql
referral_rewards
├── id                     UUID PK
├── referral_link_id       UUID FK → referral_links.id NOT NULL
├── referrer_user_id       UUID FK → users.id NOT NULL     -- кто пригласил
├── referred_user_id       UUID FK → users.id NOT NULL     -- кого пригласили
├── referred_tenant_id     UUID FK → tenants.id
├── reward_type            ENUM('bonus_days', 'bonus_credits', 'cash_discount')
├── reward_value           DECIMAL(10,2)
├── status                 ENUM('pending', 'credited', 'cancelled') DEFAULT 'pending'
├── triggered_at           TIMESTAMPTZ                     -- когда сработало (напр. после оплаты)
├── credited_at            TIMESTAMPTZ
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор вознаграждения.
- `referral_link_id` — ссылка на реферальную ссылку, по которой был совершён переход. Позволяет понять, через какой канал пришёл пользователь.
- `referrer_user_id` — тот, кто пригласил (кому начисляется бонус).
- `referred_user_id` — тот, кого пригласили (новый пользователь).
- `referred_tenant_id` — тенант нового пользователя. Нужен для проверки, что новый аккаунт действительно активен и дошёл до нужного события.
- `reward_type` — тип вознаграждения: `bonus_days` — бесплатные дни к подписке; `bonus_credits` — внутренние кредиты; `cash_discount` — скидка на оплату.
- `reward_value` — числовое значение бонуса (например, `14` дней или `500` рублей).
- `status` — `pending` (ещё не выдано, ждём события), `credited` (начислено), `cancelled` (отменено, например при возврате оплаты нового пользователя).
- `triggered_at` — момент, когда сработало условие выдачи (например, дата первой оплаты приглашённого).
- `credited_at` — момент фактического начисления бонуса реферреру.
- `created_at` — дата создания записи.

---

## 3. Access & Billing

### `tariff_plans` — Тарифные планы

Справочник тарифов продукта.

```sql
tariff_plans
├── id                     UUID PK
├── code                   VARCHAR(50) UNIQUE NOT NULL    -- 'free', 'basic', 'pro', 'business'
├── name                   VARCHAR(100) NOT NULL
├── price_monthly          DECIMAL(10,2) NOT NULL
├── price_annual           DECIMAL(10,2)
├── description            TEXT
├── limits_json            JSONB NOT NULL                 -- лимиты тарифа (товары, SKU, склады и т.д.)
│                          -- { "products": 500, "skus": 2000, "warehouses": 3, 
│                          --   "marketplace_accounts": 2, "members": 5 }
├── features_json          JSONB                          -- список фичей тарифа
├── is_active              BOOLEAN DEFAULT TRUE
├── sort_order             INTEGER DEFAULT 0
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор тарифа.
- `code` — машиночитаемый код тарифа: `free`, `basic`, `pro`, `business`. Используется в коде для сравнения, не меняется.
- `name` — человекочитаемое название, отображается в UI и на странице тарифов.
- `price_monthly` — ежемесячная стоимость тарифа в рублях. Используется при расчёте оплаты.
- `price_annual` — стоимость при оплате за год (обычно дешевле). `NULL` если годовой тариф не предусмотрен.
- `description` — описание тарифа для отображения на лендинге или странице выбора тарифа.
- `limits_json` — JSON с ограничениями тарифа: `{"products": 500, "skus": 2000, "warehouses": 3, "marketplace_accounts": 2, "members": 5}`. Читается системой при проверке лимитов.
- `features_json` — JSON со списком доступных фичей на этом тарифе. Используется для отображения галочек на странице тарифов.
- `is_active` — `false` позволяет скрыть тариф без удаления (например, устаревший тариф).
- `sort_order` — порядок отображения тарифов на странице (от меньшего к большему).
- `created_at` / `updated_at` — служебные метки времени.

**Текущие тарифы:**
| code | name | Цена |
|---|---|---|
| `free` | Early Access / Free | 0 ₽ |
| `basic` | Basic | 1290 ₽/мес |
| `pro` | Pro | 2990 ₽/мес |
| `business` | Business | 5990 ₽/мес |

---

### `access_grants` — Предоставление доступа тенанту

Центральная таблица, которая контролирует *почему* и *на каком основании* тенант имеет доступ.

```sql
access_grants
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── tariff_plan_id         UUID FK → tariff_plans.id
├── access_type            ENUM(
│                              'early_access',   -- первые пользователи до запуска
│                              'trial',          -- стандартный пробный период
│                              'paid',           -- оплаченный тариф
│                              'manual_grant',   -- вручную выдал support/admin
│                              'partner_grant',  -- партнёрский доступ
│                              'referral_bonus'  -- бонус за реферал
│                          ) NOT NULL
├── source                 VARCHAR(100)                   -- 'registration', 'admin_panel', 'promo'
├── status                 ENUM('active', 'expired', 'cancelled') DEFAULT 'active'
├── started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── ends_at                TIMESTAMPTZ                    -- NULL = бессрочный (напр. для paid)
├── limits_snapshot_json   JSONB                          -- снимок лимитов на момент выдачи
├── granted_by_user_id     UUID FK → users.id             -- если выдал вручную (admin/support)
├── notes                  TEXT                           -- внутренние заметки
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор гранта доступа.
- `tenant_id` — тенант, которому выдан доступ.
- `tariff_plan_id` — тарифный план, по которому выдан доступ. `NULL` для `manual_grant` без тарифа.
- `access_type` — **причина доступа**: `early_access` — ранний доступ до публичного запуска; `trial` — стандартный пробный период (14 дней); `paid` — оплаченный тариф; `manual_grant` — вручную дал support или admin (например, для партнёра или при решении проблемы); `partner_grant` — партнёрский доступ по договору; `referral_bonus` — бонусные дни за реферала.
- `source` — откуда пришёл грант: `registration` (автоматически при регистрации), `admin_panel` (вручную), `promo` (через промокод).
- `status` — `active` (действует прямо сейчас), `expired` (срок истёк), `cancelled` (аннулирован досрочно).
- `started_at` — когда доступ начал действовать.
- `ends_at` — когда доступ истекает. `NULL` означает бессрочный (используется для paid-тарифов с автопродлением).
- `limits_snapshot_json` — снимок лимитов на момент выдачи. Нужен, чтобы изменение тарифа не ломало уже выданные гранты.
- `granted_by_user_id` — кто из команды выдал доступ вручную. `NULL` для автоматических грантов.
- `notes` — внутренние заметки для команды поддержки (не видны клиенту).
- `created_at` / `updated_at` — служебные метки времени.

**Логика работы:**
1. При регистрации создаётся `access_grants` с `access_type = 'trial'`
2. При оплате — новый grant с `access_type = 'paid'`, старый получает `status = 'expired'`
3. Система всегда смотрит на **активный** `access_grants` для определения уровня доступа

---

### `subscriptions` — История оплат / подписок

Детальная история платёжных транзакций.

```sql
subscriptions
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── tariff_plan_id         UUID FK → tariff_plans.id NOT NULL
├── access_grant_id        UUID FK → access_grants.id     -- связь с грантом доступа
├── status                 ENUM('active', 'cancelled', 'expired', 'refunded') DEFAULT 'active'
├── billing_period         ENUM('monthly', 'annual')
├── amount                 DECIMAL(10,2) NOT NULL
├── currency               VARCHAR(10) DEFAULT 'RUB'
├── payment_provider       VARCHAR(50)                    -- 'yookassa', 'stripe', etc.
├── payment_id             VARCHAR(255)                   -- ID транзакции в платёжной системе
├── paid_at                TIMESTAMPTZ
├── period_start           TIMESTAMPTZ NOT NULL
├── period_end             TIMESTAMPTZ NOT NULL
├── auto_renew             BOOLEAN DEFAULT TRUE
├── cancelled_at           TIMESTAMPTZ
├── cancel_reason          TEXT
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор подписки.
- `tenant_id` — тенант, оплативший подписку.
- `tariff_plan_id` — какой тариф был оплачен.
- `access_grant_id` — ссылка на грант доступа, который был создан вместе с этой подпиской. Связывает коммерческий факт оплаты с системой доступа.
- `status` — `active` (текущая активная подписка), `cancelled` (пользователь отменил), `expired` (истёк период, не возобновлена), `refunded` (возврат денег).
- `billing_period` — период оплаты: `monthly` (помесячно) или `annual` (годовая).
- `amount` — сумма оплаты в выбранной валюте.
- `currency` — валюта платежа, по умолчанию `RUB`.
- `payment_provider` — платёжная система через которую прошла оплата: `yookassa`, `stripe` и т.д.
- `payment_id` — ID транзакции в платёжной системе. Нужен для сверки, возвратов и поддержки.
- `paid_at` — точное время получения подтверждения оплаты от платёжного провайдера.
- `period_start` / `period_end` — даты начала и конца оплаченного периода. По ним система понимает, когда нужно следующее списание.
- `auto_renew` — включено ли автопродление. При `false` подписка не возобновится автоматически по истечении периода.
- `cancelled_at` — когда пользователь нажал «отменить подписку».
- `cancel_reason` — причина отмены (из формы или из API платёжной системы).
- `created_at` / `updated_at` — служебные метки времени.

---

### `promo_codes` — Промокоды

```sql
promo_codes
├── id                     UUID PK
├── code                   VARCHAR(50) UNIQUE NOT NULL    -- 'SAVE30', 'BETA2024'
├── type                   ENUM('percent_discount', 'fixed_discount', 'free_days', 'free_months')
├── value                  DECIMAL(10,2) NOT NULL         -- 30 (%), 500 (руб), 14 (дней)
├── applicable_to          ENUM('all', 'tariff_basic', 'tariff_pro', 'tariff_business')
├── max_uses               INTEGER                        -- NULL = без ограничений
├── used_count             INTEGER DEFAULT 0
├── valid_from             TIMESTAMPTZ
├── valid_until            TIMESTAMPTZ
├── is_active              BOOLEAN DEFAULT TRUE
├── created_by_user_id     UUID FK → users.id
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор промокода.
- `code` — сам промокод, который вводит пользователь: `SAVE30`, `BETA2024`. Уникален, регистронезависимо проверяется при применении.
- `type` — тип скидки: `percent_discount` (процент от суммы), `fixed_discount` (фиксированная сумма), `free_days` (бесплатные дни), `free_months` (бесплатные месяцы).
- `value` — числовое значение: 30 (процентов), 500 (рублей), 14 (дней) — зависит от `type`.
- `applicable_to` — на какие тарифы распространяется: `all` или конкретный (`tariff_basic`, `tariff_pro`, `tariff_business`).
- `max_uses` — максимальное количество применений промокода. `NULL` — без ограничений.
- `used_count` — сколько раз промокод уже был применён. Инкрементируется при каждом успешном применении.
- `valid_from` / `valid_until` — временной диапазон действия промокода. `NULL` означает без ограничений по времени.
- `is_active` — быстрый флаг для деактивации промокода без изменения дат.
- `created_by_user_id` — кто из команды создал промокод (admin).
- `created_at` / `updated_at` — служебные метки времени.

---

### `promo_redemptions` — Использование промокодов

```sql
promo_redemptions
├── id                     UUID PK
├── promo_code_id          UUID FK → promo_codes.id NOT NULL
├── user_id                UUID FK → users.id NOT NULL
├── tenant_id              UUID FK → tenants.id NOT NULL
├── subscription_id        UUID FK → subscriptions.id
├── discount_applied       DECIMAL(10,2)
├── redeemed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор применения.
- `promo_code_id` — ссылка на использованный промокод.
- `user_id` — кто применил промокод.
- `tenant_id` — в рамках какого тенанта применён.
- `subscription_id` — к какой подписке была применена скидка. Позволяет видеть, какой платёж был со скидкой.
- `discount_applied` — итоговая сумма скидки в рублях. Нужна для аналитики и сверки с платёжными данными.
- `redeemed_at` — дата и время применения промокода.
- `created_at` — дата создания записи.

---

### `waitlist_entries` — Лист ожидания (ранний доступ)

```sql
waitlist_entries
├── id                     UUID PK
├── email                  VARCHAR(255) UNIQUE NOT NULL
├── first_name             VARCHAR(100)
├── phone                  VARCHAR(30)
├── source                 VARCHAR(255)                   -- откуда пришёл
├── referral_code          VARCHAR(100)
├── status                 ENUM('waiting', 'invited', 'registered') DEFAULT 'waiting'
├── invited_at             TIMESTAMPTZ
├── notes                  TEXT
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор записи в листе ожидания.
- `email` — email человека, оставившего заявку. Уникален — один человек не может оставить заявку дважды.
- `first_name` — имя для персонализации письма-приглашения.
- `phone` — телефон (опционально), может быть использован для связи.
- `source` — откуда пришёл человек: `landing`, `social`, `referral` и т.д. Помогает понять, какой канал даёт наибольший интерес.
- `referral_code` — реферальный код, если человек пришёл по чьей-то ссылке. После регистрации будет связан с `referral_links`.
- `status` — жизненный цикл заявки: `waiting` (ждёт очереди), `invited` (получил письмо с доступом), `registered` (зарегистрировался в системе).
- `invited_at` — когда команда отправила приглашение на регистрацию.
- `notes` — внутренние заметки команды об этом человеке.
- `created_at` — дата подачи заявки.

---

## 4. Marketplace

### `marketplace_accounts` — Подключенные кабинеты маркетплейсов

Один тенант может иметь несколько кабинетов (WB + Ozon) или несколько кабинетов одного маркетплейса.

```sql
marketplace_accounts
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── marketplace            ENUM('wildberries', 'ozon') NOT NULL
├── external_account_id    VARCHAR(255) NOT NULL          -- уникальный ID кабинета от WB/Ozon API
├── name                   VARCHAR(255) NOT NULL          -- название магазина/кабинета
├── status                 ENUM('active', 'disconnected', 'error', 'suspended') DEFAULT 'active'
├── is_primary             BOOLEAN DEFAULT FALSE           -- основной кабинет тенанта
├── last_sync_at           TIMESTAMPTZ
├── sync_error             TEXT                           -- последняя ошибка синка
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── deleted_at             TIMESTAMPTZ
```

**Описание полей:**
- `id` — уникальный идентификатор кабинета.
- `tenant_id` — какому тенанту принадлежит кабинет.
- `marketplace` — конкретная площадка: `wildberries` или `ozon`. Вместе с `external_account_id` образует уникальную пару для антифрода.
- `external_account_id` — уникальный ID кабинета внутри WB или Ozon (из их API). Не дублируется в системе — защита от подключения одного кабинета к двум аккаунтам.
- `name` — название магазина/кабинета, как называется в WB/Ozon. Отображается в интерфейсе продукта.
- `status` — текущее состояние подключения: `active` — работает; `disconnected` — отключён пользователем; `error` — проблема с API-ключом; `suspended` — заблокирован.
- `is_primary` — основной кабинет тенанта. Если несколько кабинетов, этот флаг определяет, какой отображать по умолчанию.
- `last_sync_at` — когда последний раз успешно синхронизировались с маркетплейсом. Показывается пользователю в UI.
- `sync_error` — текст последней ошибки синхронизации. Если не `NULL` — пользователю показывается внимание опроблеме.
- `created_at` / `updated_at` / `deleted_at` — служебные метки; `deleted_at` для soft delete.

**Индексы:**
- `UNIQUE (marketplace, external_account_id)` — **антифрод**: один кабинет WB/Ozon не может быть подключён к двум тенантам
- `INDEX (tenant_id, marketplace)`

> ⚠️ **Антифрод:** при подключении кабинета система проверяет `external_account_id` на уникальность. Если кабинет уже существует у другого тенанта — показываем сообщение и направляем в support.

---

### `marketplace_credentials` — API-ключи маркетплейсов

Хранятся **отдельно** от `marketplace_accounts` по соображениям безопасности.

```sql
marketplace_credentials
├── id                     UUID PK
├── marketplace_account_id UUID FK → marketplace_accounts.id UNIQUE NOT NULL
├── api_key_encrypted      TEXT NOT NULL                  -- зашифрован на application level (AES-256)
├── api_key_hint           VARCHAR(20)                    -- последние 4 символа для отображения
├── extra_encrypted        JSONB                          -- доп. данные (client_id, secret и т.д.)
├── expires_at             TIMESTAMPTZ                    -- если ключ имеет срок жизни
├── is_valid               BOOLEAN DEFAULT TRUE
├── last_validated_at      TIMESTAMPTZ
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор записи с креденшиалами.
- `marketplace_account_id` — к какому кабинету принадлежит ключ. `UNIQUE` — один кабинет = один ключ.
- `api_key_encrypted` — зашифрованный API-ключ для обращения к WB/Ozon API. Шифруется на уровне приложения (AES-256). **Никогда не хранить в plain text!**
- `api_key_hint` — последние 4 символа ключа (например, `...a3f2`). Показывается пользователю в UI, чтобы различать ключи, не раскрывая полный.
- `extra_encrypted` — дополнительные зашифрованные данные: `client_id`, `client_secret` и т.д. (для Ozon или WB, в зависимости от площадки).
- `expires_at` — если ключ временный, здесь хранится дата его истечения. Система может заранее предупредить пользователя о необходимости обновить ключ.
- `is_valid` — был ли ключ проверен при последнем обращении к API. `false` — ключ недействительный.
- `last_validated_at` — когда последний раз валидировали ключ через API маркетплейса.
- `created_at` / `updated_at` — служебные метки времени.

> **Никогда** не хранить API-ключи в plain text. Шифрование на уровне приложения, ключ шифрования — из секретного хранилища (Vault / env secrets).

---

### `marketplace_warehouses` — Склады маркетплейсов

У одного кабинета может быть несколько складов (FBO, FBS, Ozon FBO, etc.).

```sql
marketplace_warehouses
├── id                     UUID PK
├── marketplace_account_id UUID FK → marketplace_accounts.id NOT NULL
├── tenant_id              UUID FK → tenants.id NOT NULL
├── external_warehouse_id  VARCHAR(255) NOT NULL          -- ID склада в WB/Ozon API
├── name                   VARCHAR(255) NOT NULL           -- название склада
├── type                   ENUM('fbo', 'fbs', 'dbs', 'unknown') DEFAULT 'unknown'
├── is_active              BOOLEAN DEFAULT TRUE
├── is_default             BOOLEAN DEFAULT FALSE           -- основной склад для этого кабинета
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор склада маркетплейса.
- `marketplace_account_id` — к какому кабинету относится этот склад.
- `tenant_id` — тенант, которому был синхронизирован склад. Удобен для быстрых запросов без JOIN через `marketplace_accounts`.
- `external_warehouse_id` — ID склада внутри API WB/Ozon. Используется при пуше остатков на конкретный склад.
- `name` — название склада из маркетплейса (например, «Москва ФБО»). Отображается пользователю.
- `type` — тип склада: `fbo` (хранится на складе WB/Ozon), `fbs` (хранится у продавца, отгрузка самостоятельно), `dbs` (доставка своёй службой), `unknown`.
- `is_active` — активен ли склад сейчас. Неактивные склады не участвуют в синхронизации.
- `is_default` — основной склад для данного кабинета. Используется в UI по умолчанию.
- `created_at` / `updated_at` — служебные метки времени.

**Индексы:**
- `UNIQUE (marketplace_account_id, external_warehouse_id)` — защита от дубликатов
- `INDEX (tenant_id)`

---

### `marketplace_sync_runs` — Журнал синхронизаций

Технический лог каждого запуска синхронизации остатков.

```sql
marketplace_sync_runs
├── id                     UUID PK
├── marketplace_account_id UUID FK → marketplace_accounts.id NOT NULL
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sync_type              ENUM('stock_push', 'orders_pull', 'products_pull', 'full_sync')
├── status                 ENUM('running', 'success', 'failed', 'partial')
├── started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── finished_at            TIMESTAMPTZ
├── duration_ms            INTEGER
├── items_processed        INTEGER DEFAULT 0
├── items_failed           INTEGER DEFAULT 0
├── error_message          TEXT
├── meta_json              JSONB                          -- дополнительная техническая информация
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Описание полей:**
- `id` — уникальный идентификатор запуска синхронизации.
- `marketplace_account_id` — кабинет, для которого запущена синхронизация.
- `tenant_id` — тенант для быстрой фильтрации по tenant_id без промежуточных JOIN.
- `sync_type` — тип синхронизации: `stock_push` (отправка остатков на WB/Ozon), `orders_pull` (получение заказов), `products_pull` (получение каталога товаров), `full_sync` (полная синхронизация).
- `status` — результат запуска: `running` (в процессе), `success` (успешно), `failed` (ошибка), `partial` (частично выполнено).
- `started_at` — время начала запуска. Используется для вычисления длительности.
- `finished_at` — время окончания. `NULL` — ещё выполняется.
- `duration_ms` — продолжительность запуска в миллисекундах. Нужен для отслеживания перформанса.
- `items_processed` — сколько записей (товаров/остатков) успешно обработано.
- `items_failed` — сколько записей не удалось обработать. Если > 0 одновременно со статусом `success` — значит `partial`.
- `error_message` — текст ошибки, если запуск повалился. Показывается в UI, помогает пользователю понять причину.
- `meta_json` — дополнительные технические данные для отладки: список неудачных SKU, детали респонса API и т.д.
- `created_at` — дата создания записи.

---

## 5. Catalog & Inventory

### `products` — Товары

Бизнес-сущность «товар». Принадлежит тенанту.

```sql
products
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── name                   VARCHAR(500) NOT NULL
├── description            TEXT
├── brand                  VARCHAR(255)
├── category               VARCHAR(255)
├── status                 ENUM('active', 'archived', 'draft') DEFAULT 'active'
├── main_photo_url         TEXT                           -- URL в S3
├── created_by_user_id     UUID FK → users.id
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── deleted_at             TIMESTAMPTZ
```

**Индексы:**
- `INDEX (tenant_id, status)`
- `INDEX (tenant_id, created_at)`

---

### `skus` — SKU (складские единицы хранения)

Конкретная вариация товара (размер, цвет). Именно SKU имеет баркод.

```sql
skus
├── id                     UUID PK
├── product_id             UUID FK → products.id NOT NULL
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sku_code               VARCHAR(255)                   -- артикул / внутренний код
├── barcode                VARCHAR(100)                   -- баркод
├── name                   VARCHAR(500)                   -- название вариации
├── attributes_json        JSONB                          -- { "color": "red", "size": "XL" }
├── photo_url              TEXT
├── status                 ENUM('active', 'archived') DEFAULT 'active'
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── deleted_at             TIMESTAMPTZ
```

**Индексы:**
- `INDEX (tenant_id, barcode)` — поиск по баркоду в рамках тенанта
- `INDEX (product_id)`
- `UNIQUE (tenant_id, sku_code)` — уникальность артикула в рамках тенанта

---

### `warehouses` — Внутренние склады тенанта

Собственные склады пользователя (не маркетплейса).

```sql
warehouses
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── name                   VARCHAR(255) NOT NULL
├── address                TEXT
├── is_default             BOOLEAN DEFAULT FALSE
├── marketplace_warehouse_id UUID FK → marketplace_warehouses.id  -- привязка к складу маркетплейса
├── status                 ENUM('active', 'archived') DEFAULT 'active'
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `stock_balances` — Текущие остатки

Текущее количество каждого SKU на каждом складе. **Денормализованная** таблица для быстрых запросов.

```sql
stock_balances
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sku_id                 UUID FK → skus.id NOT NULL
├── warehouse_id           UUID FK → warehouses.id NOT NULL
├── quantity               INTEGER NOT NULL DEFAULT 0     -- текущий остаток
├── reserved_quantity      INTEGER NOT NULL DEFAULT 0     -- зарезервировано (в заказах)
├── available_quantity     INTEGER GENERATED ALWAYS AS (quantity - reserved_quantity) STORED
├── last_sync_at           TIMESTAMPTZ                    -- когда последний раз синкнули с маркетплейсом
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Индексы:**
- `UNIQUE (tenant_id, sku_id, warehouse_id)` — одна строка = один SKU на одном складе
- `INDEX (tenant_id, warehouse_id)`

---

### `stock_movements` — История движений остатков

Полный журнал всех изменений остатков. Audit-таблица для склада.

```sql
stock_movements
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sku_id                 UUID FK → skus.id NOT NULL
├── warehouse_id           UUID FK → warehouses.id NOT NULL
├── type                   ENUM(
│                              'inbound',        -- поступление
│                              'outbound',       -- отгрузка
│                              'adjustment',     -- ручная корректировка
│                              'sync_correction',-- исправление после синка с WT/Ozon
│                              'reservation',    -- резервирование под заказ
│                              'reservation_cancel', -- отмена резерва
│                              'transfer'        -- перемещение между складами
│                          ) NOT NULL
├── quantity_before        INTEGER NOT NULL
├── quantity_change        INTEGER NOT NULL               -- может быть отрицательным
├── quantity_after         INTEGER NOT NULL
├── adjustment_reason_id   UUID FK → stock_adjustment_reasons.id
├── performed_by_user_id   UUID FK → users.id
├── source                 ENUM('manual', 'marketplace_sync', 'import', 'api')
├── reference_id           UUID                           -- ID внешнего документа (заказ, синк)
├── notes                  TEXT
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Индексы:**
- `INDEX (tenant_id, sku_id, created_at)`
- `INDEX (tenant_id, warehouse_id, created_at)`

---

### `stock_adjustment_reasons` — Справочник причин корректировки

```sql
stock_adjustment_reasons
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id           -- NULL = системный (глобальный)
├── name                   VARCHAR(255) NOT NULL
├── is_system              BOOLEAN DEFAULT FALSE
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## 6. Finance

### `product_finance_profiles` — Финансовый профиль SKU

Все затраты и комиссии для расчёта unit-экономики.

```sql
product_finance_profiles
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sku_id                 UUID FK → skus.id NOT NULL
├── marketplace_account_id UUID FK → marketplace_accounts.id
├── purchase_price         DECIMAL(12,2)                  -- закупочная цена
├── logistics_cost         DECIMAL(12,2)                  -- стоимость доставки до склада
├── marketplace_commission DECIMAL(5,2)                   -- комиссия маркетплейса (%)
├── storage_cost           DECIMAL(12,2)                  -- стоимость хранения
├── packaging_cost         DECIMAL(12,2)                  -- упаковка
├── return_rate            DECIMAL(5,2)                   -- % возвратов
├── rating_bonus_cost      DECIMAL(12,2)                  -- расходы на рейтинг/отзывы
├── tax_rate               DECIMAL(5,2)                   -- налог (%)
├── selling_price          DECIMAL(12,2)                  -- цена продажи
├── dimensions_json        JSONB                          -- { "weight": 0.5, "length": 10, "width": 8, "height": 5 }
├── currency               VARCHAR(10) DEFAULT 'RUB'
├── valid_from             TIMESTAMPTZ
├── valid_until            TIMESTAMPTZ
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `product_profit_snapshots` — Снимки расчёта прибыли

Периодически рассчитываемые снимки unit-экономики, чтобы не пересчитывать каждый раз на лету.

```sql
product_profit_snapshots
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id NOT NULL
├── sku_id                 UUID FK → skus.id NOT NULL
├── finance_profile_id     UUID FK → product_finance_profiles.id
├── calculated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── revenue                DECIMAL(12,2)
├── total_costs            DECIMAL(12,2)
├── gross_profit           DECIMAL(12,2)
├── gross_margin           DECIMAL(5,2)                   -- %
├── net_profit             DECIMAL(12,2)
├── net_margin             DECIMAL(5,2)                   -- %
├── roi                    DECIMAL(8,2)
└── meta_json              JSONB                          -- детали расчёта
```

---

## 7. Audit & Security

### `audit_logs` — Бизнес-аудит действий

Логирует бизнес-события: изменения остатков, ролей, подключений — то, что важно для пользователя.

```sql
audit_logs
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id
├── actor_user_id          UUID FK → users.id             -- кто выполнил действие
├── action                 VARCHAR(100) NOT NULL           -- 'stock.adjusted', 'member.invited', etc.
├── entity_type            VARCHAR(100)                   -- 'sku', 'membership', 'marketplace_account'
├── entity_id              UUID                           -- ID изменённой сущности
├── before_json            JSONB                          -- состояние до
├── after_json             JSONB                          -- состояние после
├── ip_address             INET
├── user_agent             TEXT
├── source                 ENUM('web', 'api', 'worker', 'admin', 'system')
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Индексы:**
- `INDEX (tenant_id, action, created_at)`
- `INDEX (tenant_id, entity_type, entity_id)`
- `INDEX (actor_user_id, created_at)`

> **Только запись, никогда не обновляется!** Append-only таблица.

---

### `security_events` — События безопасности

Технические события: подозрительные входы, попытки брутфорса и т.д.

```sql
security_events
├── id                     UUID PK
├── user_id                UUID FK → users.id
├── event_type             ENUM(
│                              'login_success', 'login_failed',
│                              'password_reset_requested', 'password_changed',
│                              'email_change_requested', 'mfa_enabled',
│                              'suspicious_login', 'account_blocked'
│                          ) NOT NULL
├── ip_address             INET
├── user_agent             TEXT
├── geo_country            VARCHAR(100)
├── risk_score             SMALLINT                       -- 0-100
├── resolved               BOOLEAN DEFAULT FALSE
├── notes                  TEXT
└── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `support_cases` — Обращения в поддержку

```sql
support_cases
├── id                     UUID PK
├── tenant_id              UUID FK → tenants.id
├── user_id                UUID FK → users.id NOT NULL
├── type                   ENUM('general', 'store_reassignment', 'billing', 'technical', 'fraud')
├── status                 ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open'
├── subject                VARCHAR(500) NOT NULL
├── description            TEXT
├── assigned_to_user_id    UUID FK → users.id             -- support agent
├── resolved_at            TIMESTAMPTZ
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `store_reassignment_requests` — Запросы на перепривязку кабинета

Специальный flow для случаев «кабинет уже привязан к другому аккаунту».

```sql
store_reassignment_requests
├── id                     UUID PK
├── marketplace_account_external_id VARCHAR(255) NOT NULL
├── marketplace            ENUM('wildberries', 'ozon') NOT NULL
├── requesting_tenant_id   UUID FK → tenants.id NOT NULL  -- кто просит привязать
├── current_tenant_id      UUID FK → tenants.id           -- у кого сейчас
├── status                 ENUM('pending', 'approved', 'rejected', 'auto_resolved') DEFAULT 'pending'
├── verification_method    VARCHAR(100)                   -- как подтвердили владение
├── handled_by_user_id     UUID FK → users.id             -- support agent
├── handled_at             TIMESTAMPTZ
├── notes                  TEXT
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## Связи между таблицами

```
users ──< memberships >── tenants
              │
              └── invitations

users ── registration_attributions
users ── referral_links ──< referral_rewards

tenants ──< marketplace_accounts ── marketplace_credentials
                    │
                    └──< marketplace_warehouses
                    └──< marketplace_sync_runs

tenants ──< access_grants >── tariff_plans
tenants ──< subscriptions >── tariff_plans
tenants ──< promo_redemptions >── promo_codes

tenants ──< warehouses ──── marketplace_warehouses
tenants ──< products ──< skus
                          │
                          ├──< stock_balances >── warehouses
                          ├──< stock_movements >── warehouses
                          └──< product_finance_profiles
                                       │
                                       └──< product_profit_snapshots

tenants ──< audit_logs
users   ──< security_events
tenants ──< support_cases
tenants ──< store_reassignment_requests
```

---

## Что мы не забыли учесть

| Аспект | Решение |
|---|---|
| Шифрование паролей | `password_hash` (bcrypt/argon2), никогда plain text |
| Шифрование API-ключей | `api_key_encrypted` (AES-256 на app level), отдельная таблица `marketplace_credentials` |
| Атрибуция регистрации | `registration_attributions` — IP, гео, UTM, реферал, промокод |
| Несколько складов WB/Ozon | `marketplace_warehouses` — один кабинет = много складов |
| Несколько кабинетов WB/Ozon | `marketplace_accounts` — один тенант = много кабинетов |
| Антифрод (дубли кабинетов) | `UNIQUE (marketplace, external_account_id)` в `marketplace_accounts` |
| Роль ≠ Доступ | `memberships.role` отдельно, `tenants.access_state` + `access_grants` отдельно |
| История остатков | `stock_movements` — полный журнал всех изменений append-only |
| Unit-экономика | `product_finance_profiles` + `product_profit_snapshots` |
| Тарифные лимиты | `tariff_plans.limits_json` + `access_grants.limits_snapshot_json` |
| Промокоды и рефералы | Отдельные таблицы `promo_codes`, `promo_redemptions`, `referral_links`, `referral_rewards` |
| Перепривязка кабинетов | `store_reassignment_requests` — контролируемый support flow |
| Soft delete | `deleted_at` в ключевых таблицах |
| UUID | Все PK — UUID v4 |
| Временны́е зоны | Все `TIMESTAMPTZ` в UTC |
| Мультитенантность | Все бизнес-таблицы имеют `tenant_id` |
| Файлы (фото товаров) | Только URL в S3, само хранение — в Object Storage |
| Лист ожидания | `waitlist_entries` — для раннего доступа |
| Безопасность | `security_events` — технический лог входов/угроз |
| Аудит действий | `audit_logs` — бизнес-события append-only |

---

## Потенциальные дополнения в будущем

Следующие таблицы **не нужны сейчас**, но стоит держать в голове:

| Таблица | Зачем |
|---|---|
| `orders` | Если будем тянуть заказы с маркетплейсов |
| `consent_logs` | GDPR / ФЗ-152 согласия на обработку данных |
| `notifications` | История уведомлений (email, in-app) |
| `feature_flags` | A/B тесты, поэтапные релизы |
| `api_keys` | Если введём публичный API для интеграций |
| `mfa_settings` | Двухфакторная аутентификация |
| `webhooks` | Уведомления внешних систем |
| `import_jobs` | Импорт товаров из Excel/CSV |
| `export_jobs` | Экспорт данных |

---

*Документ создан: 2026-03-24 | Repo: SkladOptima | docs/database/schema-overview.md*
