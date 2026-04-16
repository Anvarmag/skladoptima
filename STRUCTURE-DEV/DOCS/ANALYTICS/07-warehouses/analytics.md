# Склады — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Контролировать корректность отображения внешних складов (FBS/FBO), полноту warehouse-справочника и влияние складского контекста на видимость остатков и синхронизацию. Важная задача: исключить смешение управляемого и информационного контуров.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Warehouse Sync Coverage | Доля подключений с подтянутыми складами | >= 95% | `accounts_with_warehouses / active_marketplace_accounts` |
| FBS/FBO Classification Accuracy | Точность классификации типа склада | >= 99% | `correctly_classified_warehouses / total_warehouses` |
| Warehouse Mapping Completeness | Доля SKU с корректным warehouse context | >= 90% | `sku_with_warehouse_context / active_sku` |
| Warehouse Data Freshness | Актуальность данных склада | <= 24ч p95 | `p95(now - warehouse_last_seen_at)` |
| Warehouse Conflict Incidents | Конфликты идентификаторов/источников склада | <= 1% | `warehouse_conflicts / warehouse_updates` |

---

## 3. Воронки и конверсии

```
Подключен marketplace account -> Склад подтянут -> Тип FBS/FBO определен -> Остатки по складу отображаются
100%                          -> 95%            -> 93%                  -> 90%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Owner/Admin | Проверяет полноту складов по каналам | Диагностика источника и времени последнего обновления |
| Manager | Использует складской срез в операционке | Удобное раскрытие FBO/FBS детализации |
| Tenant с несколькими MP-аккаунтами | Риск путаницы складов | Явная привязка `marketplace + account + warehouse` |
| Tenant с высокой географией | Много городов/складов | Сильные фильтры по городу и типу |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `warehouse_sync_started` | Запущено обновление складов | `marketplace`, `account_id` | Med |
| `warehouse_synced` | Справочник складов обновлен | `added_count`, `updated_count` | High |
| `warehouse_classified` | Назначен тип склада | `warehouse_id`, `type=fbs/fbo`, `source` | High |
| `warehouse_classification_conflict` | Конфликт типа/источника | `warehouse_id`, `conflict_reason` | High |
| `warehouse_visibility_opened` | Пользователь открыл раздел складов | `actor_role`, `view_mode` | Low |
| `warehouse_stock_drilldown_opened` | Открыта детализация остатков по складу | `sku`, `warehouse_id` | Med |
| `warehouse_filter_applied` | Применен фильтр | `filter_type=city/type/source` | Low |
| `warehouse_sync_error` | Ошибка обновления склада | `marketplace`, `error_code` | High |

---

## 6. Текущее состояние (baseline)

- Модуль минимальный, поэтому baseline по классификации и качеству маппинга нужен как первичный контроль релиза.
- Ключевая зона риска baseline: расхождения FBS/FBO в UI и inventory-срезах.
- Отдельно фиксируется baseline по stale warehouse data для каждого маркетплейса.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Явная маркировка FBS/FBO цветом снизит ошибки интерпретации | `warehouse_ui_misread_feedback_rate` | Идея |
| Дефолтный фильтр по активному marketplace ускорит поиск склада | `time_to_open_correct_warehouse` | Идея |
| Добавление `last updated` рядом со складом снизит support-запросы по “старым данным” | `warehouse_data_stale_tickets` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Warehouse Coverage: подключения vs подтянутые склады.
- [ ] Classification Quality: FBS/FBO accuracy и конфликты.
- [ ] Warehouse Freshness: обновляемость по каналам.
- [ ] Warehouse Usage: drilldown/фильтры/просмотры в операционке.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение покрытия складов | `< 90%` | Проверить интеграции и sync jobs по справочнику |
| Ошибки классификации FBS/FBO | `> 1%` | Срочная ревизия mapping-правил |
| Старые складские данные | `> 24ч p95` | Проверить частоту pull sync и ошибки API |
| Рост конфликтов по warehouse_id | `> 0.5%` | Добавить доп. ключи привязки и диагностику источника |

---

## 11. Источники данных и правила расчета

- Источник: warehouse reference sync из marketplace accounts и read-model inventory by warehouse.
- Coverage считается по active marketplace accounts, а не по всем историческим подключениям.
- Classification accuracy должна мериться по явно размеченной выборке или validation-ruleset, а не “на глаз”.
- Freshness считается по `last_seen_at/last_synced_at` на warehouse scope.

---

## 12. Data Quality и QA-проверки

- Один `external_warehouse_id` не должен дублироваться в пределах одного `marketplace_account`.
- FBS/FBO классификация должна быть стабильна между sync runs, если внешний тип не изменился.
- QA должна проверить первичную загрузку, повторный upsert, деактивацию исчезнувшего склада, раздельный UI для FBS/FBO.
- City/source/type должны быть nullable только там, где это реально допускает внешний API.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: понятность warehouse view для пользователя.
- Backend/integration lead: freshness и quality mapping.
- QA: regression внешних справочников и inventory drilldown.
- Data review: еженедельно по coverage/freshness, отдельно при подключении нового marketplace.

---

## 14. Зависимости, допущения и границы

- Справочник складов зависит от внешних marketplace API и должен допускать неполноту или изменение атрибутов во времени.
- Warehouse layer является reference/read-model слоем и не должен сам по себе подменять inventory transactions.
- Классификация FBS/FBO и географических атрибутов должна быть объяснима и переиспользуема во всех зависимых модулях.
- Деактивация склада во внешнем источнике не всегда означает мгновенное удаление из UI; нужен управляемый lifecycle видимости.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
