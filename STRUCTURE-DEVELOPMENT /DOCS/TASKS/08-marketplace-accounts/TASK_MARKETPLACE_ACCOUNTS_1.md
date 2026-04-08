# TASK_MARKETPLACE_ACCOUNTS_1 — Data Model, Encrypted Credentials и Account Statuses

> Модуль: `08-marketplace-accounts`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `08-marketplace-accounts`
- Что нужно сделать:
  - завести таблицы `marketplace_accounts`, `marketplace_credentials`, `marketplace_account_events`;
  - разделить `lifecycle_status`, `credential_status`, `sync_health_status` как независимые слои состояния;
  - зафиксировать `UNIQUE(tenant_id, marketplace) WHERE lifecycle_status = 'active'`;
  - хранить secrets только в `encrypted_payload` с `encryption_key_version`, `schema_version`, `masked_preview`;
  - предусмотреть поля `last_validated_at`, `last_sync_at`, `last_validation_error_*`, `last_sync_error_*`, `deactivated_at/by`.
- Критерий закрытия:
  - data model полностью соответствует `08-marketplace-accounts`;
  - plaintext credentials не появляются в бизнес-таблицах и API persistence layer;
  - single active account per marketplace enforce-ится на уровне БД и домена.

**Что сделано**

- Не выполнено.
