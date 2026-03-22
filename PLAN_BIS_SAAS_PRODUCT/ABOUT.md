# SkladOptima - Финальная стартовая документация v1

## 1. Краткое понимание проекта

**SkladOptima** - multi-tenant SaaS для селлеров Wildberries и Ozon.

Продукт решает 4 ключевые задачи:

* учет товаров и складских остатков
* синхронизация с маркетплейсами
* юнит-экономика и финансовый учет
* аудит и контроль действий пользователей

Это не просто складской учет. Это операционный веб-сервис для селлеров, где важны:

* tenant isolation
* роли и доступы
* привязка маркетплейс-кабинетов
* история изменений
* дальнейшая подписочная модель
* масштабируемость без раннего overengineering

---

## 2. Текущая продуктовая модель

### 2.1. Базовые возможности продукта

* заведение товаров, SKU, баркодов, фото
* учет остатков вручную и автоматически
* синхронизация остатков с WB и Ozon
* хранение закупочной цены, логистики, комиссий, габаритов
* расчет прибыли и unit economics
* audit log по изменениям остатков
* мультитенантность
* дальнейшие тарифы, роли, реферальная система, промокоды

### 2.2. Основной сценарий входа

Новый пользователь приходит с лендинга и проходит регистрацию.

При регистрации или раннем онбординге возможны:

* реферальный код
* промокод
* early access / бесплатный период
* trial после публичного запуска

### 2.3. Что фиксируется при регистрации

Нужно хранить:

* email
* phone
* first_name
* last_name
* гео регистрации
* источник регистрации / атрибуцию
* реферальный код, если был
* промокод, если был
* tenant / аккаунт компании
* связь с marketplace account

### 2.4. Антифрод-логика

Система должна понимать, что marketplace account уже подключен.

Если магазин уже привязан к другому tenant, нужен controlled flow:

* запрет на повторное подключение
* сообщение обратиться в support
* flow восстановления доступа / подтверждения владения

---

## 3. Ключевые архитектурные решения

### 3.1. Не смешивать User и Tenant

Это базовое правило проекта.

* **User** = физический пользователь
* **Tenant** = компания / клиентский аккаунт в SaaS
* **Membership** = роль пользователя внутри tenant

Подписка принадлежит **tenant**, а не user.

### 3.2. Не смешивать роль и коммерческий доступ

Это две разные оси.

**Role:**

* OWNER
* MANAGER
* STAFF
* SUPPORT_ADMIN

**Access State:**

* EARLY_ACCESS
* TRIAL_ACTIVE
* TRIAL_EXPIRED
* ACTIVE_PAID
* GRACE_PERIOD
* SUSPENDED
* CLOSED

### 3.3. Магазин - это не просто название

Нельзя строить антифрод на названии магазина.

Нужна сущность:

* **MarketplaceAccount**

И использовать внешний уникальный идентификатор кабинета WB/Ozon.

### 3.4. Архитектура старта

На старте правильный выбор - **modular monolith**, а не микросервисы.

Почему:

* домен еще формируется
* команда небольшая
* нужен быстрый запуск
* важнее четкие модули, чем распределенная сложность
* инфраструктура должна быть дешевой и управляемой

---

## 4. Доменные сущности

### Identity / Tenant

* User
* Tenant
* Membership
* Invitation
* ConsentLog
* RegistrationAttribution

### Access / Billing

* AccessGrant
* Trial
* Subscription
* TariffPlan
* PromoCode
* PromoRedemption
* ReferralLink
* ReferralReward
* BonusWallet
* BonusTransaction
* WaitlistEntry

### Marketplace

* MarketplaceAccount
* MarketplaceCredentialRef
* MarketplaceSyncRun
* MarketplaceSyncJob
* MarketplaceProductBinding

### Catalog / Inventory

* Product
* SKU
* Warehouse
* StockBalance
* StockMovement
* StockAdjustmentReason

### Finance

* ProductFinanceProfile
* ProductProfitSnapshot

### Security / Audit / Support

* AuditLog
* SecurityEvent
* SuspiciousCase
* SupportCase
* StoreReassignmentRequest
* ManualActionLog

---

## 5. Предварительная бизнес-логика доступа

### 5.1. Early Access

Появился отдельный режим раннего доступа.

Он не должен смешиваться с обычным trial.

**Назначение:**

