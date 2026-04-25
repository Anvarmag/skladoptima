# TASK_MARKETPLACE_ACCOUNTS_2 — Create/Update Account и Masked Credential Handling

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/marketplace-accounts`;
  - реализовать `PATCH /api/v1/marketplace-accounts/:id` для `label` и частичного обновления credentials;
  - валидировать обязательные credential-поля в зависимости от marketplace;
  - обеспечить partial secret update без возврата старых значений в response;
  - отдавать только masked preview и безопасные metadata поля.
- Критерий закрытия:
  - создание и обновление account не раскрывает секреты;
  - response model безопасна и пригодна для UI;
  - ошибки `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` и `ACCOUNT_LABEL_ALREADY_EXISTS` отрабатывают предсказуемо.

**Что сделано**

- Не выполнено.
