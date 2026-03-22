# Проектирование Базы Данных (SaaS Архитектура)

Чтобы база данных была **максимально очевидной**, мы жестко разделяем сущности по зонам ответственности: 
1. **Люди** (Users, Roles)
2. **Компании / Аккаунты** (Stores, Referrals)
3. **Финансы / Тарифы** (SubscriptionPlans, StoreSubscriptions)

Ниже представлена обновленная схема (которую можно будет вставить в `schema.prisma`), решающая все озвученные задачи.

---

### 1. ПОЛЬЗОВАТЕЛИ И РОЛИ (Кто пользуется системой)
Пользователь — это физический человек. У человека есть роль (`Role`), определяющая его права в рамках конкретного магазина (`Store`).

```prisma
enum Role {
  OWNER    // Создатель аккаунта (полные права, доступ к оплате)
  ADMIN    // Администратор (может добавлять сотрудников, но не меняет тариф)
  MANAGER  // Менеджер (работает с товарами и остатками)
  VIEWER   // Зритель (только чтение отчетов)
}

model User {
  id         String   @id @default(uuid())
  email      String   @unique
  password   String
  telegramId String?  @unique
  createdAt  DateTime @default(now())

  // Связь: В каком магазине работает человек и кем он там является
  role       Role     @default(MANAGER)
  storeId    String
  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
}
```

---

### 2. АККАУНТЫ (МАГАЗИНЫ) И РЕФЕРАЛКА
Магазин (`Store`) — это главная сущность-контейнер (Tenant). К ней привязываются товары, подписка и сотрудники. Реферальная программа строится от магазина к магазину (одна компания пригласила другую).

```prisma
model Store {
  id             String   @id @default(uuid())
  name           String
  createdAt      DateTime @default(now())

  // --- Реферальная система ---
  referralCode   String   @unique @default(cuid()) // Наш личный код для приглашений
  bonusBalance   Int      @default(0)              // Баланс (кэшбек/бонусы) внутри системы
  
  // Кто НАС пригласил? (ссылка на другой Магазин)
  referredById   String?
  referredBy     Store?   @relation("Referrals", fields: [referredById], references: [id])
  
  // Кого МЫ пригласили? (список Магазинов)
  referrals      Store[]  @relation("Referrals")

  // --- Связи (что принадлежит этому магазину) ---
  users          User[]
  subscription   StoreSubscription? // Текущая активная подписка
  products       Product[]
  auditLogs      AuditLog[]
}
```

---

### 3. ТАРИФЫ И ПОДПИСКИ (Независимые сущности с ID)
Тарифы (`SubscriptionPlan`) хранятся прямо в базе данных. Это позволяет админам сервиса создавать новые тарифы (например "Специальный новогодний"), не меняя код приложения.

```prisma
// Типы всех доступных тарифов в системе
model SubscriptionPlan {
  id          String   @id @default(uuid())
  name        String   @unique  // "Free", "Basic", "Pro", "Enterprise"
  price       Int               // Стоимость в месяц (в рублях)
  
  // Лимиты тарифа
  maxUsers    Int               // Лимит сотрудников (например, 1 в Free, 10 в Pro)
  maxProducts Int               // Лимит товаров (0 = безлимит)

  // Кто сейчас сидит на этом тарифе
  subscriptions StoreSubscription[]
}

// Конкретная купленная подписка конкретного магазина
model StoreSubscription {
  id          String   @id @default(uuid())
  status      String   // "ACTIVE", "TRIAL", "EXPIRED", "CANCELED"
  validUntil  DateTime // До какого числа оплачено (допустим, до 20 апреля 2026)

  // Чья это подписка?
  storeId     String   @unique
  store       Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  
  // Какой именно тариф куплен?
  planId      String
  plan        SubscriptionPlan @relation(fields: [planId], references: [id])
}
```

---

### 4. ПРОМОКОДЫ
Отдельная таблица для акций и скидок (Black Friday и т.д.).

```prisma
model PromoCode {
  id             String    @id @default(uuid())
  code           String    @unique // "BLACKFRIDAY50"
  discountPercent Int?     // Скидка 50%
  maxUses        Int?      // Ограничение по кол-ву активаций
  usedCount      Int       @default(0)
  expiresAt      DateTime? // До какого числа действует
}
```

---

### Почему такая структура "Супер Очевидная"?

1. **Нет каши:** `User` знает только свой пароль, email и **свою роль**. `Store` содержит товары. Подписки вынесены отдельно.
2. **Динамические тарифы:** Поскольку `SubscriptionPlan` — это отдельная таблица со своими ID, вы можете в любой момент добавить в базу тариф `SUPER_PRO+` с новыми лимитами (например, `maxUsers = 50`), и приложение автоматически начнёт его продавать.
3. **Легкая проверка рефералов:** Легко сделать запрос: *"Покажи все магазины, которые были созданы по моему referralCode, и начисли мне за них бонус"*.
4. **Простота подписки:** Чтобы узнать, может ли магазин добавить 5-го менеджера, нужно просто сделать запрос: `Store -> StoreSubscription -> SubscriptionPlan.maxUsers >= 5`.
