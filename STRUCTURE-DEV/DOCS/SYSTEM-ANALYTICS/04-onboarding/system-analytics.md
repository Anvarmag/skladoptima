# Онбординг — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль управляет первичным ознакомительным flow после входа: шаги, прогресс, skip/close, повторное открытие, CTA на интеграции и поддержку.

## 2. Функциональный контур и границы

### Что входит в модуль
- хранение состояния onboarding по tenant и/или пользователю;
- каталог шагов, обязательность шагов и условия завершения;
- resume механика между сессиями;
- фиксация факта прохождения ключевых activation milestones;
- связка onboarding с первыми полезными действиями: интеграция, sync, каталог.

### Что не входит в модуль
- сам auth-flow, tenant creation и team management;
- логика каталогов, sync или billing;
- полноценная CMS-система для контента onboarding;
- сложный experiment engine beyond feature flags.

### Главный результат работы модуля
- новый tenant не теряется после регистрации, а проходит управляемый путь к первому полезному результату с наблюдаемыми шагами и точками отваливания.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner | Проходит полный onboarding tenant | Основной target actor |
| Admin/Manager | Может видеть или продолжить часть шагов | Доступ зависит от роли и стадии tenant |
| Product/Frontend | Управляет отображением шагов | Не должен хранить state только на клиенте |
| System integrations | Подтверждают выполнение шагов фактом действия | Например, `account connected`, `first sync success` |

## 4. Базовые сценарии использования

### Сценарий 1. Первый вход нового tenant
1. После tenant creation определяется стартовый onboarding plan.
2. Backend возвращает первый обязательный шаг и прогресс.
3. Клиент показывает wizard/checklist.
4. По мере действий прогресс фиксируется на backend.

### Сценарий 2. Resume после выхода
1. Пользователь повторно открывает продукт.
2. Клиент запрашивает onboarding state.
3. Backend возвращает последний незавершенный шаг, completed steps и allowed skips.
4. Пользователь продолжает с того места, где остановился.

### Сценарий 3. Автоматическое завершение шага по событию
1. Внешний модуль сообщает о milestone, например `marketplace account connected`.
2. Onboarding service сопоставляет событие с step rule.
3. Шаг закрывается автоматически.
4. Пользователь видит новый прогресс без ручного подтверждения.

## 5. Зависимости и интеграции