* бесплатный доступ на период запуска
* ограниченное количество мест
* ограниченный срок
* сбор обратной связи
* удержание первых пользователей

### 5.2. Trial

Обычный пробный период после публичного запуска.

### 5.3. Paid Subscription

Полноценный платный доступ tenant-а.

### 5.4. Почему это важно

Нельзя хранить все как `FREE`.

Иначе потом невозможно различить:

* early access
* обычный trial
* manual grant
* referral bonus access
* promo-driven access

---

## 6. Рекомендуемая access-модель

Нужна сущность вида `AccessGrant` или `TenantAccessPolicy`.

Пример полей:

* id
* tenant_id
* access_type
* source
* started_at
* ends_at
* status
* limits_snapshot_json
* granted_by
* notes

`access_type`:

* early_access
* trial
* paid
* manual_grant
* partner_grant

---

## 7. Лимиты для early access / free режима

Рекомендуемый подход:

* бесплатный доступ, но с лимитами
* не давать бесплатный безлимит

### Что ограничивать

* количество товаров
* количество SKU
* количество складов
* количество marketplace accounts
* количество сотрудников
* часть функций

### Примерная логика

* склад и остатки доступны
* базовая синхронизация доступна
* базовая unit economics доступна
* расширенная аналитика ограничена
* advanced exports ограничены
* API access ограничен
* массовые операции ограничены

---

## 8. Ориентир по клиентским тарифам SkladOptima

Обсуждалась стартовая ценовая сетка продукта:

* Free / Early Access - 0 ₽ с лимитами
* Basic - 1290 ₽/мес
* Pro - 2990 ₽/мес
* Business - 5990 ₽/мес

Это пока рабочая предварительная тарифная логика, не финальная коммерческая политика.

---

## 9. Репозиторий и структура проекта

Рекомендуемый формат - **monorepo**.

```text
skladoptima/
├─ apps/
│  ├─ web/
│  ├─ landing/
│  ├─ api/
│  └─ worker/
├─ packages/
│  ├─ ui/
│  ├─ config/
│  ├─ types/
│  ├─ api-contracts/
│  ├─ validation/
│  ├─ utils/
│  ├─ logger/
│  └─ test-kit/
├─ docs/
│  ├─ product/
│  ├─ architecture/
│  ├─ engineering/
│  ├─ database/
│  └─ support/
├─ infra/
├─ scripts/
├─ tests/
└─ README.md
```

### Почему monorepo

* единая навигация
* удобство для AI-assisted разработки
* shared types
* единый CI/CD
* проще сопровождение старта

---

## 10. Backend modules

Рекомендуемые модули backend:

* auth
* tenants
* memberships
* onboarding
* billing
* referrals
* marketplace-integrations
* catalog
* inventory
* finance
* audit
* anti-fraud
* notifications
* admin-support

Это **модульный монолит**, а не набор микросервисов.

---

## 11. Инфраструктурный принцип

Для текущего этапа проекта принято решение:

* **не использовать Kubernetes на старте**
* использовать lean infra
* держать инфраструктуру в российском контуре
* минимизировать инфраструктурную сложность

### Почему без Kubernetes сейчас

* у проекта еще не enterprise-stage
* beta / early growth
* нет подтвержденной необходимости
* лишний ops-overhead
* лишние расходы

---

## 12. Финальная стартовая инфраструктура

### 12.1. Managed PostgreSQL

**Конфиг:**

* 4 CPU
* 8 GB RAM
* 80 GB NVMe

**Цена:**

* 2500 ₽ / месяц

**Роль:**

* основная бизнес-БД

**Комментарий:**

* стартово допустимо
* нужно внимательно мониторить
* при росте один из первых кандидатов на усиление

### 12.2. App Server

**Конфиг:**

* 2 vCPU
* 6 GB RAM
* 50 GB NVMe

**Цена:**

* 932 ₽ / месяц

**Роль:**

* frontend
* backend API
* auth
* tenant logic
* inventory/catalog endpoints
* billing API
* nginx/reverse proxy

**Комментарий:**

* acceptable для lean beta
* не конфиг с большим запасом

### 12.3. Worker Server

**Конфиг:**

* 2 vCPU
* 3 GB RAM
* 50 GB NVMe

**Цена:**

* 859.80 ₽ / месяц

**Роль:**

* синхронизация WB/Ozon
* фоновые задачи
* парсинг
* cron jobs
* пересчеты
* retry jobs
* email jobs

