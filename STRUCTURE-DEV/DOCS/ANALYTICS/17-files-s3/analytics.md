# Файлы / S3 — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять надежность загрузки и безопасной выдачи главного фото товара, tenant-изоляцию медиа и эффективность lifecycle-процессов (replace/cleanup). Раздел должен показать, что медиа-хранилище масштабируется без утечки данных между tenant.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Upload Success Rate | Успешность загрузки фото | >= 98% | `successful_uploads / upload_attempts` |
| File Validation Reject Rate | Отказы по формату/размеру | <= 10% | `validation_rejects / upload_attempts` |
| Secure Access Success Rate | Успешная защищенная выдача файлов | >= 99% | `authorized_file_access / file_access_attempts` |
| Cross-Tenant Access Violations | Попытки межтенантного доступа | 0 успешных | `count(cross_tenant_access_granted)` |
| Replace Consistency Rate | Успешная замена фото без битых ссылок | >= 99% | `successful_replace_without_broken_refs / replace_attempts` |
| Orphaned Media Share | Доля orphaned файлов после replace/delete | <= 3% | `orphaned_files / total_files` |

---

## 3. Воронки и конверсии

```
Upload started -> Validation passed -> Stored in object storage -> Linked to product -> Displayed in UI
100%           -> 90%              -> 89%                     -> 88%               -> 87%
```

Поток замены:

```
Replace requested -> New file stored -> Product link switched -> Old file marked for cleanup
100%             -> 99%            -> 99%                    -> 95%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Owner/Admin/Manager | Загружает и заменяет фото | Надежный upload UX и быстрый preview |
| Staff/Viewer | Только смотрит фото | Стабильная выдача без задержек |
| Tenant с большим каталогом | Массовые операции replace | Контроль cleanup и storage роста |
| Tenant с частыми soft delete | Фото часто скрывается/восстанавливается | Корректная связка media с lifecycle товара |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `media_upload_started` | Начата загрузка файла | `mime`, `size_bytes`, `actor_role` | Med |
| `media_upload_validation_failed` | Файл не прошел валидацию | `reject_reason`, `mime`, `size_bytes` | High |
| `media_upload_succeeded` | Файл сохранен в object storage | `object_key_hash`, `storage_provider` | High |
| `media_linked_to_product` | Фото привязано к карточке | `product_id`, `file_id` | High |
| `media_access_granted` | Успешная защищенная выдача | `tenant_id`, `access_mode=signed_url` | Med |
| `media_access_denied` | Доступ запрещен | `deny_reason`, `request_tenant_id` | High |
| `media_replaced` | Главное фото заменено | `product_id`, `old_file_id`, `new_file_id` | High |
| `media_cleanup_marked` | Файл помечен на cleanup | `file_id`, `cleanup_reason` | Med |
| `media_cleanup_completed` | Файл удален физически | `file_id`, `retention_age_days` | Med |

---

## 6. Текущее состояние (baseline)

- BRD фиксирует проблему локального диска; baseline S3/object-storage начинается после полного переноса.
- При старте нужен baseline по доле upload reject и причинам отклонения.
- Критично первым этапом зафиксировать отсутствие успешных cross-tenant access.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Предварительная клиентская проверка размера/формата снизит reject rate | `File Validation Reject Rate` | Идея |
| Кэширование подписанных ссылок на короткий TTL ускорит display | `media_render_latency` | Идея |
| Пакетный cleanup замененных файлов снизит orphan share без влияния на UX | `Orphaned Media Share` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Media Upload Health: попытки, успех, причины отказов.
- [ ] Access Security Report: granted/denied/cross-tenant attempts.
- [ ] Replace & Cleanup Report: заменено, orphaned, cleanup backlog.
- [ ] Storage Consumption Report: объем медиа и динамика роста.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост upload fail | `> 5%` | Проверить валидаторы, доступность object storage |
| Любой успешный cross-tenant доступ | Любой случай | Критичный security incident |
| Битые ссылки после replace | `> 1% replace` | Ревизия атомарности смены file-link |
| Рост orphaned backlog | `> 10%` | Пересмотреть cleanup политику и воркер-задачи |

---

## 11. Источники данных и правила расчета

- Источники: upload sessions, file metadata records, signed URL access logs, cleanup jobs, product-media relations.
- Upload success считается только после успешного сохранения метаданных и привязки файла к доменной сущности при завершенном flow.
- Cross-tenant access violations должны анализироваться отдельно по denied и granted кейсам; успешный granted всегда критичен.
- Orphaned media определяется как объект без активной доменной ссылки и без допустимого retention window на cleanup.

---

## 12. Data Quality и QA-проверки

- QA должна проверить upload happy-path, invalid mime, oversize, replace, repeated replace, delete/restore product, expired signed URL.
- Метаданные файла должны хранить tenant ownership, storage key, mime, size, checksum/status lifecycle.
- После replace пользователь не должен получать битую ссылку ни по старому, ни по новому preview сценарию.
- Cleanup не должен удалять файл, если он все еще связан с активной сущностью или находится в hold window.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: UX загрузки и стабильность отображения фото.
- Backend/platform lead: object storage security, signed URLs, cleanup correctness.
- QA/Security: cross-tenant isolation, replace consistency, expired-access cases.
- Review cadence: ежедневный мониторинг security/access incidents, еженедельный обзор storage growth и cleanup backlog.

---

## 14. Зависимости, допущения и границы

- Файловый модуль хранит медиа и метаданные, но не должен становиться системой DAM с произвольными коллекциями и редактированием.
- Access control строится по tenant ownership и подписанным URL, а не по прямой публичной выдаче из bucket.
- Локальный preview/cdn cache допустим только при сохранении модели изоляции и короткого времени жизни приватных ссылок.
- Массовые загрузки и тяжелые преобразования изображений должны уходить в background jobs, а не блокировать пользовательский поток.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
