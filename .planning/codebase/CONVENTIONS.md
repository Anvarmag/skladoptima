# Coding Conventions

**Analysis Date:** 2026-04-18

## Naming Patterns

**Files:**
- API: `kebab-case` for all files — `auth.service.ts`, `jwt-auth.guard.ts`, `product.module.ts`
- API DTOs: `kebab-case` with action prefix — `create-product.dto.ts`, `adjust-stock.dto.ts`
- Web: `PascalCase` for React components — `Products.tsx`, `MainLayout.tsx`, `AuthContext.tsx`
- Web non-component TS files: `camelCase` — `main.tsx`, `vite.config.ts`

**Classes (API):**
- Services: `PascalCase` + `Service` suffix — `ProductService`, `AuditService`, `AuthService`
- Controllers: `PascalCase` + `Controller` suffix — `ProductController`, `AuthController`
- Modules: `PascalCase` + `Module` suffix — `ProductModule`, `AuthModule`
- Guards: `PascalCase` + `Guard` suffix — `JwtAuthGuard`
- DTOs: `PascalCase` + `Dto` suffix — `CreateProductDto`, `LoginDto`
- Strategies: `PascalCase` + `Strategy` suffix — `JwtStrategy`

**React Components (Web):**
- Function components: `PascalCase` — `function Products()`, `function PrivateRoute()`
- Context providers: `PascalCase` + `Provider` suffix — `AuthProvider`
- Custom hooks: `camelCase` with `use` prefix — `useAuth`

**Variables and Functions:**
- `camelCase` throughout both apps
- Boolean state flags use descriptive names — `isModalOpen`, `isAdjustOpen`, `loading`
- Async functions are named with verb+noun — `fetchProducts`, `handleSave`, `checkAuth`
- Event handlers prefixed with `handle` — `handleSave`

**Types and Interfaces:**
- `PascalCase` — `interface Product`, `interface AuthContextType`, `interface User`
- Defined inline at the top of the file that uses them (no shared types barrel in web)

## Code Style

**Formatting:**
- Tool: Prettier (API: `prettier ^3.4.2`, Web: not explicitly listed but implied by eslint-plugin-prettier in API)
- API: `endOfLine: "auto"` (cross-platform line endings)
- Indentation: 4 spaces (observed in all source files)

**Linting (API):**
- Tool: ESLint flat config (`apps/api/eslint.config.mjs`)
- Base: `@eslint/js` recommended + `typescript-eslint` recommended (type-checked) + `eslint-plugin-prettier`
- `@typescript-eslint/no-explicit-any`: **off** — `any` is permitted and used widely
- `@typescript-eslint/no-floating-promises`: warn
- `@typescript-eslint/no-unsafe-argument`: warn

**Linting (Web):**
- Tool: ESLint flat config (`apps/web/eslint.config.js`)
- Base: `@eslint/js` recommended + `typescript-eslint` recommended + `react-hooks` + `react-refresh`
- No Prettier plugin in web — formatting not enforced by linter

**TypeScript Strictness (API):**
- `strictNullChecks: true`
- `noImplicitAny: true`
- `strictBindCallApply: true`
- `emitDecoratorMetadata: true` (required for NestJS DI)
- `experimentalDecorators: true`
- Target: `ES2023`, module: `nodenext`

## Import Organization

**API pattern (observed):**
1. NestJS framework imports (`@nestjs/common`, `@nestjs/core`)
2. Local service/module imports (relative paths)
3. DTO imports (relative paths)
4. Prisma/third-party imports (`@prisma/client`, `bcrypt`, `crypto`)

**Web pattern (observed):**
1. React and hooks (`react`, named imports)
2. Third-party libraries (`axios`, `lucide-react`, `react-router-dom`)
3. Local context/hooks
4. Local components and pages

**Path Aliases:** None configured. All imports use relative paths (`../../prisma/prisma.service`).

## NestJS Patterns (API)

**Dependency Injection:**
- Constructor injection via `private readonly` — always `readonly`
- Example:
```typescript
constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
) { }
```

**Decorators:**
- Controllers: `@Controller('route')` at class, HTTP verb decorators on methods
- Services: `@Injectable()` on class
- Guards applied at class or method level via `@UseGuards()`
- Custom `@Public()` decorator used to opt out of global JWT guard

**Multi-tenancy pattern:**
- `tenantId` extracted from JWT payload on every request via `req.user.tenantId`
- Passed explicitly as parameter into every service method — no global context
- All Prisma queries include `where: { tenantId }` scope

**Error handling:**
- Throw NestJS built-in HTTP exceptions directly from services — `NotFoundException`, `BadRequestException`, `UnauthorizedException`
- No global error transform middleware observed

**Pagination pattern (standard across services):**
```typescript
async findAll(tenantId: string, page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const [data, totalCount] = await Promise.all([...]);
    return { data, meta: { total, page, lastPage } };
}
```

**Soft delete pattern:**
- `deletedAt: DateTime?` field on `Product`
- All queries filter `where: { deletedAt: null }`
- Delete sets `deletedAt: new Date()`, not hard delete
- Create re-checks for soft-deleted records and restores them

**Audit logging:**
- Every mutating operation calls `auditService.logAction()` after the Prisma operation
- Pattern: fetch → mutate → log audit

## Logging

**API Framework:** NestJS `Logger`
- Used in services that need logging: `private readonly logger = new Logger(ServiceName.name);`
- Not used in all services — `AuditService` and `ProductService` use no logger; `AnalyticsService` uses `Logger`

**Web:** `console.error()` for catch blocks, no structured logging

## React Patterns (Web)

**Component structure:**
- All components are default-exported function declarations
- State defined at top of function body with `useState`
- `useEffect` used for data fetching, with cleanup functions for timers
- Inline event handlers passed as props (no separate handler files)

**Data fetching:**
- Direct `axios` calls inside components (no abstraction layer/custom hooks for API calls)
- Global axios config set in `AuthContext.tsx`: `axios.defaults.baseURL` and `axios.defaults.withCredentials = true`

**TypeScript in React:**
- Interfaces defined locally at top of each page file
- `any` used in some places (e.g., `res: any` in controller, `error: any` in catch blocks)

## Comments

**Style observed:**
- Inline Russian-language comments for business logic context — `// Cookie для авторизации`, `// 7 дней`
- English comments for technical/code-level explanations — `// Check for any product with this SKU, including deleted ones`
- JSDoc used selectively on service methods (`/** Perform ABC/XYZ analysis */`)
- No consistent JSDoc coverage required

## Module Design

**Exports:**
- API: Each NestJS module explicitly declares `imports`, `controllers`, `providers`, and `exports` arrays
- Web: Single default export per file; no barrel (`index.ts`) files observed

---

*Convention analysis: 2026-04-18*