**Комментарий:**

* минимально рабочий ultra-lean worker
* первый кандидат на апгрейд

### 12.4. Redis Server

**Конфиг:**

* 2 vCPU
* 2 GB RAM
* 30 GB NVMe

**Цена:**

* 660 ₽ / месяц

**Роль:**

* очереди
* locks
* rate limiting
* cache
* idempotency keys
* temporary operational state

**Комментарий:**

* для beta подходит
* главное ограничение - RAM

### 12.5. S3 Storage

**Объем:**

* 100 GB

**Цена:**

* 210 ₽ / месяц

**Роль:**

* изображения товаров
* превью
* exports
* imports
* generated files
* backup artifacts

**Комментарий:**

* стартовый объем выбран правильно
* хранение дешевое
* GET/POST/PUT бесплатные
* безлимитный трафик делает вариант выгодным для беты

### 12.6. Yandex Cloud Postbox

**Цена:**

* на старте условно 0 ₽ / месяц или очень мало

**Роль:**

* подтверждение email
* восстановление пароля
* уведомления
* приглашения сотрудников
* письма по trial / access / billing

---

## 13. Финальная месячная стоимость инфраструктуры

### Основные компоненты

* Managed PostgreSQL - 2500 ₽
* App server - 932 ₽
* Worker server - 859.80 ₽
* Redis server - 660 ₽
* S3 100 GB - 210 ₽
* Postbox - 0 ₽ на старте

### Итого

**5161.80 ₽ / месяц**

Округленно:
**~5200 ₽ / месяц**

Это не учитывает возможные дополнительные мелкие расходы:

* домен
* внешние платные мониторинги, если появятся
* нетиповые платные backup policies
* будущий load balancer
* будущий второй app instance

---

## 14. Что было решено по Redis и RabbitMQ

### Решение

**Redis оставляем. RabbitMQ сейчас не берем.**

### Почему

Redis закрывает сразу несколько задач:

* очереди
* кэш
* lock-и
* rate limiting
* idempotency keys
* временное operational state

RabbitMQ сейчас дал бы лишнюю инфраструктурную сложность.

---

## 15. Можно ли держать worker вместе с app

### Ответ

Технически да, но как временный компромисс.

### Почему не рекомендовано как целевая схема

У вас worker делает тяжелые вещи:

* парсинг
* синхронизацию
* фоновые batch-процессы
* пересчеты

Если держать его на одном сервере с app, то worker начинает съедать CPU/RAM и влияет на UX пользователей.

### Финальное решение

Worker оставлен **отдельным сервером**.

---

## 16. Где система упрется раньше всего

Предварительный порядок bottleneck-ов:

1. worker
2. managed PostgreSQL
3. app server
4. Redis

То есть первым масштабировать, вероятнее всего, придется:

* worker
* затем БД

---

## 17. Как понимать, хватает ли инфраструктуры

### App server

Смотреть:

* CPU
* RAM
* swap
* error rate
* p95 response time
* p99 response time

### PostgreSQL

Смотреть:

* CPU
* RAM
* disk usage
* disk latency / IOPS
* active connections
* slow queries
* рост hot tables

### Redis

Смотреть:

* memory usage
* evictions
* queue size
* ops/sec
* latency

### Worker

Смотреть:

* backlog очереди
* длительность jobs
* failed jobs
* retry count
* sync lag
* хватает ли минуты на цикл синка

### Практичный критерий

Инфраструктуры хватает, если:

* пользователи не чувствуют лагов
* очередь не копится
* sync jobs укладываются в окно
* app/db/redis не живут постоянно в перегрузе

---

## 18. Что масштабировать при росте

### Сначала масштабировать

1. worker
2. PostgreSQL
3. app server
4. Redis

### Триггеры на масштабирование worker

* очередь растет
* job duration не укладывается в минутный цикл
* высокий CPU/RAM
* растет sync lag

### Триггеры на масштабирование БД

* slow queries
* высокий CPU
* disk pressure
* рост audit/stock history
* нехватка памяти

### Триггеры на масштабирование app

* рост p95/p99
* лаги в UI/API
* высокий CPU
* memory pressure

### Триггеры на масштабирование Redis

* высокий memory usage
* evictions
* растущий backlog очередей

---

## 19. Что важно не упустить в инженерной части

### Обязательно сделать

