Ниже даю конкретный список изменений по порядку, без воды - что именно надо поменять, чтобы ваш текущий репозиторий стал нормальной базой под SkladOptima.

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

