# Лендинг — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Публичный маркетинговый слой продукта: SEO-ready страницы, CTA в регистрацию, лид-формы (демо/контакт), UTM-атрибуция, юридически корректный consent.

## 2. Функциональный контур и границы

### Что входит в модуль
- публичные страницы сайта продукта;
- CTA в регистрацию/демо/лид-формы;
- сохранение attribution и handoff в auth/CRM;
- consent/legal flows на маркетинговой стороне;
- базовые content blocks pricing/FAQ/benefits.

### Что не входит в модуль
- сам продуктовый кабинет и бизнес-данные tenant;
- сложная CMS/блоговая платформа beyond MVP;
- платежи и tenant setup как backend domains;
- support/admin внутренние функции.

### Главный результат работы модуля
- посетитель лендинга понимает ценность продукта, переходит в регистрацию или лид-форму, а все маркетинговые атрибуты и legal-consent корректно передаются дальше.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Анонимный посетитель | Читает страницы и кликает CTA | Основной actor |
| Marketing/Growth | Управляет контентом и экспериментами | Не должен ломать legal/compliance flows |
| Auth/CRM integrations | Принимают handoff из лендинга | Внешние зависимые системы |
| Frontend platform | Отвечает за performance и tracking | Не хранит consent только в local state |

## 4. Базовые сценарии использования

### Сценарий 1. Переход в регистрацию
1. Посетитель открывает лендинг.
2. Нажимает CTA регистрации.
3. Система сохраняет attribution/utm bundle.
4. Пользователь переводится в auth-flow с сохранением источника.

### Сценарий 2. Отправка lead/demo формы
1. Посетитель заполняет форму.
2. Backend валидирует поля и consent.
3. Лид сохраняется и/или отправляется в CRM.
4. Пользователь получает подтверждение отправки.

### Сценарий 3. Legal consent
1. Пользователь взаимодействует с cookie/legal блоком.
2. Согласие сохраняется как юридически значимый record.
3. Формы и tracking работают только в рамках выбранной политики.

## 5. Зависимости и интеграции

- Auth (start registration)
- CRM/Leads pipeline
- Web analytics (events, UTM)
- Legal docs pages

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/public/leads` | Public | Отправка заявки/демо |
| `POST` | `/api/v1/public/track` | Public | Трекинг ключевых событий |
| `GET` | `/api/v1/public/pricing` | Public | Тарифы для лендинга |
| `GET` | `/api/v1/public/faq` | Public | FAQ контент |
| `GET` | `/api/v1/public/legal/:docType` | Public | Юридические документы |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/public/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Иван","email":"ivan@demo.ru","phone":"+79990000000","message":"Хочу демо","consent":true,"utm":{"source":"google","campaign":"brand"}}'
```

```json
{
  "leadId": "lead_...",
  "status": "ACCEPTED",
  "message": "Спасибо, мы свяжемся с вами"
}
```

## 8. Модель данных (PostgreSQL)

### `landing_leads`
- `id UUID PK`
- `name VARCHAR(128)`, `email VARCHAR(255)`, `phone VARCHAR(32) NULL`
- `message TEXT NULL`, `lead_type ENUM(demo, contact)`
- `status ENUM(new, in_progress, closed)`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `source_ip INET`, `user_agent TEXT`
- `consent_given BOOLEAN NOT NULL`
- `created_at`

### `landing_events`
- `id UUID PK`, `event_name VARCHAR(64)`
- `session_id VARCHAR(64)`, `anonymous_id VARCHAR(64)`
- `payload JSONB`, `created_at`

### `legal_documents`
- `id UUID PK`, `doc_type ENUM(privacy, terms, cookies)`
- `version VARCHAR(16)`, `content_md TEXT`, `published_at`, `is_active`

## 9. Сценарии и алгоритмы (step-by-step)

1. Пользователь открывает лендинг, фронт отправляет `page_view` + UTM.
2. При CTA `register` фронт передает атрибуцию в auth-flow.
3. При отправке lead формы backend валидирует `consent=true`, сохраняет lead и запускает notification в CRM.
4. Юридические документы отдаются по активной версии.

## 10. Валидации и ошибки

- Lead submit без consent запрещен.
- Ограничение частоты submit на IP/email.
- Ошибки:
  - `VALIDATION_ERROR: CONSENT_REQUIRED`
  - `RATE_LIMITED: LEAD_SUBMIT_TOO_FREQUENT`

## 11. Чеклист реализации

- [ ] Таблицы leads/events/legal docs.
- [ ] Public API endpoints.
- [ ] Anti-spam/rate-limit для lead form.
- [ ] Передача UTM в auth pipeline.
- [ ] SEO и legal интеграция на frontend.

## 12. Критерии готовности (DoD)

- Лиды сохраняются юридически корректно.
- Трекинг конверсий лендинга работает end-to-end.
- Регистрация запускается из лендинга с атрибуцией источника.

## 13. Public/backend boundary

### Что должно быть статическим на frontend
- hero
- feature sections
- FAQ, если редактирование не нужно на MVP

### Что допустимо отдавать через backend API
- pricing
- legal docs active version
- lead submit
- analytics track endpoint

## 14. Lead handling flow

1. Submit формы -> валидация consent/rate-limit.
2. Запись в `landing_leads`.
3. Публикация internal event `lead_created`.
4. Уведомление sales/support канала.
5. Дальнейшая CRM-интеграция future-ready.

## 15. Consent и compliance

- Под каждой формой требуется явный флаг `consent=true`.
- Версия legal document должна быть доступна и логически связана с submit.
- Для cookies/analytics нужен consent state, если это требует выбранная legal модель.

## 16. Тестовая матрица

- Submit lead с consent.
- Submit lead без consent.
- Повторные submit с одного IP.
- Open legal doc.
- Transfer UTM from landing to registration start.
- Track event endpoint for `click_cta_register`.

## 17. Фазы внедрения

1. Public API for pricing/faq/legal/leads.
2. Lead storage and anti-spam.
3. Tracking endpoint and UTM persistence.
4. Registration attribution handoff.
5. Legal/compliance verification.

## 18. Нефункциональные требования и SLA

- Публичные страницы должны быть быстрыми: целевой `Largest Contentful Paint` и backend responses в пределах marketing SLA; для backend lead-capture `p95 < 400 мс`.
- UTM/attribution и consent должны переживать redirect в auth/lead flow.
- Падение CRM или внешней лид-системы не должно ломать пользовательскую отправку формы без controlled fallback.
- Legal/consent storage обязателен и не может зависеть только от frontend state.

## 19. Observability, логи и алерты

- Метрики: `page_views`, `cta_clicks`, `registration_handoffs`, `lead_submits`, `consent_saved`, `crm_delivery_failures`.
- Логи: lead-form validation, attribution persistence, auth handoff context, consent capture.
- Алерты: рост failed lead submissions, потеря UTM bundle, consent save failures, резкое падение CTA conversions после релиза.
- Dashboards: landing funnel, attribution health, legal/compliance board.

## 20. Риски реализации и архитектурные замечания

- Лендинг нельзя проектировать как purely static layer, если от него зависят consent and attribution handoff.
- Маркетинговые эксперименты не должны обходить обязательные legal блоки.
- Handoff в auth/CRM должен быть versioned и наблюдаемым, иначе конверсии невозможно будет расследовать.
- Нужно заранее определить границу между content management и product backend, чтобы не смешать зоны ответственности.
