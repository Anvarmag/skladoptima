# TASK_AUDIT_1 — Immutable Storage, Audit Taxonomy и Data Model

> Модуль: `16-audit`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `16-audit`
  - согласованы `01-auth`, `19-admin`
- Что нужно сделать:
  - завести `audit_logs` и `security_events`;
  - закрепить поля `event_type`, `event_domain`, `entity_type`, `entity_id`, `actor_type`, `actor_id`, `source`, `request_id`, `correlation_id`;
  - описать `visibility_scope`, `redaction_level`, `changed_fields`, `before`, `after`, `metadata`;
  - зафиксировать mandatory MVP event catalog без аудита browse-only событий;
  - подготовить индексы для tenant/entity/actor/request filters.
- Критерий закрытия:
  - data model покрывает business audit и security events;
  - immutable storage semantics выражены явно;
  - mandatory event catalog воспроизводим на уровне модели и контрактов.

**Что сделано**

- Не выполнено.
