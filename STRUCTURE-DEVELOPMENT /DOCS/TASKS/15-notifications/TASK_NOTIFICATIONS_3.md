# TASK_NOTIFICATIONS_3 — In-App и Email Delivery, Retry и Provider Integration

> Модуль: `15-notifications`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_NOTIFICATIONS_1`
  - `TASK_NOTIFICATIONS_2`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать delivery по MVP-каналам `in-app` и `email`;
  - создавать inbox запись для in-app пути;
  - интегрировать email provider и технический delivery status;
  - реализовать retry with backoff для временных ошибок;
  - не блокировать delivery pipeline при падении одного channel provider.
- Критерий закрытия:
  - основной MVP delivery path работает через in-app и email;
  - временные provider failures не убивают всю цепочку;
  - delivery statuses пригодны для diagnostics и support.

**Что сделано**

- Не выполнено.
