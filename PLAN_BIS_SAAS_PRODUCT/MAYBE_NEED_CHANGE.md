
1. Что уже хорошо

Сейчас у вас уже есть правильные базовые решения:
	•	monorepo
	•	NestJS
	•	TypeScript
	•	Prisma
	•	PostgreSQL
	•	React + Vite
	•	Tailwind
	•	Docker Compose
	•	разделение на apps/api и apps/web

Это хороший фундамент для старта.
То есть проблема не в том, что стек плохой.
Проблема в том, что текущая модель описания и структуры пока слишком “MVP-однопользовательская”, а ваш проект уже стал настоящим multi-tenant SaaS.

⸻

2. Что в текущем описании уже устарело или опасно

2.1. Главная архитектурная ошибка - Store как высшая сущность

Вот это место сейчас надо менять:

Высшая точка иерархии в системе — это Store (Магазин/Аккаунт компании)

Это уже неправильно для вашей текущей модели.

С учетом всего, что вы описали в чате, высшая сущность должна быть не Store, а:
	•	Tenant / Workspace / Account

А Store или точнее MarketplaceAccount - это уже подчиненная сущность внутри tenant.

Почему это критично

Потому что у вас уже есть:
	•	роли
	•	подписки
	•	referral/promo
	•	early access / trial
	•	команда пользователей
	•	возможность нескольких подключений маркетплейсов
	•	anti-fraud по привязке кабинетов

Если оставить Store корнем, потом будет больно:
	•	делать несколько магазинов на одного клиента
	•	делать WB + Ozon одновременно
	•	делать сотрудников
	•	делать billing правильно
	•	делать восстановление доступа и support flows

Что должно быть вместо этого

Иерархия должна быть такой:
	•	Tenant - аккаунт компании в SaaS
	•	Membership - связь пользователя с tenant
	•	User - физический пользователь
	•	MarketplaceAccount - подключенный кабинет WB/Ozon
	•	Subscription - подписка tenant-а
	•	AccessGrant / Trial / EarlyAccess - коммерческий режим tenant-а

⸻

2.2. В README сейчас смешаны бизнес-уровни

Сейчас описание одновременно говорит про:
	•	магазин
	•	компанию
	•	owner
	•	подписку
	•	пользователя

Но эти сущности не разведены.

Для SaaS это опасно.
README должен отражать реальную доменную модель, а не просто “как удобно объяснить”.

⸻

2.3. Хранение картинок “на сервере через Multer” - уже плохое решение

Вот это место тоже надо менять:

Картинки физически сохраняются на сервере (через библиотеку Multer), а в PostgreSQL летит путь до картинки.

С учетом того, что вы уже выбрали S3, это описание устарело и архитектурно слабое.

Почему плохо хранить картинки на app server
	•	app-сервер не должен быть файловым хранилищем
	•	при переезде/масштабировании файлы теряются или мигрируются болезненно
	•	это ломает горизонтальное масштабирование
	•	backup и lifecycle сложнее

Как должно быть

Нужно писать так:
	•	файлы загружаются через backend upload flow или presigned URL
	•	физически хранятся в S3-compatible storage
	•	в PostgreSQL хранится metadata + object key + URL/derivatives

⸻

2.4. JWT с storeId в токене - это уже слишком узко

Сейчас у вас логика такая:

backend читает JWT, достает storeId

С учетом новой модели это нужно пересмотреть.

Что лучше

JWT должен содержать минимум:
	•	userId
	•	tenantId
	•	membershipId
	•	role
	•	возможно sessionId

Но не строить всю модель на storeId, потому что:
	•	у tenant может быть несколько marketplace accounts
	•	storeId уже не корневая бизнес-сущность

⸻

2.5. README сейчас почти не отражает SaaS/billing/access model

А это уже один из ключевых контекстов проекта.

В README и docs должны быть отражены:
	•	multi-tenancy
	•	роли
	•	billing level
	•	early access
	•	trial
	•	referral/promo
	•	support/recovery flow
	•	anti-duplicate marketplace account binding

Сейчас этого нет.

⸻

3. Что я бы изменил в архитектуре проекта

3.1. Новая доменная модель

Я бы зафиксировал такую базовую модель:

Core
	•	User
	•	Tenant
	•	Membership

