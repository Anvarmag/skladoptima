# Coding Conventions

**Analysis Date:** 2026-04-25

## Общее

Проект — npm workspaces монорепо:
- `apps/api` — NestJS backend (TypeScript, CommonJS modules)
- `apps/web` — React + Vite frontend (TypeScript, ESM modules)

Каждое приложение имеет собственный ESLint-конфиг. Prettier настроен только для API.

---

## Naming Patterns

### Файлы

**API (`apps/api/src`):**
- Модули: `<domain>.<type>.ts` — `auth.service.ts`, `product.controller.ts`, `jwt-auth.guard.ts`
- DTO: `<action>-<entity>.dto.ts` — `create-product.dto.ts`, `update-product.dto.ts`, `adjust-stock.dto.ts`
- Декораторы: `<name>.decorator.ts` — `public.decorator.ts`
- Стратегии: `<strategy-name>.strategy.ts` — `jwt.strategy.ts`
- Тесты: `<name>.spec.ts` (unit), `<name>.e2e-spec.ts` (e2e)

**Web (`apps/web/src`):**
- Страницы: PascalCase без суффикса — `Products.tsx`, `Login.tsx`, `Orders.tsx`
- Контексты: `<Name>Context.tsx` — `AuthContext.tsx`
- Лейауты: `<Name>Layout.tsx` — `MainLayout.tsx`

### Классы

- NestJS-классы: PascalCase — `AuthService`, `ProductController`, `JwtAuthGuard`
- React-компоненты: PascalCase — `Products`, `AuthProvider`, `MainLayout`
- TypeScript-интерфейсы: PascalCase без `I`-префикса — `User`, `Product`, `AuthContextType`

### Функции и методы

- camelCase везде — `validateUser`, `findAll`, `adjustStock`
- React обработчики: `handle<Action>` — `handleLogin`, `handleSave`, `handleDelete`
- React методы открытия модалей: `open<Name>` — `openCreate`, `openEdit`
- Fetching данных: `fetch<Entity>` — `fetchProducts`, `fetchSettings`

### Переменные

- camelCase
- Булевые: `isModalOpen`, `loading`, `isTelegram`
- ID-значения: суффикс `Id` — `tenantId`, `actorUserId`, `productId`
- Константы в сервисах: `UPPER_SNAKE_CASE` — `COOLDOWN_MS`, `INTERVAL_MS`
- Ключи декораторов: camelCase — `IS_PUBLIC_KEY`

---

## Code Style

### Форматирование (API — Prettier)

Конфиг `apps/api/.prettierrc`:
```json
{
  "singleQuote": true,
  "trailingComma": "all"
}
```

- Одинарные кавычки
- Trailing comma везде (функции, объекты, массивы)

### ESLint (API)

Конфиг: `apps/api/eslint.config.mjs`
- `@typescript-eslint/no-explicit-any`: **off** — `any` разрешён (используется широко)
- `@typescript-eslint/no-floating-promises`: **warn**
- `@typescript-eslint/no-unsafe-argument`: **warn**
- База: `@eslint/js recommended` + `typescript-eslint recommendedTypeChecked`

### ESLint (Web)

Конфиг: `apps/web/eslint.config.js`
- `@eslint/js recommended` + `typescript-eslint recommended`
- `eslint-plugin-react-hooks` — правила хуков
- `eslint-plugin-react-refresh` — Vite refresh rules
- Prettier не подключён для web

---

## Import Organization

### API (фактический порядок)

