# Sprint 4 — Marketplace Connections + Warehouses — Обзор

> Даты: 13–26 мая 2026
> Статус: [ ] Планирование / [ ] В работе / [ ] Завершён
> Цель: Подключить marketplace accounts и нормализованный warehouse reference layer.

---

## Цель спринта

После спринта tenant сможет безопасно подключать marketplace-аккаунты, хранить credentials в защищенном виде, видеть статус подключения и получать нормализованный справочник складов.

---

## Разделы продукта, затрагиваемые в спринте

| Раздел | Файл требований | Системная аналитика |
|--------|-----------------|---------------------|
| 08. Маркетплейс-аккаунты | [08-marketplace-accounts](../../BUSINESS-REQUIREMENTS/08-marketplace-accounts/requirements.md) | [08-marketplace-accounts](../../SYSTEM-ANALYTICS/08-marketplace-accounts/system-analytics.md) |
| 07. Склады | [07-warehouses](../../BUSINESS-REQUIREMENTS/07-warehouses/requirements.md) | [07-warehouses](../../SYSTEM-ANALYTICS/07-warehouses/system-analytics.md) |

---

## Ключевые deliverables

- [ ] Marketplace account CRUD + credentials validation + lifecycle
- [ ] Masked secret storage и reconnect/update flows
- [ ] Warehouse sync baseline, upsert и FBS/FBO normalization
- [ ] UI подключения marketplace и справочника складов
- [ ] Health/status диагностика для account и warehouse freshness

---

## Что НЕ входит в спринт

- полноценный sync orders/stocks
- billing лимиты по account
- inventory transactions

---

## Риски спринта

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|----------|
| Небезопасное хранение credentials | Med | High | Шифрование, masked responses, audit |
| Нестабильная нормализация warehouse type | Med | Med | Versioned mapping rule и account-specific logs |
| Смешение validation status и operational health | Med | Med | Разделить поля/статусы в модели |

---

## Зависимости

- Sprint 1 foundation по tenant/auth
- Object storage/secret handling practices
- Согласованные adapter contracts для marketplace credentials и warehouse fetch

---

## Ссылки

- Задачи: [TASKS-SPRINT-4](../../TASKS/TASKS-SPRINT-4/tasks.md)
- Детальный план: [PLAN-SPRINT-4](../../PLAN/PLAN-SPRINT-4.md)
