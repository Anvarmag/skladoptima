# TASK_ONBOARDING_6 — Frontend Onboarding Wizard, Resume и Deep Links

> Модуль: `04-onboarding`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_ONBOARDING_2`
  - `TASK_ONBOARDING_3`
  - `TASK_ONBOARDING_4`
  - `TASK_ONBOARDING_5`
- Что нужно сделать:
  - собрать onboarding widget/wizard с progress bar, step states, close/reopen и resume;
  - обеспечить resume после refresh/logout/повторного входа;
  - сделать deep links в соседние модули: tenant creation, marketplace connect, import, sync, support;
  - не полагаться на local-only state;
  - отрисовать read-only/blocked onboarding states по backend contract.
- Критерий закрытия:
  - onboarding UX предсказуем и не теряется между сессиями;
  - пользователь может закрыть и потом открыть onboarding снова;
  - frontend не показывает CTA, если backend отметил шаг как blocked/read-only.

**Что сделано**

Реализован фронтенд онбординга. Завершено 2026-04-26.

### Новые файлы

**`apps/web/src/api/onboarding.ts`** — типизированный API-клиент: типы `OnboardingStep`, `OnboardingState`; функции `getState`, `start`, `updateStep`, `close`, `reopen`, `complete`.

**`apps/web/src/pages/OnboardingPage.tsx`** — USER_BOOTSTRAP wizard на `/onboarding` (заменил `CreateCompany`):
- Загружает state с бэкенда, при отсутствии вызывает `POST /start`
- Resume: если `lastStepKey === 'setup_company'` или шаг `VIEWED` — открывает форму сразу
- Шаг `welcome`: приветственный экран, при отображении автоматически маркирует шаг как `viewed`
- Шаг `setup_company`: встроенная форма создания компании (все поля из `CreateCompany.tsx`)
- Прогресс-индикатор сверху (dots с номерами и чекмаркой для DONE)
- После создания компании: `checkAuth()` + редирект на `/app`

**`apps/web/src/components/OnboardingWidget.tsx`** — TENANT_ACTIVATION floating widget в `/app/*`:
- Загружает state на mount; при `status === 'CLOSED'` — сворачивается
- Свёрнутый вид: кнопка-пилюля «Настройка X/N» с ChevronUp
- Развёрнутый вид: прогресс-бар, список шагов, кнопка закрытия
- Каждый шаг: иконка статуса + title + ExternalLink кнопка (только если `!isCtaBlocked && ctaLink`)
- При клике на CTA: `updateStep(key, 'viewed')` → `navigate(ctaLink)` (deep link)
- Баннер блокировки при `isBlocked` с человекочитаемым `blockReason`
- Close → `POST /close`; реopen → `POST /reopen`; «Пропустить» → `POST /complete`
- Поздравление (`Trophy` + «Настройка завершена!») на 3 сек, затем виджет скрывается
- Позиционирование: `bottom-20` на мобайле (над bottom nav), `md:bottom-6` на десктопе

### Изменения в существующих файлах

**`App.tsx`** — `CreateCompany` заменён на `OnboardingPage` на роуте `/onboarding`

**`MainLayout.tsx`** — импортирован и добавлен `<OnboardingWidget />` перед mobile bottom nav

### Критерии закрытия — статус
- ✅ Wizard с progress bar, step states, close/reopen, resume
- ✅ Resume после refresh — state загружается с бэкенда, `lastStepKey` восстанавливает позицию
- ✅ Deep links — CTA кнопка вызывает navigate(ctaLink) из бэкенда
- ✅ Нет local-only state — всё из `/onboarding/state`
- ✅ Blocked state — CTA скрыт если `isCtaBlocked`, баннер объясняет причину
- ✅ TypeScript без ошибок
