# Каталог товаров — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять полноту и качество товарного каталога как основы для sync, inventory и unit-экономики. Основной фокус: скорость наполнения, доля сопоставленных товаров, качество импорта без дублей и эффективность поиска/фильтрации.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Catalog Fill Velocity | Скорость наполнения каталога | Рост неделя к неделе | `new_products_created_per_week` |
| Auto-Match Rate by SKU | Доля успешного автосопоставления | >= 70% | `auto_matched_products / candidate_products_for_match` |
| Unmatched Products Share | Доля несопоставленных карточек | <= 15% | `unmatched_products / total_products` |
| Import Success Rate | Успешные импорт-джобы | >= 90% | `successful_import_jobs / total_import_jobs` |
| Duplicate Prevention Rate | Предотвращенные дубли при sync/import | >= 98% | `updates_without_duplicates / sync_or_import_updates` |
| Soft-Delete Recovery Rate | Восстановление soft-deleted товаров | >= 20% | `restored_products / soft_deleted_products` |

---

## 3. Воронки и конверсии

```
Импорт/sync получен -> Превью подтверждено -> Карточки созданы/обновлены -> Match завершен -> Товар активен для inventory
100%                -> 85%               -> 80%                      -> 72%             -> 68%
```

Ручной поток:

```
Создание товара вручную -> Заполнение обязательных полей -> Сохранение -> Привязка к каналу
100%                    -> 92%                          -> 88%       -> 64%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Admin/Owner | Массовый импорт и контроль качества | Надежный preview и журнал ошибок |
| Manager | Ручное создание и оперативные правки | Быстрая форма карточки + фильтры |
| Tenant с мультиканалом | Больше конфликтов сопоставления | Инструмент ручного match |
| Staff (read-only) | Использует каталог для просмотра | Быстрый поиск и наглядные поля |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `catalog_product_created` | Создана карточка вручную | `actor_role`, `has_photo`, `has_barcode` | High |
| `catalog_product_updated` | Изменена карточка | `changed_fields_count`, `source=manual/sync/import` | Med |
| `catalog_product_soft_deleted` | Soft delete | `actor_role`, `reason` | High |
| `catalog_product_restored` | Восстановление товара | `days_since_delete` | Med |
| `catalog_import_started` | Запущен импорт | `source=excel/api`, `rows_count` | High |
| `catalog_import_preview_confirmed` | Подтвержден preview | `valid_rows`, `invalid_rows` | High |
| `catalog_import_finished` | Импорт завершен | `status`, `created_count`, `updated_count`, `error_count` | High |
| `catalog_auto_match_applied` | Автосопоставление по SKU | `confidence_level`, `matches_count` | High |
| `catalog_manual_match_applied` | Ручное сопоставление | `unmatched_queue_size_before` | High |
| `catalog_search_used` | Поиск в каталоге | `query_type=name/sku/barcode` | Low |

---

## 6. Текущее состояние (baseline)

- Модуль работает, но нет согласованного baseline по дублям и качеству match.
- История импортов и ошибок должна стать источником первичных SLA для каталога.
- На старте важно отделить baseline по источникам: API sync vs Excel import vs manual create.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Подсветка «обязательных полей» в форме повысит сохранения без ошибок | `manual_create_success_rate` | Идея |
| Рекомендации для ручного match по SKU-префиксу сократят несопоставленные товары | `Unmatched Products Share` | Идея |
| Улучшенный preview импорта снизит `error_count` после подтверждения | `Import Success Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Catalog Health: размер каталога, активные/удаленные, прирост.
- [ ] Matching Dashboard: auto/manual match, unmatched backlog.
- [ ] Import Quality: успешность, ошибки по типам, время обработки.
- [ ] Product Data Completeness: фото, бренд, категория, barcode coverage.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост дублей после sync/import | `> 2%` | Проверить ключи сопоставления и idempotency |
| Высокий backlog несопоставленных | `> 20% каталога` | Запустить кампанию ручного match и улучшить авто-правила |
| Низкая успешность импорта | `< 80%` | Разобрать ошибки формата/валидации и обновить шаблон |
| Массовый soft delete без восстановления | `> 10% каталога в неделю` | Проверить сценарий удаления и права ролей |

---

## 11. Источники данных и правила расчета

- Источники: `products`, `product_channel_mappings`, `catalog_import_jobs`, `catalog_import_job_items`, sync/import events.
- Auto-match rate считается только по строкам, где система реально пыталась выполнить автоматический match, а не по всему каталогу.
- Duplicate prevention rate должна строиться на reconciliation/import result, а не на ручной оценке пользователя.
- Soft-deleted товары должны исключаться из активной витрины, но не из исторических import/match отчетов.

---

## 12. Data Quality и QA-проверки

- SKU должен быть уникален в tenant среди active товаров.
- Import preview и import commit должны давать воспроизводимый итог на одном и том же наборе данных.
- QA должна проверить: create/update/delete/restore, import preview, invalid rows, auto-match, manual match, duplicate import.
- Mapping одного external product в два внутренних product должен блокироваться или явно подсвечиваться как конфликт.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: completeness каталога, unmatched backlog, import success.
- Backend lead: idempotency import/sync, mapping integrity, soft delete lifecycle.
- QA: import regression, restore/mapping edge-cases.
- Data review: еженедельно по import quality и unmatched queue, ежемесячно по data completeness.

---

## 14. Зависимости, допущения и границы

- Каталог является внутренним master-слоем, а не зеркалом одного marketplace, поэтому mappings к внешним сущностям обязательны.
- Soft delete не должен уничтожать аналитический след товара, особенно если он участвовал в заказах, импортах или финансовых расчетах.
- Import-процессы должны оставаться воспроизводимыми: одинаковый вход на одинаковой версии правил должен давать одинаковый результат.
- Автоматический match допустим только при объяснимом наборе правил; “магические” объединения без traceability создадут будущие инциденты.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