Access & Billing
	•	AccessGrant
	•	Trial
	•	Subscription
	•	TariffPlan
	•	PromoCode
	•	PromoRedemption
	•	ReferralLink
	•	ReferralReward

Marketplace
	•	MarketplaceAccount
	•	MarketplaceCredential
	•	MarketplaceSyncRun
	•	MarketplaceProductBinding

Catalog & Inventory
	•	Product
	•	Sku
	•	Warehouse
	•	StockBalance
	•	StockMovement

Finance
	•	ProductFinanceProfile
	•	ProductProfitSnapshot

Control
	•	AuditLog
	•	SecurityEvent
	•	SupportCase

⸻

3.2. Бэкенд надо разрезать по модулям, а не по “фичам без границ”

Сейчас у вас NestJS, и это отлично. Но важно, чтобы внутри apps/api была не просто “куча модулей”, а сильные bounded contexts.

Я бы строил так:

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
├─ common/
│  ├─ guards/
│  ├─ decorators/
│  ├─ interceptors/
│  ├─ filters/
│  ├─ pipes/
│  └─ utils/
├─ config/
├─ db/
├─ jobs/
└─ main.ts

Почему так лучше
	•	понятные границы ответственности
	•	проще AI-assisted разработка
	•	проще тесты
	•	меньше chance на связанный монолит-хаос

⸻

3.3. Worker надо выделить в отдельное приложение

С учетом вашего контекста это уже не optional.

Сейчас у вас только:
	•	apps/api
	•	apps/web

Но с учетом:
	•	парсинга каждую минуту
	•	sync jobs
	•	retries
	•	email jobs
	•	batch updates

вам нужен:

apps/worker/

В нем:
	•	consumers
	•	cron/scheduler
	•	sync processors
	•	retry handlers
	•	queue runners

Это надо вынести из api, иначе backend будет захлебываться.

⸻

3.4. Фронтенд тоже надо структурировать взрослее

Сейчас просто apps/web - это нормально как top-level. Но внутри вам уже нужна не flat-папка.

Я бы рекомендовал:

apps/web/src/
├─ app/
├─ pages/
├─ widgets/
├─ features/
├─ entities/
├─ processes/
└─ shared/

Логика
	•	entities - user, tenant, product, sku, subscription
	•	features - sign-in, connect-marketplace, create-product, adjust-stock
	•	processes - onboarding, purchase-plan, invite-user
	•	widgets - tables, summaries, layout blocks
	•	shared - ui, api, hooks, utils, config

Это сильно лучше для роста, чем просто components/pages/services.

⸻

4. Как должна выглядеть новая структура монорепы

Вот как я бы рекомендовал перестроить репозиторий.

skladoptima/
├─ apps/
│  ├─ api/
│  ├─ web/
│  ├─ worker/
│  └─ landing/              # optional later, если отделите лендинг
│
├─ packages/
│  ├─ ui/
│  ├─ types/
│  ├─ validation/
│  ├─ api-contracts/
│  ├─ config/
│  ├─ utils/
│  └─ logger/
│
├─ docs/
│  ├─ product/
│  ├─ architecture/
│  ├─ database/
│  ├─ engineering/
│  └─ support/
│
├─ infra/
│  ├─ docker/
│  ├─ deploy/
│  ├─ nginx/
│  └─ monitoring/
│
├─ scripts/
├─ tests/
├─ docker-compose.yml
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md


⸻

5. Что бы я поменял в README концептуально

Сейчас README слишком “маркетингово-объясняющий”

Он полезный, но пока не как инженерный корневой документ.

README в репозитории должен делать 5 вещей:
	1.	быстро объяснить, что это за проект
	2.	показать структуру репозитория
	3.	показать high-level архитектуру
	4.	показать как запустить локально
	5.	сослаться на ключевые docs

Сейчас у вас много объяснений “что такое React / NestJS”, но уже не хватает:
	•	реальной доменной модели
	•	module boundaries
	•	access model
	•	infra baseline
	•	worker layer
	•	S3 instead of local files

⸻

Я бы переписал README так

Блоки README:
	1.	Что такое SkladOptima
	2.	Core domain model
	3.	Repo structure
	4.	High-level architecture
	5.	Local development
	6.	Environment variables
	7.	Main docs map

⸻

6. Что надо исправить в README обязательно

Заменить Store на Tenant + MarketplaceAccount

