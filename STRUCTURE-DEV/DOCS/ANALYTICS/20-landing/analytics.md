# Лендинг — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять эффективность лендинга как маркетинговой воронки: от трафика и engagement до регистрации и лидов, с учетом SEO и юридически корректного сбора данных. Метрики раздела используются для роста входящего потока и оптимизации конверсии в продукт.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Visitor-to-Registration Start | Конверсия посетителя в старт регистрации | >= 6% | `start_registration / unique_visitors` |
| Registration Completion from Landing | Конверсия в успешную регистрацию | >= 3% | `registration_success / unique_visitors` |
| Lead Form Conversion | Конверсия в лид (демо/заявка) | >= 2% | `submit_lead_form / unique_visitors` |
| CTA Click-Through Rate | CTR ключевых CTA блоков | >= 12% | `cta_clicks / cta_impressions` |
| SEO Organic Share | Доля органического трафика | Рост QoQ | `organic_sessions / total_sessions` |
| Consent Compliance Rate | Формы с корректно зафиксированным согласием | 100% | `forms_with_consent_record / form_submits_total` |

---

## 3. Воронки и конверсии

```
Page view -> CTA click -> Start registration -> Registration success
100%      -> 12%       -> 6%                -> 3%
```

Вторичная воронка лидов:

```
Page view -> Scroll to pricing -> Click demo/lead -> Submit lead form
100%      -> 40%              -> 8%             -> 2%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Новый холодный трафик | Быстро сканирует hero/benefits | Четкое УТП за 5-10 секунд |
| Теплый трафик (UTM campaign) | Смотрит pricing и FAQ | Сильный CTA и социальное доказательство |
| B2B/демо-ориентированные лиды | Чаще отправляет форму | Понятная демонстрационная ценность |
| Органический SEO трафик | Приходит по информационным запросам | Релевантный контент и скорость страницы |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `landing_page_view` | Просмотр лендинга | `utm_source`, `utm_campaign`, `device` | High |
| `landing_click_cta_register` | Клик на регистрацию | `cta_position`, `section` | High |
| `landing_click_cta_demo` | Клик на демо/заявку | `cta_position`, `section` | High |
| `landing_click_cta_pricing` | Клик по тарифам | `section`, `plan_highlighted` | Med |
| `landing_scroll_to_pricing` | Доскролл до pricing-блока | `scroll_depth` | Med |
| `landing_start_registration` | Переход в auth-flow | `source=landing`, `utm_bundle` | High |
| `landing_registration_success` | Успешная регистрация из лендинга | `attribution_window` | High |
| `landing_submit_lead_form` | Отправлена lead/demo форма | `form_type`, `consent_checked` | High |
| `landing_legal_doc_opened` | Открыт юридический документ | `doc_type=privacy/terms/cookies` | Med |
| `landing_cookie_consent_updated` | Пользователь принял/изменил consent | `consent_state` | High |

---

## 6. Текущее состояние (baseline)

- Раздел отсутствует, baseline фиксируется при запуске публичного сайта.
- Первичный baseline должен быть разбит по каналам трафика: organic, paid, direct, referral.
- Юридический baseline: 100% форм должны отправляться только при фиксированном consent.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Переписанный hero с акцентом на “синхронизацию остатков” повысит CTR регистрации | `Visitor-to-Registration Start` | Идея |
| Упрощенный pricing блок с 3 ключевыми ограничениями повысит переход в auth | `landing_click_cta_register` | Идея |
| Блок кейсов с конкретными цифрами улучшит lead conversion | `Lead Form Conversion` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Landing Funnel: visitor -> CTA -> registration start -> success.
- [ ] Channel Attribution: UTM-эффективность и стоимость канала.
- [ ] Engagement Report: scroll-depth, FAQ/price/legal interactions.
- [ ] Compliance Report: consent capture и юридические события.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Падение CTR ключевых CTA | `< 8%` | Пересмотреть message и расположение CTA |
| Низкая конверсия start->success | `< 40%` | Проверить связку лендинг -> auth flow |
| Резкое падение органического трафика | `-30% WoW` | SEO-аудит: индексация, meta, скорость |
| Формы без consent | Любой случай | Немедленный compliance fix |

---

## 11. Источники данных и правила расчета

- Источники: web analytics events, registration attribution, lead form submissions, CRM handoff events, cookie/consent logs.
- Visitor-to-registration и registration success должны строиться по единой attribution logic и окну конверсии.
- Lead conversion должна отделять валидные B2B/демо лиды от технического спама и тестовых отправок.
- Consent compliance считается по факту сохраненного consent-record, а не только по отметке чекбокса на фронте.

---

## 12. Data Quality и QA-проверки

- QA должна проверить CTA tracking, UTM persistence, переход в auth, успешную регистрацию, отправку lead-form, cookie consent и legal links.
- Источники трафика не должны теряться при редиректах между лендингом и auth-flow.
- Формы не должны отправляться без обязательных полей и зафиксированного согласия на обработку данных.
- Метрики SEO и paid traffic должны быть защищены от внутренних тестовых посещений и ботов.

---

## 13. Владельцы метрик и ритм ревью

- Growth/product owner: conversion funnel и CTA effectiveness.
- Marketing/data owner: attribution quality, channel performance, SEO share.
- Backend/frontend lead: стабильность handoff лендинг -> auth/CRM и consent storage.
- Review cadence: ежедневный контроль лидов и регистрации, еженедельный разбор каналов и A/B гипотез.

---

## 14. Зависимости, допущения и границы

- Лендинг остается публичным acquisition-слоем и не должен тащить в себя продуктовую бизнес-логику beyond lead/auth handoff.
- Атрибуция должна переживать навигацию между маркетинговыми страницами, лендингом и формой регистрации.
- Consent и legal tracking обязательны для каждой формы и не могут быть отключены маркетинговыми экспериментами.
- Для экспериментов A/B нужна стабильная система идентификации визитов и исключение внутренних сотрудников/ботов из отчетов.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
