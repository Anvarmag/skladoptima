# TASK_ADMIN_6 — Frontend Admin Panel, Tenant 360 UX и High-Risk Action Flows

> Модуль: `19-admin`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_ADMIN_2`
  - `TASK_ADMIN_3`
  - `TASK_ADMIN_4`
  - `TASK_ADMIN_5`
- Что нужно сделать:
  - собрать `/admin` с tenant directory и tenant 360;
  - визуально отделить read-only diagnostics от high-risk actions;
  - требовать reason/comment в UI перед high-risk action submit;
  - показать internal notes как internal-only support surface;
  - не смешивать admin UI с tenant-facing кабинетом визуально и логически.
- Критерий закрытия:
  - support UX ускоряет диагностику, а не прячет технический хаос;
  - high-risk actions защищены UX-guardrails;
  - UI явно отражает различие `SUPPORT_ADMIN` и `SUPPORT_READONLY`.

**Что сделано**

Реализован полный frontend admin-контур для support-плоскости — изолированный от tenant-facing кабинета визуально, логически и технически (см. §4 frontend-правил, §15 security guardrails аналитики).

### Архитектурные решения

1. **Изоляция от tenant-facing axios.defaults.** Создан отдельный `AxiosInstance` в [apps/web/src/api/admin.ts](../../../../apps/web/src/api/admin.ts) — tenant-facing CSRF (`/api/auth/csrf-token`) и admin-facing CSRF (`/api/admin/auth/csrf-token`) живут в разных переменных, не утекают между контурами. Cookies `AdminAuthentication`/`AdminRefresh` пишутся backend'ом, frontend их не читает (httpOnly), но `withCredentials: true` гарантирует доставку.
2. **Refresh-on-401 single-flight.** Interceptor на `adminAxios` ловит 401 на любом admin-запросе (кроме самих auth endpoints — иначе луп), делает один общий `POST /admin/auth/refresh` через `_refreshing` promise, повторяет оригинальный запрос. Если refresh не удался — пробрасывает 401 наверх, и `AdminAuthContext` перенаправляет на `/admin/login`.
3. **Отдельный AdminAuthProvider.** [AdminAuthContext.tsx](../../../../apps/web/src/context/AdminAuthContext.tsx) **не вложен** в общий `AuthProvider` — иначе любая tenant-страница на mount слала бы `GET /admin/auth/me` и засоряла `support_security_events`. Провайдер монтируется только внутри `/admin/*` маршрутов через wrapper `AdminRoot`.
4. **Визуальная изоляция UI.** AdminLayout — тёмная sidebar (`bg-slate-900` вместо tenant-белого), amber warning-ribbon "Internal control plane", role badges (`SUPPORT_ADMIN` амбер, `SUPPORT_READONLY` серый с иконкой `Eye`). Любой оператор сразу понимает, что находится в internal surface, а не в tenant-кабинете.

### Список созданных файлов

| Файл | Назначение |
|------|-----------|
| [apps/web/src/api/admin.ts](../../../../apps/web/src/api/admin.ts) | Изолированный axios instance + типы Tenant360/SupportNote/SupportActionRecord + `adminAuthApi`/`adminTenantsApi`/`adminActionsApi`/`adminNotesApi` |
| [apps/web/src/context/AdminAuthContext.tsx](../../../../apps/web/src/context/AdminAuthContext.tsx) | Context провайдер с `supportUser`/`isAdmin`/`isReadonly` flags |
| [apps/web/src/layouts/AdminRoot.tsx](../../../../apps/web/src/layouts/AdminRoot.tsx) | Mount-point `AdminAuthProvider` + `AdminPrivateRoute`/`AdminPublicOnly` guards |
| [apps/web/src/layouts/AdminLayout.tsx](../../../../apps/web/src/layouts/AdminLayout.tsx) | Тёмная sidebar + amber-ribbon + role badge + logout |
| [apps/web/src/pages/admin/AdminLogin.tsx](../../../../apps/web/src/pages/admin/AdminLogin.tsx) | Login form, обрабатывает `ADMIN_AUTH_SOFT_LOCKED` (с retryAfterSeconds), `ADMIN_AUTH_INACTIVE`, `ADMIN_AUTH_INVALID_CREDENTIALS` |
| [apps/web/src/pages/admin/AdminTenants.tsx](../../../../apps/web/src/pages/admin/AdminTenants.tsx) | Tenant directory: search (UUID/name/owner email), filters по `accessState`/`status`, keyset-cursor pagination, desktop-таблица + mobile-карточки |
| [apps/web/src/pages/admin/AdminTenant360.tsx](../../../../apps/web/src/pages/admin/AdminTenant360.tsx) | Tenant 360 view: 9 read-only diagnostic карточек + amber **High-risk zone** + notes panel + recent support actions |
| [apps/web/src/pages/admin/AdminChangePassword.tsx](../../../../apps/web/src/pages/admin/AdminChangePassword.tsx) | Self-service смена пароля (`POST /admin/auth/change-password`) с redirect на login после успеха |
| [apps/web/src/components/admin/HighRiskActionModal.tsx](../../../../apps/web/src/components/admin/HighRiskActionModal.tsx) | Универсальный модал для high-risk actions: reason ≥ 10 (живая валидация с прогрессом до минимума), checkbox "Я понимаю, что попадёт в audit", обработка ошибок `BILLING_OVERRIDE_NOT_ALLOWED` / `ACTION_NOT_ALLOWED_FOR_STATE` / `FORBIDDEN` / `REASON_REQUIRED` |
| [apps/web/src/components/admin/InternalNotesPanel.tsx](../../../../apps/web/src/components/admin/InternalNotesPanel.tsx) | Internal notes UI с lock-badge "Internal-only" — composer виден только `SUPPORT_ADMIN`, read-only видит явное "роль не может создавать notes" |

### Реализация требований задачи

- ✅ **`/admin` с tenant directory и tenant 360.** Маршруты: `/admin` → directory, `/admin/tenants/:tenantId` → tenant 360. На directory — UUID/name/owner email search + keyset-cursor "Показать ещё". Tenant 360 — 9 категорий summary (core, owner, team, subscription, marketplace, sync, notifications, worker/files, audit/security) + recent support actions + notes.
- ✅ **Визуальное отделение read-only diagnostics от high-risk actions.** Read-only зона — секция с заголовком *"Read-only diagnostics"* (`text-slate-500`, белые карточки). High-risk зона — отдельная секция `border-2 border-amber-200 bg-amber-50/40 rounded-lg` с иконкой `AlertTriangle` и заголовком *"High-risk support actions"*. Невозможно перепутать: разный цвет, разная иконография, физическое разделение в layout.
- ✅ **Reason/comment в UI перед high-risk submit.** `HighRiskActionModal` валидирует reason live: показывает счётчик `0/2000`, прогресс "Ещё N симв." до достижения минимума, дублирует backend invariant `MinLength(10)`. Submit блокируется до тех пор, пока reason ≥ 10 И поставлен явный confirm-checkbox "Я понимаю, что зафиксируется в audit". Дополнительный server-side fallback: при `REASON_REQUIRED`/`VALIDATION_ERROR` — человекочитаемое сообщение в модале.
- ✅ **Internal notes как internal-only support surface.** Panel помечен бейджем `Lock + "Internal-only"`. Backend ничего не показывает tenant-facing UI (это уже было сделано в TASK_ADMIN_4 — `GET /notes` возвращает только публичные поля). Frontend в свою очередь живёт под `/admin/*` и доступен только из admin-сессии.
- ✅ **Не смешивать admin UI с tenant-facing кабинетом.** AdminLayout — тёмный slate-900 sidebar (vs tenant — белый); amber warning-ribbon на каждой странице; AdminRoot — отдельная провайдер-ветка; admin axios — отдельный instance; редирект `/admin/*` catchall → `/admin` (а не tenant `/app`); анти-guard `AdminPublicOnly` на /admin/login.

### Реализация criteria закрытия

- ✅ **support UX ускоряет диагностику.** Tenant 360 показывает 9 категорий за один запрос (backend уже отдаёт всё через `Promise.all` summary read-model), карточки сгруппированы тематически, recent support actions видны сразу — оператор не делает несколько кликов, чтобы понять контекст.
- ✅ **high-risk actions защищены UX-guardrails.** Reason live-validation, double-confirm checkbox, амбер-цвет destructive surface, отдельная секция от read-only, модал блокирует submit до полной валидности. Каждая ошибка backend (`BILLING_OVERRIDE_NOT_ALLOWED`, `ACTION_NOT_ALLOWED_FOR_STATE`) — человекочитаемое объяснение.
- ✅ **UI явно отражает различие SUPPORT_ADMIN и SUPPORT_READONLY.** Sidebar показывает badge с ролью. SUPPORT_READONLY: high-risk зона показывает явный disclaimer "Ваша роль SUPPORT_READONLY — high-risk actions недоступны". Notes composer для readonly заменяется на disclaimer "Read-only роль не может создавать notes". Триггер password reset на owner-карточке для readonly не показывается. SUPPORT_ADMIN: все CTA активны (с дополнительной валидацией состояния — например, "Restore tenant" enabled только если tenant в `CLOSED`).

### Допольнительная защита и UX-нюансы

- **Per-action whitelisting на UI.** `Extend trial` доступен только при `TRIAL_ACTIVE`/`TRIAL_EXPIRED`. `Set access state` — только из `TRIAL_EXPIRED`/`CLOSED` (зеркало `SUPPORT_ALLOWED_TRANSITIONS` из `AccessStatePolicy`). `Restore tenant` — только при `CLOSED` + `tenantStatus !== ACTIVE`. Кнопки disabled с tooltip-hint вместо скрытия — оператор видит, что action существует, но почему недоступен в текущем state.
- **Catchall защищён.** Любой неизвестный `/admin/*` маршрут редиректит на `/admin`, а не на tenant `/app` — нельзя случайно вытолкнуть оператора в tenant-кабинет.
- **Self-service password change.** После успешной смены пароля — auto-logout через 1.2с + redirect на `/admin/login`, чтобы текущая сессия использовала свежий хэш (backend всё равно revoked все остальные сессии оператора, но это явный визуальный сигнал).
- **Вёрстка адаптивна.** Mobile breakpoint: directory становится списком карточек, sidebar заменяется top-bar с logout-кнопкой, tenant 360 grid схлопывается в одну колонку.

### Билд

`npx vite build` собрал production-bundle без ошибок (5.69s, 1120 kB → 309 kB gzip). Все TypeScript-warnings в выводе — preexisting, не относятся к admin-файлам (`tsc --noEmit` на admin-модуле даёт 0 ошибок).