* нормальные индексы по tenant-scoped данным
* tenant isolation в каждом модуле
* retention policy для технических логов
* отдельную модель business audit и technical sync logs
* мониторинг app/db/redis/worker с первого дня
* TTL на Redis keys
* нейминг ключей Redis
* batch update / upsert там, где это возможно
* не писать в БД лишние обновления, если данные не изменились

### Не делать

* хранить большие бизнес-данные в Redis
* ранние микросервисы
* ранний Kubernetes
* сложный enterprise stack до появления реальной нагрузки

---

## 20. Документы, которые нужно создать в репозитории в первую очередь

### Product

* `docs/product/vision.md`
* `docs/product/glossary.md`
* `docs/product/core-flows/registration-and-access.md`
* `docs/product/core-flows/store-connection.md`
* `docs/product/core-flows/referral-and-promo.md`

### Architecture

* `docs/architecture/system-overview.md`
* `docs/architecture/domain-model.md`
* `docs/architecture/module-boundaries.md`
* `docs/architecture/multi-tenancy.md`
* `docs/architecture/auth-and-roles.md`
* `docs/architecture/billing-access-model.md`
* `docs/architecture/infra-baseline-v1.md`

### Engineering

* `docs/engineering/repo-structure.md`
* `docs/engineering/api-standards.md`
* `docs/engineering/testing-strategy.md`
* `docs/engineering/ai-workflow.md`
* `docs/engineering/observability.md`

### Database

* `docs/database/schema-overview.md`
* `docs/database/migration-strategy.md`
* `docs/database/audit-model.md`

---

## 21. Финальный вывод

На текущем этапе для SkladOptima принято следующее стратегическое решение:

* строим **modular monolith**
* используем **monorepo**
* не идем в Kubernetes на старте
* держим инфраструктуру lean и дешевой
* используем отдельные app / worker / redis
* managed PostgreSQL как основную БД
* S3 как файловый слой
* Postbox как транзакционную почту
* Redis как очередь + cache + locks + rate limits

### Финальная infra baseline v1

* DB - 4 CPU / 8 GB / 80 GB
* App - 2 vCPU / 6 GB / 50 GB
* Worker - 2 vCPU / 3 GB / 50 GB
* Redis - 2 vCPU / 2 GB / 30 GB
* S3 - 100 GB
* Postbox - отдельно

### Финальная стоимость baseline

**~5200 ₽ / месяц**

Это хорошая, очень дешевая и рабочая инфраструктурная база для lean beta SkladOptima.

Да. Ниже даю конкретный список изменений по порядку, без воды - что именно надо поменять, чтобы ваш текущий репозиторий стал нормальной базой под SkladOptima.

Я разделю на:
	•	P0 - менять сразу
	•	P1 - менять очень скоро
	•	P2 - можно после стабилизации основы

⸻

P0 - обязательно поменять сразу

1. Перестать использовать Store как главную сущность

Что поменять:
	•	в документации
	•	в README
	•	в naming
	•	в доменной модели
	•	в Prisma schema
	•	в backend naming

Как должно стать:
	•	Tenant - аккаунт компании в SaaS
	•	User - физический пользователь
	•	Membership - связь пользователя с tenant
	•	MarketplaceAccount - подключенный кабинет WB/Ozon

Почему это обязательно:
сейчас Store у вас перегружен и архитектурно уже не соответствует реальной модели продукта.

⸻

2. Отделить роли от коммерческого доступа

Что поменять:
не хранить доступ через роль типа FREE.

Как должно стать:

Роли:
	•	OWNER
	•	MANAGER
	•	STAFF
	•	SUPPORT_ADMIN

Состояния доступа:
	•	EARLY_ACCESS
	•	TRIAL_ACTIVE
	•	TRIAL_EXPIRED
	•	ACTIVE_PAID
	•	GRACE_PERIOD
	•	SUSPENDED
	•	CLOSED

Почему это обязательно:
роль и подписка - это разные вещи.
Если это не разделить сейчас, потом биллинг сломает архитектуру.

⸻

3. Выделить apps/worker

Что поменять:
в монорепе добавить отдельное приложение:

apps/worker

Туда вынести:
	•	синхронизацию WB/Ozon
	•	фоновые jobs
	•	cron
	•	retry jobs
	•	пересчеты
	•	email jobs
	•	batch import/export

