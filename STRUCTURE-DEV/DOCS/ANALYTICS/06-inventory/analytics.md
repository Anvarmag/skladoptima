# Остатки (Inventory) — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Контролировать точность master/FBS-остатка, качество резервирования под заказы, частоту конфликтов sync и скорость реакции на дефицит. Раздел критичен для предотвращения oversell и корректной синхронизации с каналами.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Stock Accuracy | Совпадение учетного и фактического FBS-остатка | >= 98% | `matched_stock_positions / audited_positions` |
| Low Stock Exposure | Доля SKU ниже порога | <= 12% | `sku_below_threshold / active_sku` |
| Conflict Rate | Конфликты ручной корректировки и внешних событий | <= 2% | `conflict_events / stock_change_events` |
| Manual Adjustment Share | Доля ручных корректировок среди всех движений | <= 25% | `manual_movements / total_movements` |
| Oversell Incident Rate | Инциденты продажи при недоступном остатке | 0 | `count(oversell_incident)` |
| Sync Propagation Time | Время доставки нового available stock в канал | <= 5 мин p95 | `p95(channel_updated_at - stock_changed_at)` |

---

## 3. Воронки и конверсии

```
Событие изменения (order/manual) -> Пересчет available -> Push в каналы -> Подтверждение sync
100%                            -> 100%              -> 95%            -> 90%
```

Отдельная воронка low stock:

```
SKU ниже порога -> Уведомление отправлено -> Корректировка/пополнение -> SKU выше порога
100%            -> 98%                    -> 60%                    -> 52%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Owner/Admin | Контроль конфликтов и порогов | Полная видимость movement history |
| Manager | Частые ручные корректировки | Быстрый, безопасный workflow причины корректировки |
| Tenant с высоким order volume | Больше риска race-condition | Надежная идемпотентность заказных событий |
| Multi-channel tenant | Больше lock/override кейсов | Контроль per-channel sync state |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `inventory_manual_adjustment_created` | Ручная корректировка остатка | `sku`, `delta`, `reason`, `actor_role` | High |
| `inventory_negative_prevented` | Заблокирован уход в минус | `sku`, `requested_delta` | High |
| `inventory_reserve_created` | Создан резерв по заказу | `order_id`, `sku`, `qty` | High |
| `inventory_reserve_released` | Снят резерв (отмена) | `order_id`, `sku`, `qty` | High |
| `inventory_order_deducted` | Финальное списание on_hand | `order_id`, `sku`, `qty` | High |
| `inventory_return_logged` | Возврат зафиксирован как событие | `order_id`, `sku`, `qty` | Med |
| `inventory_conflict_detected` | Обнаружен конфликт устаревшего события | `sku`, `channel`, `conflict_type` | High |
| `inventory_channel_lock_enabled` | Включен lock/override | `sku`, `channel`, `override_qty` | High |
| `inventory_low_stock_triggered` | SKU ушел ниже порога | `sku`, `threshold`, `available_qty` | High |
| `inventory_sync_state_changed` | Изменился sync state канала | `sku`, `channel`, `from_state`, `to_state` | Med |

---

## 6. Текущее состояние (baseline)

- Модуль работает, но baseline по `conflict_events`, `manual_share` и SLA доставки в каналы не закреплен.
- История движений есть, но требуется единая витрина по типам движений и actor/source.
- На старте отдельно фиксируем baseline для FBS vs информационного FBO (они не смешиваются).

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Обязательный комментарий для части причин снизит ошибочные корректировки | `Stock Accuracy` | Идея |
| Цветовая индикация и sticky-фильтр конфликтов ускорят реакцию на ошибки | `conflict_resolution_time` | Идея |
| Daily digest low stock с приоритетом по оборачиваемости снизит дефицит | `Low Stock Exposure` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Inventory Control: on_hand, reserved, available по SKU/складу.
- [ ] Movement Ledger: все типы движений, actor/source, before/after.
- [ ] Conflict Monitor: конфликтные события и их статус обработки.
- [ ] Low Stock Operations: пороговые SKU, уведомления, время восстановления.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост конфликтов | `> 3%` | Проверить порядок обработки событий и timestamp-логику |
| Падение точности остатков | `< 96%` | Инвентаризация + ревизия ручных операций |
| Частые попытки ухода в минус | `> 1% корректировок` | Пересмотреть UX и права на корректировку |
| Длительный sync after stock change | `p95 > 10 мин` | Проверить worker очередь и marketplace API ограничения |

---

## 11. Источники данных и правила расчета

- Основной источник: `stock_balances`, `stock_movements`, order reserve/release/deduct events, channel override records.
- Stock Accuracy нельзя считать только по системным данным; нужен внешний источник truth: инвентаризация или warehouse audit.
- Low stock KPI считается по `available`, а не по `on_hand`.
- FBS и FBO должны агрегироваться раздельно, иначе метрики теряют бизнес-смысл.

---

## 12. Data Quality и QA-проверки

- Для каждого движения обязателен `movement_type`, `source`, `product_id`, `timestamp`.
- `available` должно всегда быть равно `on_hand - reserved`.
- QA должна проверить reserve/cancel/fulfill, manual adjustment, negative stock prevention, override flow, conflict detection.
- Количество conflict events не должно расти из-за дублирующих external events без business-effect.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: low stock exposure и operational usability.
- Backend lead: stock consistency, transactionality, conflict handling.
- QA: reserve/deduct regression и negative stock guard.
- Data review: ежедневно по low-stock и conflicts, еженедельно по stock accuracy.

---

## 14. Зависимости, допущения и границы

- Остатки нельзя считать одной цифрой “на весь бизнес”: разрез по складу, fulfillment mode и каналу обязателен.
- `available` является пользовательской рабочей метрикой, но ее корректность полностью зависит от надежности reserve/release/deduct цепочки.
- FBS и FBO имеют разный операционный смысл: для FBO часть данных информативна, но не должна влиять на локальный stock control.
- Любые отрицательные остатки, если они не разрешены отдельным правилом, должны трактоваться как дефект бизнес-логики или синхронизации.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
