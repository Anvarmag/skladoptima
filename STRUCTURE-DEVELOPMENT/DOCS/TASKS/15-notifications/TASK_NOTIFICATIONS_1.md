# TASK_NOTIFICATIONS_1 — Events, Dispatches, Inbox и Preferences Data Model

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `15-notifications`
  - согласованы `01-auth`, `13-billing`, `09-sync`
- Что нужно сделать:
  - завести `notification_events`, `notification_dispatches`, `notification_preferences`, `notification_inbox`;
  - закрепить категории `AUTH`, `BILLING`, `SYNC`, `INVENTORY`, `REFERRAL`, `SYSTEM`;
  - описать поля `is_mandatory`, `dedup_key`, `policy`, `status`, `attempts`, `read_at`;
  - предусмотреть tenant-level preferences с channels/categories и primary channel;
  - согласовать data model с worker pipeline и in-app inbox UX.
- Критерий закрытия:
  - data model покрывает event, dispatch, delivery и inbox слои;
  - mandatory и optional notifications различаются на уровне модели;
  - preferences и inbox пригодны для API и UX без обходных структур.

**Что сделано**

- Не выполнено.