Почему это обязательно:
с учетом вашего парсинга и фоновых процессов держать это внутри app/api как попало - плохая идея.

⸻

4. Перестать хранить картинки на app server

Что поменять:
в README, docs и коде убрать модель:
	•	Multer сохраняет файлы локально на сервер

Как должно стать:
	•	файлы хранятся в S3
	•	в БД хранится только metadata
	•	object key / url / derivatives / size / mime type

Почему это обязательно:
локальное хранение файлов на app server - архитектурно слабое решение для SaaS.

⸻

5. Переписать README

Что поменять:
текущий README.

В новом README должно быть:
	1.	что такое SkladOptima
	2.	core domain model
	3.	repo structure
	4.	high-level architecture
	5.	local запуск
	6.	ссылка на docs

Что убрать/исправить:
	•	Store как корень
	•	local file storage
	•	упрощенную модель multi-tenancy через storeId
	•	отсутствие worker
	•	отсутствие access model

⸻

6. Зафиксировать новую доменную модель

Что поменять:
создать отдельный документ:

docs/architecture/domain-model.md

Там зафиксировать сущности:
	•	User
	•	Tenant
	•	Membership
	•	MarketplaceAccount
	•	Product
	•	SKU
	•	Warehouse
	•	StockBalance
	•	StockMovement
	•	ProductFinanceProfile
	•	AuditLog
	•	Trial
	•	Subscription
	•	PromoCode
	•	PromoRedemption
	•	ReferralLink
	•	ReferralReward
	•	AccessGrant

Почему это обязательно:
без зафиксированной доменной модели начнется хаос в Prisma, backend и frontend.

⸻

7. Переделать описание multi-tenancy

Что поменять:
текущий текст в README и docs про изоляцию данных.

Как должно быть:
	•	все tenant-scoped сущности имеют tenantId
	•	авторизация tenant-aware
	•	доступ определяется через Membership
	•	subscription/access state принадлежит tenant
	•	marketplace accounts принадлежат tenant

Почему это обязательно:
текущее описание слишком упрощенное и уже не соответствует будущему продукту.

⸻

8. Обновить Prisma schema под новую модель

Что поменять:
схему Prisma.

Минимум добавить/переименовать:
	•	Tenant
	•	Membership
	•	MarketplaceAccount
	•	AccessGrant
	•	Trial
	•	Subscription
	•	PromoCode
	•	PromoRedemption
	•	ReferralLink
	•	ReferralReward

Что, скорее всего, придется убрать/переделать:
	•	Store как корень
	•	все жесткие связи, которые сейчас завязаны на старую модель

Почему это обязательно:
иначе все дальнейшие модули будут строиться на неверном фундаменте.

⸻

9. Разрезать backend по сильным модулям

Что поменять:
в apps/api/src перейти к модульной структуре.

Целевая структура:

apps/api/src/
├─ modules/
│  ├─ auth/
│  ├─ users/
│  ├─ tenants/
│  ├─ memberships/
│  ├─ onboarding/
│  ├─ access/
│  ├─ billing/
│  ├─ referrals/
│  ├─ marketplace/
│  ├─ catalog/
│  ├─ inventory/
│  ├─ finance/
│  ├─ audit/
│  ├─ notifications/
│  ├─ support/
│  └─ admin/

Почему это обязательно:
иначе NestJS-монолит станет связанным и неудобным.

⸻

10. Ввести правило: Prisma не дергается хаотично из любого места

Что поменять:
дисциплину доступа к данным.

Как должно быть:
	•	модули работают через свои services/repositories
	•	не должно быть “любой сервис читает любые таблицы как хочет”
	•	tenant filtering должен быть контролируемым

Почему это обязательно:
иначе Prisma станет источником связанного хаоса.

⸻

P1 - очень желательно сделать сразу после P0

11. Добавить packages/ в монорепу

Что поменять:
вынести shared-слои в отдельные пакеты.

Рекомендуемо:

packages/
├─ types/
├─ validation/
├─ api-contracts/
├─ ui/
├─ utils/
├─ config/
└─ logger/

Почему это важно:
это упростит повторное использование кода и AI-assisted разработку.

⸻

12. Привести frontend к модульной структуре

Что поменять:
внутреннюю структуру apps/web/src.

Рекомендуемо:

apps/web/src/
├─ app/
├─ pages/
├─ widgets/
├─ features/
├─ entities/
├─ processes/
└─ shared/