1. `@nestjs/...` — NestJS
2. `@prisma/client`
3. Внешние пакеты (`bcrypt`, `axios`, `passport-jwt`)
4. Внутренние относительные импорты

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
```

### Web

1. React hooks (`useState`, `useEffect`)
2. Внешние пакеты (`axios`, `lucide-react`, `react-router-dom`)
3. Внутренние (`../context/AuthContext`, `../layouts/MainLayout`)

**Path aliases не используются** — только относительные пути.

---

## Error Handling

### API

Бросать типизированные NestJS HTTP-исключения из сервисов:
```typescript
throw new NotFoundException('Product not found or access denied');
throw new BadRequestException('User with this email already exists');
throw new UnauthorizedException('Invalid email or password');
```

- `NotFoundException` — ресурс не найден или tenant mismatch
- `BadRequestException` — нарушена бизнес-логика (дубликат SKU, отрицательный остаток)
- `UnauthorizedException` — провалена аутентификация

Внешние API (WB, Ozon) — catch → logger.error → return `{ success: false, error }` (не бросать):
```typescript
} catch (err) {
    const e = err as AxiosError;
    const errorMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    await this.updateMarketplaceStatus(tenantId, 'WB', errorMsg);
    return { success: false, error: e.message, body: e.response?.data };
}
```

### Web

```typescript
} catch (err: any) {
    const msg = err.response?.data?.message;
    setError(msg || 'Ошибка входа');
}
```

- `err.response?.data?.message` — стандартный способ читать ошибку от NestJS
- Критические ошибки в CRUD: `alert('...')` (временное решение)

---

## Logging

### API

Используется `Logger` из `@nestjs/common`:
```typescript
private readonly logger = new Logger(UserService.name);

this.logger.log(`Created default admin user: ${email}`);
this.logger.warn(`Background poll error: ${e?.message}`);
this.logger.error(`[Store ${tenantId}] Ozon Pull Loop error: ${e.message}`);
```

Формат в SyncService: `[Store {tenantId}] [Контекст] Действие`

Используют Logger: `UserService`, `FinanceService`, `SyncService`, `AnalyticsService`.

### Web

`console.log()` / `console.error()` — без специальных библиотек.

---

## Multi-Tenancy Pattern

Все данные изолированы по `tenantId`:

1. `tenantId` берётся из JWT через `req.user.tenantId` в контроллере
2. Передаётся в сервис параметром
3. Используется в каждом Prisma-запросе `where: { tenantId, ... }`

```typescript
// Контроллер
return this.productService.findAll(req.user.tenantId, ...);

// Сервис
const where = { tenantId, deletedAt: null };
```

Текущее ограничение: `tenantId` берётся из `memberships?.[0]?.tenantId` — один тенант на пользователя.

---

## Soft Delete Pattern

```typescript
// Удаление
await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });

// Запросы — всегда фильтровать
where: { tenantId, deletedAt: null }

// Восстановление при создании с существующим SKU
data: { deletedAt: null }
```

---

## Service Method Signature Convention

```typescript
async adjustStock(id: string, delta: number, actorUserId: string, tenantId: string, note?: string)
async create(dto: CreateProductDto, photoPath: string | null, actorUserId: string, tenantId: string)
async remove(id: string, actorUserId: string, tenantId: string)
```

- `tenantId` — последний обязательный параметр
- `actorUserId` — предпоследний

### Возвращаемые значения сервисов

- Paginated списки: `{ data: T[], meta: { total, page, lastPage } }`
- Sync-операции: `{ success: boolean, error?: string }`
- Простые мутации: объект Prisma
- Удаление: `{ message: 'X deleted successfully' }`
- Импорт: `{ success: true, created: number, updated: number }`

---

## Prisma Transactions

Используются для составных операций:
```typescript
return this.prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ ... });
    const user = await tx.user.create({ ... });
    await tx.membership.create({ ... });
    return tx.user.findUnique({ where: { id: user.id }, include: { ... } });
});
```

---

## Comments

- Русскоязычные комментарии для бизнес-логики и нетривиальных мест
- JSDoc только в `FinanceService` и `AnalyticsService` для сложных публичных методов
- Секции в больших файлах: ASCII-разделители `// ─── Section Name ──────`

---

*Conventions analysis: 2026-04-25*
*Update when significant style changes are introduced*
