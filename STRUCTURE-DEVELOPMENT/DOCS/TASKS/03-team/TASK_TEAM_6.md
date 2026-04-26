# TASK_TEAM_6 — Frontend Team Module и Invite UX

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TEAM_2`
  - `TASK_TEAM_3`
  - `TASK_TEAM_4`
  - `TASK_TEAM_5`
- Что нужно сделать:
  - собрать `/team` UI: список участников, список приглашений, invite form, role states;
  - реализовать accept-flow screens для valid/expired/used/mismatch invite;
  - показать понятные причины запретов по роли и tenant policy;
  - отобразить read-only team state при `TRIAL_EXPIRED` и blocked state при `CLOSED`;
  - учесть, что `STAFF` не имеет доступа к team module, а `MANAGER` имеет read-only.
- Критерий закрытия:
  - team UX соответствует role matrix и tenant-state policy;
  - пользователь видит не только запрет, но и понятное объяснение;
  - accept invite flow не содержит тупиков.

**Что сделано**

### Созданные файлы

**`apps/web/src/pages/Team.tsx`** — страница `/app/team`:
- Список участников (`GET /team/members`) с ролевыми бейджами и датой вступления.
- Изменение роли через select-дропдаун (только OWNER, не для себя и не для других OWNER, не для CLOSED/TRIAL_EXPIRED/SUSPENDED).
- Удаление участника (OWNER — любого, ADMIN — MANAGER/STAFF, не себя); сервер защищает last-owner.
- Кнопка «Покинуть команду» для своей membership (сервер проверяет last-owner guard).
- Вкладка «Приглашения» (только OWNER/ADMIN): форма invite (email + роль), список всех инвайтов с resend/cancel для PENDING.
- STAFF: полный access-denied экран с объяснением причины.
- CLOSED / TRIAL_EXPIRED / SUSPENDED: amber-баннер с объяснением; все write-кнопки скрыты — список доступен в read-only.
- MANAGER: видит только вкладку «Участники» в read-only (без вкладки инвайтов и action-кнопок).
- Toast-уведомления для всех операций; ошибки mapped по code (`LAST_OWNER_GUARD`, `INVITATION_ALREADY_PENDING` и др.).

**`apps/web/src/pages/AcceptInvite.tsx`** — страница `/invite/:token`:
- Публичный маршрут (без PrivateRoute), auth-проверка внутри компонента.
- Если не аутентифицирован: экран с кнопками «Войти» (c `?redirect=/invite/:token`) и «Зарегистрироваться».
- После login пользователь автоматически попадает обратно на страницу инвайта благодаря redirect-параметру.
- POST `/team/invitations/:token/accept` с полной обработкой всех состояний:
  - `success` — принято, кнопка «В приложение».
  - `already_member` — уже в команде.
  - `expired` — истёк срок (7 дней), подсказка запросить новый.
  - `used` — использован или отменён.
  - `mismatch` — неверный аккаунт, кнопка «Войти в другой».
  - `not_verified` — email не подтверждён, ссылка на verify-email.
  - `tenant_blocked` — компания SUSPENDED/CLOSED.
  - `not_found` / `error` — невалидная ссылка.

### Изменённые файлы

**`apps/web/src/App.tsx`**:
- Импортированы `Team` и `AcceptInvite`.
- Добавлен публичный маршрут `/invite/:token` → `<AcceptInvite />`.
- Добавлен защищённый маршрут `/app/team` → `<Team />` внутри MainLayout.

**`apps/web/src/layouts/MainLayout.tsx`**:
- Импортирована иконка `Users` из lucide-react.
- Вычислен `canSeeTeam = activeTenant?.role !== 'STAFF'`.
- Ссылка «Команда» добавлена в десктопный сайдбар и мобильный bottom nav (скрыта для STAFF).

**`apps/web/src/pages/Login.tsx`**:
- Добавлен `useSearchParams` и чтение `?redirect=` параметра.
- После успешного входа: `navigate(route ?? redirectTo)` — поддержка redirect-flow для invite acceptance.