Сейчас это must-fix.

Убрать “картинки хранятся на сервере”

Заменить на S3-based flow.

Добавить worker

Сейчас worker в README отсутствует, а по факту он обязателен.

Добавить access model

Нужно указать, что:
	•	роль != коммерческий доступ
	•	subscription принадлежит tenant
	•	early access / trial / paid - это access states

Добавить multi-tenant wording точнее

Не “storeId из JWT”, а tenant-aware authorization model.

⸻

7. Что бы я поменял в naming

Я бы прямо сейчас начал уходить от слова Store как корневого агрегата.

Лучше:
	•	Tenant
	•	Workspace
	•	MarketplaceAccount
	•	Warehouse

Почему

Потому что “store” у вас сейчас перегруженное слово:
	•	магазин как клиентская компания
	•	магазин как кабинет WB/Ozon
	•	склад как место хранения
	•	storefront как витрина

Это приведет к путанице в коде и документации.

⸻

8. Что уже сейчас выглядит рискованно

8.1. Prisma как единственный слой без дисциплины границ

Prisma - ок. Но если все сервисы начнут напрямую бить Prisma куда хотят, получится жирный связанный монолит.

Нужно правило

Доступ к данным через module services/repositories, а не “любой модуль дергает любые модели”.

⸻

8.2. Логика tenant isolation только через guards

Guards важны, но этого мало.

Нужно:
	•	tenant-aware services
	•	tenant-aware queries
	•	индексы по tenantId
	•	явные domain boundaries
	•	audit privileged access

⸻

8.3. Audit только вокруг списания товаров

Audit должен быть шире.

Нужно писать audit не только для склада, но и для:
	•	регистрации
	•	приглашений
	•	ролей
	•	подписок
	•	promo/referral
	•	подключения marketplace account
	•	security-sensitive changes

⸻

9. Что нужно добавить в docs в первую очередь

Сейчас я бы поставил такой порядок.

P0
	•	docs/architecture/domain-model.md
	•	docs/architecture/module-boundaries.md
	•	docs/architecture/multi-tenancy.md
	•	docs/architecture/access-model.md
	•	docs/architecture/infra-baseline-v1.md

P1
	•	docs/database/schema-overview.md
	•	docs/product/core-flows/registration-onboarding.md
	•	docs/product/core-flows/marketplace-connection.md
	•	docs/product/core-flows/early-access-trial-billing.md

P2
	•	docs/engineering/repo-structure.md
	•	docs/engineering/testing-strategy.md
	•	docs/engineering/observability.md

⸻

10. Мой итоговый архитектурный вердикт

Что хорошо
	•	стек выбран удачно
	•	monorepo - правильно
	•	NestJS + Prisma + Postgres - ок
	•	React + Vite - ок
	•	Docker Compose - ок

Что слабо
	•	доменная модель в README устарела
	•	Store как корень - уже неверно
	•	worker не выделен
	•	S3 flow не отражен
	•	access/billing model почти не отражена
	•	multi-tenancy описана слишком упрощенно

Что опасно
	•	оставлять storeId центральным понятием
	•	хранить картинки на app server
	•	не отделить worker
	•	не развести role vs access state
	•	не оформить docs по новой модели до активной разработки

⸻

11. Что я рекомендую сделать следующим шагом

Правильный следующий шаг не “сразу кодить”, а сделать 3 артефакта:

1. Переписать корневой README

Под новую реальную модель.

2. Зафиксировать новую repo structure v1

С apps/worker, packages/*, новой логикой docs.

3. Зафиксировать domain model v1

С Tenant, Membership, MarketplaceAccount, AccessGrant и так далее.

⸻

12. Прямой ответ на твой вопрос

Да, текущий репозиторий нужно менять. Не радикально по стеку, а радикально по доменной модели, структуре модулей и документации.

Что я бы оставил
	•	NestJS
	•	TypeScript
	•	Prisma
	•	PostgreSQL
	•	React
	•	Vite
	•	Tailwind
	•	monorepo

Что я бы изменил
	•	Store -> Tenant + MarketplaceAccount
	•	добавить apps/worker
	•	убрать local file storage в пользу S3 model
	•	переписать README
	•	обновить docs под SaaS access/billing/multi-tenancy model
	•	переразложить backend по bounded modules
	•	усилить frontend structure
