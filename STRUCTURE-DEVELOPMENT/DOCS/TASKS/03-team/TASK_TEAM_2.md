# TASK_TEAM_2 — Create, List, Resend и Cancel Invite Flow

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TEAM_1`
  - готов email delivery контур
- Что нужно сделать:
  - реализовать `GET/POST /team/invitations`, `POST resend`, `DELETE cancel`;
  - генерировать invitation token/link и TTL `7 дней`;
  - не допускать duplicate `pending` invite и `self-invite` в тот же tenant;
  - разрешить resend/cancel только для `PENDING`;
  - отправлять invite email асинхронно и писать team/audit события.
- Критерий закрытия:
  - уполномоченный actor может создать, переотправить и отменить invite;
  - duplicate и invalid invite сценарии предсказуемо обрабатываются;
  - invitation lifecycle согласован с backend и email delivery.

**Что сделано**

- Не выполнено.
