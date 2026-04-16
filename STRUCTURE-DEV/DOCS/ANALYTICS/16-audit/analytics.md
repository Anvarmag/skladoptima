# Аудит и история — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Контролировать полноту и качество неизменяемого business/security аудита: кто, что, когда изменил и из какого источника. Раздел служит для расследований, контроля прав и доверия к данным tenant.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Audit Coverage of Critical Actions | Доля критичных действий, попавших в audit | >= 99% | `audited_critical_actions / total_critical_actions` |
| Immutable Integrity Incidents | Попытки/факты нарушения неизменяемости | 0 | `count(audit_immutability_violation)` |
| Audit Query Success | Успешные фильтрации/поиск в аудит-модуле | >= 95% | `successful_audit_queries / audit_queries_total` |
| Time to Investigation Context | Время получения контекста при инциденте | <= 10 мин p50 | `median(context_ready_at - incident_reported_at)` |
| Role-Based Access Violations | Нарушения видимости аудита по ролям | 0 | `count(audit_rbac_violation)` |
| Support Audit Completeness | Support-действия с reason/comment | >= 98% | `support_actions_with_reason / support_actions_total` |

---

## 3. Воронки и конверсии

```
Критичное действие -> Audit record создан -> Record виден в списке -> Drill-down открыт -> Решение инцидента
100%              -> 99%                -> 98%                    -> 60%             -> 45%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Primary Owner/Admin | Смотрит полный audit tenant | Полные before/after и actor/source |
| Manager | Нужен operational audit по товарам/остаткам | Суженный scope без billing/security лишнего |
| SUPPORT_ADMIN | Расследует инциденты | Полный контекст support-действий и cross-module связи |
| Security/Platform team | Контроль auth-событий | Быстрый доступ к failed login/password reset паттернам |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `audit_record_created` | Создана запись аудита | `event_type`, `entity_type`, `source` | High |
| `audit_record_write_failed` | Не удалось записать audit | `event_type`, `error_code` | High |
| `audit_drilldown_opened` | Открыта детализация записи | `event_type`, `actor_role` | Med |
| `audit_filter_applied` | Применен фильтр | `filter_type=period/entity/actor/source` | Low |
| `audit_rbac_denied` | Запрещен доступ к записи/полю | `actor_role`, `requested_scope` | High |
| `audit_security_event_logged` | Зафиксировано security событие | `security_type`, `source_ip` | High |
| `audit_support_action_logged` | Записано support-действие | `action_type`, `has_reason` | High |
| `audit_retention_window_applied` | Применено ограничение глубины истории | `plan`, `window_days` | Med |

---

## 6. Текущее состояние (baseline)

- Раздел реализован минимально; baseline по полноте покрытия критичных событий нужно сформировать.
- Важно зафиксировать baseline на границе business audit vs technical logs, чтобы не смешивать слои.
- Для ролей Manager/Support нужен baseline по корректности ограничений видимости.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Группировка audit по сущности + actor сократит время расследования | `Time to Investigation Context` | Идея |
| Подсветка diff-полей в drill-down повысит эффективность анализа | `audit_incident_resolution_speed` | Идея |
| Пресеты фильтров для типовых инцидентов снизят нагрузку support | `Audit Query Success` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Audit Coverage Report: покрытие по модулям и типам событий.
- [ ] Security Events Panel: login success/failed, reset, password change.
- [ ] Support Actions Report: high-risk действия и reason completeness.
- [ ] Audit Access Control Report: denied/violation по ролям.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Пропуск audit для критичных операций | Любой случай | Блокирующий дефект, инцидентная эскалация |
| RBAC-утечки в audit | Любой случай | Срочный security review и фиксация |
| Рост `audit_record_write_failed` | `> 0.5%` | Проверить надежность слоя записи аудита |
| Support actions без reason | `> 2%` | Усилить обязательность полей и валидацию |

---

## 11. Источники данных и правила расчета

- Источники: immutable audit log, support action history, auth security events, policy enforcement events.
- Audit coverage считается только по заранее определенному каталогу критичных действий; иначе метрика легко манипулируется.
- Для записей с `before/after` нужно хранить идентификатор сущности, actor, source, correlation/request id и timestamp сервера.
- Security-события и бизнес-аудит должны связываться по tenant/user context, но храниться как разные типы записей в общей модели поиска.

---

## 12. Data Quality и QA-проверки

- QA должна проверить создание audit при create/update/delete, support-action, auth/security events и массовых операциях.
- Запись аудита не должна исчезать или меняться после создания, кроме технического enrich полей, разрешенного политикой.
- Любая high-risk support операция обязана иметь reason/comment и ссылку на actor/admin context.
- RBAC-фильтрация должна скрывать не только список записей, но и чувствительные поля внутри drill-down.

---

## 13. Владельцы метрик и ритм ревью

- Security/Product owner: покрытие критичных security/business действий.
- Backend/platform lead: надежность audit write-path и поиск.
- QA: регрессия по immutable behavior, RBAC, support logging.
- Review cadence: ежедневный контроль write failures, еженедельный аудит coverage и access violations.

---

## 14. Зависимости, допущения и границы

- Audit не заменяет технические логи инфраструктуры, но должен уметь ссылаться на correlation-id для стыковки с ними.
- Попытка выполнить критичное действие без успешной записи аудита должна трактоваться как инцидент проектного уровня.
- Внутренние support-действия и пользовательские действия должны быть различимы на уровне модели данных и отчетности.
- План retention не должен ломать расследования: для старых данных допустим архив, но не потеря доказательного следа.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
