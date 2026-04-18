# Testing Patterns

**Analysis Date:** 2026-04-18

## Test Framework

**Runner (API):**
- Jest `^30.0.0`
- Config: inline in `apps/api/package.json` (jest key) for unit tests
- Config: `apps/api/test/jest-e2e.json` for e2e tests
- Transform: `ts-jest ^29.2.5`

**Assertion Library:**
- Jest built-in (`expect`)

**Run Commands:**
```bash
# From apps/api/
npm run test              # Run all unit tests (*.spec.ts in src/)
npm run test:watch        # Watch mode
npm run test:cov          # With coverage report
npm run test:e2e          # Run e2e tests (*.e2e-spec.ts in test/)
npm run test:debug        # Debug mode with --inspect-brk
```

**Web Testing:**
- No test framework configured in `apps/web/package.json`
- No test files present in `apps/web/src/`
- Web app is untested

## Test File Organization

**Location (API):**
- Unit tests: co-located with source in `apps/api/src/` — `*.spec.ts` pattern
- E2E tests: separate directory `apps/api/test/` — `*.e2e-spec.ts` pattern

**Naming:**
- Unit: `<name>.spec.ts` (e.g., `app.controller.spec.ts`)
- E2E: `<name>.e2e-spec.ts` (e.g., `app.e2e-spec.ts`)

**Current test files:**
```
apps/api/src/
└── app.controller.spec.ts    # Only unit test file

apps/api/test/
├── app.e2e-spec.ts           # Only e2e test file
└── jest-e2e.json             # E2E jest config
```

## Test Structure

**Unit test pattern (from `app.controller.spec.ts`):**
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

**E2E test pattern (from `test/app.e2e-spec.ts`):**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

## Jest Configuration

**Unit test config (from `apps/api/package.json`):**
```json
{
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

**E2E config (`apps/api/test/jest-e2e.json`):**
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

## Mocking

**Framework:** NestJS `Test.createTestingModule` for building isolated test modules.

**Pattern observed:**
- Real providers used in the only existing unit test (no mocks present)
- For integration-style unit tests the full module is assembled with real dependencies
- No `jest.mock()`, `jest.fn()`, or `jest.spyOn()` patterns found in any test file

**Supertest:** Used in e2e tests to make HTTP requests against a real NestJS app instance:
```typescript
import request from 'supertest';
// ...
return request(app.getHttpServer()).get('/').expect(200);
```

## Coverage

**Requirements:** None enforced — no coverage thresholds configured
**Coverage output directory:** `apps/api/coverage/` (generated, not committed)

**View coverage:**
```bash
cd apps/api && npm run test:cov
```

**Collected from:** All `*.ts` and `*.js` files under `apps/api/src/` via `collectCoverageFrom: ["**/*.(t|j)s"]`

## Test Types

**Unit Tests:**
- Scope: Single controller or service in isolation
- Location: `apps/api/src/**/*.spec.ts`
- Current coverage: 1 file — `app.controller.spec.ts` only (NestJS scaffold default)
- Business modules (`auth`, `catalog`, `analytics`, `audit`, `marketplace_sync`, `finance`) have NO unit tests

**Integration Tests:**
- Not present (no dedicated integration test setup)

**E2E Tests:**
- Scope: Full NestJS app with HTTP request/response cycle via supertest
- Location: `apps/api/test/*.e2e-spec.ts`
- Current coverage: 1 file — `app.e2e-spec.ts` only (NestJS scaffold default, tests `GET /`)
- No business e2e tests covering auth, products, sync, etc.

**Web Tests:**
- None. No test runner configured in `apps/web/`.

## Current State Summary

The codebase has minimal test coverage. Both existing test files (`app.controller.spec.ts` and `app.e2e-spec.ts`) are unchanged NestJS scaffold defaults testing only the root `AppController`. No business logic, services, or API endpoints are covered by tests.

**What is NOT tested:**
- `apps/api/src/modules/auth/` — authentication, JWT, Telegram linking
- `apps/api/src/modules/catalog/` — product CRUD, stock adjustment, WB import
- `apps/api/src/modules/marketplace_sync/` — WB/Ozon sync logic
- `apps/api/src/modules/analytics/` — ABC/XYZ analysis, recommendations
- `apps/api/src/modules/audit/` — audit log writes
- `apps/api/src/modules/finance/` — finance calculations
- `apps/web/src/` — all React components and pages

## Adding New Tests

**New unit test for a service:**
- Create `apps/api/src/modules/<domain>/<name>.service.spec.ts`
- Use `Test.createTestingModule` with mocked `PrismaService` and dependencies
- Follow the `describe(ClassName) > describe(methodName) > it(behavior)` nesting

**New e2e test:**
- Add to `apps/api/test/` as `<feature>.e2e-spec.ts`
- Spin up full `AppModule`, use supertest to hit real endpoints
- Requires a test database (DATABASE_URL env var must point to a test DB)

---

*Testing analysis: 2026-04-18*
