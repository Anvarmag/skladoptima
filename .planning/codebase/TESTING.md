# Testing Patterns

**Analysis Date:** 2026-04-25

## Test Framework

**Runner:** Jest `^30.0.0`
**Config:** встроен в `apps/api/package.json` (секция `"jest"`)
**E2E Config:** `apps/api/test/jest-e2e.json`
**Transform:** `ts-jest` для TypeScript

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "collectCoverageFrom": ["**/*.(t|j)s"],
  "coverageDirectory": "../coverage",
  "testEnvironment": "node"
}
```

## Run Commands

```bash
# Из apps/api/
npm run test          # Все unit-тесты (*.spec.ts)
npm run test:watch    # Watch mode
npm run test:cov      # С покрытием → coverage/
npm run test:debug    # node --inspect-brk
npm run test:e2e      # E2E-тесты (*.e2e-spec.ts)
```

---

## Test File Organization

### Unit Tests
- **Расположение:** co-located рядом с тестируемым файлом
- **Naming:** `<name>.spec.ts`
- Пример: `apps/api/src/app.controller.spec.ts`

### E2E Tests
- **Расположение:** `apps/api/test/`
- **Naming:** `<name>.e2e-spec.ts`
- Пример: `apps/api/test/app.e2e-spec.ts`

### Frontend
Тестирование `apps/web` **не настроено** — нет jest/vitest конфига, нет тест-файлов.

---

## Current Coverage State

**Крайне низкое.** Существуют только scaffold-тесты:

| Файл | Тип | Что тестирует |
|------|-----|---------------|
| `src/app.controller.spec.ts` | Unit | `AppController.getHello()` — "Hello World!" |
| `test/app.e2e-spec.ts` | E2E | `GET /` → 200 |

**Бизнес-логика (ProductService, AuthService, SyncService, FinanceService, AnalyticsService) не покрыта тестами.**

---

## Existing Test Patterns

### Unit Test (шаблон)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
```

### E2E Test (шаблон)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/').expect(200);
  });
});
```

---

## Mocking Patterns

### Mock Prisma Service

```typescript
const mockPrismaService = {
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

const app = await Test.createTestingModule({
  providers: [
    ProductService,
    { provide: PrismaService, useValue: mockPrismaService },
    { provide: AuditService, useValue: { logAction: jest.fn() } },
  ],
}).compile();
```

### Error Testing

```typescript
it('should throw NotFoundException when product not found', async () => {
  mockPrisma.product.findUnique.mockResolvedValue(null);
  await expect(
    service.findOne('non-existent-id', 'tenant-id')
  ).rejects.toThrow(NotFoundException);
});

it('should throw BadRequestException when SKU already exists', async () => {
  mockPrisma.product.findFirst.mockResolvedValue({ ...mockProduct, deletedAt: null });
  await expect(
    service.create(createDto, null, 'user@example.com', 'tenant-id')
  ).rejects.toThrow(BadRequestException);
});
```

---

## Fixtures / Test Data

Специальных фабрик нет. Рекомендуемый паттерн при добавлении тестов:

```typescript
const createMockProduct = (overrides?: Partial<Product>) => ({
  id: 'test-product-id',
  sku: 'TEST-SKU-001',
  name: 'Test Product',
  total: 100,
  reserved: 0,
  tenantId: 'test-tenant-id',
  deletedAt: null,
  ...overrides,
});
```

---

## Priority Coverage Areas

По приоритету:

1. `apps/api/src/modules/catalog/product.service.ts` — CRUD, soft-delete, restore при SKU-дублировании
2. `apps/api/src/modules/auth/auth.service.ts` — validateUser, login, Telegram flow
3. `apps/api/src/modules/auth/jwt.strategy.ts` — validate payload, tenantId extraction
4. `apps/api/src/modules/marketplace_sync/sync.service.ts` — ping-pong cooldown, reconcile-логика
5. `apps/api/src/modules/finance/finance.service.ts` — calculateUnitEconomics (налоговые расчёты)
6. `apps/api/src/modules/analytics/analytics.service.ts` — ABC-классификация, рекомендации
7. `apps/api/src/modules/users/user.service.ts` — registerUser транзакция, seedAdmin

---

*Testing analysis: 2026-04-25*
*Update as tests are added*
