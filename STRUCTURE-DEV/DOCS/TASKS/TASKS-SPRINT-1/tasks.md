# Tasks — Sprint 1 — Auth Fix + DB Tech Debt

> Спринт: 1
> Даты: 1–14 апреля 2026
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

## Backend задачи

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-01 | Исправить JWT: убрать storeId, добавить tenantId + membershipId + role | P0 | 4h | TODO |
| T1-02 | Обновить JwtStrategy для нового payload | P0 | 2h | TODO |
| T1-03 | Обновить все guard'ы и декораторы (CurrentUser, TenantId) | P0 | 3h | TODO |
| T1-04 | Убрать onModuleInit ALTER TABLE из ProductService | P0 | 2h | TODO |
| T1-05 | Убрать onModuleInit ALTER TABLE из SettingsService | P0 | 2h | TODO |
| T1-06 | Аудит и чистка старого MarketplaceSettings singleton | P0 | 3h | TODO |

---

## БД / Миграции

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-20 | Добавить @@index([tenantId]) на Product | P0 | 1h | TODO |
| T1-21 | Добавить @@index([tenantId]) на AuditLog + [tenantId, createdAt] | P0 | 1h | TODO |
| T1-22 | Добавить @@index([tenantId]) на MarketplaceOrder | P0 | 1h | TODO |
| T1-23 | Добавить @@index([tenantId]) на MarketplaceReport | P0 | 1h | TODO |
| T1-24 | Перенести wbBarcode из runtime ALTER TABLE в schema.prisma | P0 | 2h | TODO |
| T1-25 | Создать полную историю Prisma-миграций (базовая) | P1 | 3h | TODO |

---

## Тестирование

| ID | Задача | Приоритет | Оценка | Статус |
|----|--------|----------|--------|--------|
| T1-40 | Проверить все эндпоинты с новым JWT payload | P0 | 3h | TODO |
| T1-41 | Проверить tenant isolation (нет утечки данных между тенантами) | P0 | 2h | TODO |

---

## Итого по спринту

| Категория | Запланировано (ч) | Выполнено (ч) |
|----------|-----------------|--------------|
| Backend | 16 | |
| БД | 9 | |
| Тестирование | 5 | |
| **Итого** | **30** | |
