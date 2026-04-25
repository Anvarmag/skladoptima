# TASK_SYNC_6 — Frontend History, Run Details и Conflict UX

> Модуль: `09-sync`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_SYNC_2`
  - `TASK_SYNC_3`
  - `TASK_SYNC_4`
  - `TASK_SYNC_5`
- Что нужно сделать:
  - собрать экран истории run и страницу деталей конкретного запуска;
  - показать summary по этапам, blocked reasons, error codes и conflict list;
  - заблокировать кнопки `sync now`, `retry`, `full sync` при `TRIAL_EXPIRED / SUSPENDED / CLOSED`;
  - явно различать `failed` и `blocked by policy` на уровне UX текста и статусов;
  - не выводить в UI `tenant full sync` как MVP-функцию.
- Критерий закрытия:
  - пользователь понимает, что синхронизация сделала и почему она не пошла дальше;
  - UI не предлагает запрещенные действия;
  - diagnostics flow пригоден для owner/admin/manager в рамках их прав.

**Что сделано**

- Не выполнено.