Почему это важно:
иначе React-часть очень быстро превратится в свалку components/services/hooks/utils.

⸻

13. Добавить отдельный документ по access/billing model

Создать:

docs/architecture/access-model.md

Описать:
	•	early access
	•	trial
	•	paid
	•	grace period
	•	suspended
	•	роль vs доступ
	•	кому принадлежит подписка
	•	как работает promo/referral

Почему это важно:
эта логика уже критична для продукта.

⸻

14. Добавить документ по module boundaries

Создать:

docs/architecture/module-boundaries.md

Описать:
	•	за что отвечает каждый модуль
	•	кто от кого может зависеть
	•	какие публичные интерфейсы у модулей
	•	что запрещено делать напрямую

Почему это важно:
иначе модульный монолит не получится.

⸻

15. Добавить infra baseline doc

Создать:

docs/architecture/infra-baseline-v1.md

Туда внести:
	•	app server
	•	worker server
	•	redis server
	•	managed postgres
	•	S3
	•	Postbox
	•	текущую monthly cost baseline

⸻

16. Расширить audit model

Что поменять:
не ограничивать audit только складскими изменениями.

Логировать также:
	•	регистрация
	•	создание tenant
	•	инвайты
	•	смена ролей
	•	подключение marketplace account
	•	изменение access state
	•	promo/referral события
	•	security-sensitive действия

Почему это важно:
audit - одна из ключевых ценностей продукта.

⸻

17. Ввести отдельную модель technical logs vs business audit

Что поменять:
не смешивать:
	•	технические sync logs
	•	бизнес-аудит пользователей

Почему это важно:
иначе audit table быстро станет мусорной и неудобной.

⸻

18. Подготовить naming policy

Что поменять:
зафиксировать нормальные имена сущностей и модулей.

Пример:
	•	Tenant
	•	Membership
	•	MarketplaceAccount
	•	Warehouse
	•	StockMovement
	•	AccessGrant

Почему это важно:
сейчас термин Store у вас перегружен и может сломать понятность кода.

⸻

P2 - можно делать после стабилизации базы

19. Добавить apps/landing, если лендинг реально живет отдельно

Сейчас это можно отложить, если лендинг еще не отделен.

⸻

20. Вынести docs в нормальную структуру

Сейчас docs уже есть, но их надо будет привести к виду:

docs/
├─ product/
├─ architecture/
├─ database/
├─ engineering/
└─ support/


⸻

21. Добавить инженерные документы

Потом создать:
	•	docs/engineering/repo-structure.md
	•	docs/engineering/testing-strategy.md
	•	docs/engineering/observability.md
	•	docs/engineering/ai-workflow.md

⸻

22. Подготовить migration strategy

Нужен отдельный документ:

docs/database/migration-strategy.md

Особенно потому что вы будете переделывать доменную модель.

⸻

23. Подготовить support/admin контур

Позже нужно будет спроектировать:
	•	восстановление доступа
	•	кейсы “магазин уже подключен”
	•	ручная перепривязка
	•	suspicious cases
	•	audit privileged actions

⸻

Рекомендуемый порядок действий

Вот правильный порядок, в котором тебе реально стоит это менять.

Шаг 1

Переписать доменные термины:
	•	Store -> Tenant
	•	добавить MarketplaceAccount
	•	добавить Membership

Шаг 2

Переписать README

Шаг 3

Создать docs:
	•	domain-model.md
	•	access-model.md
	•	module-boundaries.md
	•	infra-baseline-v1.md

Шаг 4

Переделать Prisma schema под новую модель

Шаг 5

Переразложить backend modules

Шаг 6

Добавить apps/worker

Шаг 7

Убрать локальное хранение файлов, перейти на S3 model

Шаг 8

Привести frontend к модульной структуре

Шаг 9

Добавить packages/*

Шаг 10

Расширить audit / technical logs / observability

⸻

Самые критичные изменения, если совсем коротко

Если вы хотите сделать только самое важное прямо сейчас, то это вот:
	1.	Store больше не корневая сущность
	2.	Tenant + Membership + MarketplaceAccount
	3.	Role отдельно, Access State отдельно
	4.	Worker отдельно
	5.	S3 вместо local files
	6.	README и docs под новую модель
	7.	Prisma schema под новую модель
	8.	Backend modules с четкими границами

⸻