- Auth/Tenant (контекст пользователя и tenant)
- Marketplace Accounts (CTA на подключение)
- Sync (CTA на первый sync)
- Notifications/Support (канал связи)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/onboarding/state` | User | Текущее состояние онбординга |
| `POST` | `/api/v1/onboarding/start` | User | Явный старт onboarding |
| `PATCH` | `/api/v1/onboarding/steps/:stepKey` | User | Завершить/пропустить шаг |
| `POST` | `/api/v1/onboarding/close` | User | Закрыть onboarding |
| `POST` | `/api/v1/onboarding/reopen` | User | Повторно открыть |
| `POST` | `/api/v1/onboarding/complete` | User | Отметить onboarding завершенным |

## 7. Примеры вызова API

```bash
curl -X PATCH /api/v1/onboarding/steps/connect_marketplace \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"status":"SKIPPED","comment":"Сделаю позже"}'
```

```json
{
  "stepKey": "connect_marketplace",
  "status": "SKIPPED",
  "progress": { "done": 1, "total": 4 }
}
```

## 8. Модель данных (PostgreSQL)

### `onboarding_states`
- `id UUID PK`
- `tenant_id UUID FK`
- `user_id UUID FK`
- `status ENUM(not_started, in_progress, skipped, completed)`
- `started_at`, `completed_at`, `closed_at`
- `last_step_key VARCHAR(64) NULL`
- `UNIQUE(tenant_id, user_id)`

### `onboarding_step_progress`
- `id UUID PK`
- `onboarding_state_id UUID FK`
- `step_key VARCHAR(64)`
- `status ENUM(pending, viewed, done, skipped)`
- `updated_at`
- `UNIQUE(onboarding_state_id, step_key)`

## 9. Сценарии и алгоритмы (step-by-step)

1. После login без данных onboarding создать/прочитать `onboarding_state`.
2. Каждый шаг при просмотре фиксируется как `viewed`.
3. Пользователь завершает шаг (`done`) или пропускает (`skipped`).
4. `complete` доступен и при `skipped` части шагов (по BRD не блокирующий).
5. `reopen` возвращает состояние `in_progress` с сохранением истории шагов.

## 10. Валидации и ошибки

- `step_key` только из фиксированного списка.
- Нельзя `complete` без `start`.
- Ошибки:
  - `NOT_FOUND: ONBOARDING_STATE_NOT_FOUND`
  - `VALIDATION_ERROR: INVALID_STEP_KEY`
  - `CONFLICT: ONBOARDING_ALREADY_COMPLETED`

## 11. Чеклист реализации

- [ ] Миграции onboarding-таблиц.
- [ ] Endpoint состояния + update по шагам.
- [ ] Идемпотентность повторных кликов по шагам.
- [ ] События трекинга `opened/step_viewed/skipped/completed`.
- [ ] e2e-сценарии skip/reopen/complete.

## 12. Критерии готовности (DoD)

- Онбординг не блокирует работу приложения.
- Повторное открытие доступно из UI.
- Прогресс хранится консистентно между сессиями.

## 13. Каталог шагов onboarding

### Рекомендуемые `step_key`
- `welcome`
- `setup_company`
- `connect_marketplace`
- `import_catalog`
- `run_first_sync`
- `open_support`

### Что хранить по шагу
- `step_key`
- `status`
- `first_viewed_at`
- `completed_at`
- `skipped_at`
- `metadata JSONB`

## 14. Контракт backend/frontend

### Что определяет backend
- перечень шагов
- порядок шагов
- состояние и прогресс
- разрешенные статусы перехода

### Что делает frontend
- визуальный wizard/progress bar
- локальный UX шага
- CTA на соседние модули

## 15. Async события и трекинг

- `onboarding_started`
- `onboarding_step_viewed`
- `onboarding_step_completed`
- `onboarding_step_skipped`
- `onboarding_closed`
- `onboarding_reopened`
- `onboarding_completed`

### Что должно быть асинхронным
- аналитический event tracking
- рекомендательные напоминания пользователю о незавершенном onboarding

## 16. Тестовая матрица

- Первый вход пользователя без tenant.
- Повторный вход с незавершенным onboarding.
- Skip одного шага.
- Полное закрытие onboarding.
- Повторное открытие после `completed`.
- Параллельные сессии одного пользователя.

## 17. Фазы внедрения

1. `onboarding_states` и `onboarding_step_progress`.
2. State API и idempotent step updates.
3. Frontend wizard и progress bar.
4. Event tracking и напоминания.
5. Ролевые/контекстные расширения future-ready.

## 18. Нефункциональные требования и SLA

- Чтение onboarding state должно быть быстрым: `p95 < 250 мс`.
- Progress update не должен теряться при повторных открытиях и одновременных действиях из нескольких вкладок.
- Каталог шагов должен поддерживать versioning, чтобы изменение продукта не ломало старые tenant cohort.
- Onboarding UI не должен быть единственным источником истины о прохождении шагов.

## 19. Observability, логи и алерты

- Метрики: `onboarding_started`, `step_completed`, `step_skipped`, `resume_count`, `time_to_first_integration`, `time_to_first_sync`.
- Логи: state transitions по шагам, auto-completion events, reopen/resume flows.
- Алерты: массовое зависание на одном шаге, auto-complete failures, рост abandon rate после релиза.
- Dashboards: onboarding funnel, step drop-off board, activation milestones board.

## 20. Риски реализации и архитектурные замечания

- Нельзя зашивать состояние шагов только на frontend, иначе после logout/refresh onboarding станет непредсказуемым.
- Обязательные и необязательные шаги должны быть явно разделены, иначе completion metric будет ложной.
- Onboarding должен опираться на доменные события, а не на “пользователь нажал кнопку продолжить”.
- При изменении набора шагов нужна стратегия миграции уже существующих progress records.
