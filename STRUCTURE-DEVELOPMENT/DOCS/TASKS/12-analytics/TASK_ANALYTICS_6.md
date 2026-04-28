# TASK_ANALYTICS_6 — Frontend Dashboard, Drill-Down и Recommendation UX

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
  - `TASK_ANALYTICS_4`
  - `TASK_ANALYTICS_5`
- Что нужно сделать:
  - собрать единый UX для KPI cards, revenue dynamics, ABC, top products и SKU drill-down;
  - визуально различать `fresh`, `stale`, `incomplete`;
  - показать рекомендации как explainable read-only hints;
  - не выводить UI-элементы, создающие ожидание пользовательского workflow по recommendations;
  - при paused tenant показать read-only/stale mode без обещания runtime refresh.
- Критерий закрытия:
  - аналитика объясняет цифры и рекомендации, а не только отображает их;
  - stale/incomplete states читаются без двусмысленности;
  - UI остается сфокусированным на согласованном MVP-наборе KPI и витрин.

**Что сделано**

Полная переработка [Analytics.tsx](apps/web/src/pages/Analytics.tsx) с заменой legacy on-the-fly endpoints на новые витрины TASK_ANALYTICS_2..5. Старая страница использовала `/analytics/recommendations` (без объяснений), `/analytics/revenue-dynamics` (фиксированные 14 дней без period picker'а) и моковые KPI цифры. Новая — реальный dashboard на `dashboard / revenue-dynamics / abc / top / recommendations / status` с period picker'ом, freshness бейджем, read-only подсказками, paused-баннером и drill-down drawer'ом.

### 1. Используемые APIs (все новые из TASK_ANALYTICS_2..5)

| Endpoint | Что использует |
|---|---|
| `GET /analytics/dashboard?from=&to=` | KPI cards + freshness verdict |
| `GET /analytics/revenue-dynamics?from=&to=` | график WB/Ozon area chart |
| `GET /analytics/abc?from=&to=` | pie + group counts/shares |
| `GET /analytics/products/top?from=&to=&limit=10` | таблица Top SKU |
| `GET /analytics/recommendations` | read-only hints |
| `GET /analytics/status` | meta: lastEventAt, ageHours, daily.rowsCount, recs.activeCount |
| `GET /analytics/products/:id?from=&to=` | drill-down drawer |
| `POST /analytics/daily/rebuild` | rebuild button (Owner/Admin) |
| `POST /analytics/abc/rebuild` | rebuild button |
| `POST /analytics/recommendations/refresh` | refresh button |
| `GET /analytics/export?target=daily|abc&format=csv` | CSV download |

Legacy endpoints (`/analytics/recommendations/legacy`, `/analytics/geo`, `/analytics/revenue-dynamics/legacy`) **больше не вызываются** из UI и могут быть удалены в следующей итерации.

### 2. UX контракт

**§13 первый dashboard MVP — ровно 6 KPI tiles**:
- Чистая выручка (`revenueNet`)
- Заказов (`ordersCount`)
- Штук продано (`unitsSold`)
- Средний чек (`avgCheck`)
- Возвратов (`returnsCount`)
- Топ маркетплейс (`topMarketplaceShare.marketplace + sharePct`)

`revenueGross` намеренно НЕ показан — сохраняем синхронизацию с backend MVP-набором.

**Freshness badge** — `dashboard.freshness.classification` рендерится бейджем с tone:

| Classification | Tone | Label |
|---|---|---|
| `FRESH_AND_COMPLETE` | emerald | «Свежие и полные» |
| `STALE_BUT_COMPLETE` | amber | «Устаревшие источники» |
| `INCOMPLETE_BUT_FRESH` | orange | «Неполные данные» |
| `STALE_AND_INCOMPLETE` | rose | «Устаревшие и неполные» |
| (snapshot=EMPTY) | slate | «Нет данных за период» |

Каждый бейдж имеет `title` с человеческим объяснением. Карточка `SnapshotMetaCard` показывает: бейдж + formulaVersion + lastEventAt + ageHours + daily rowsCount + activeRecsCount.

**Recommendations как read-only hints (§15)**:
- Карточка `RecommendationsCard` рендерит ACTIVE подсказки.
- Каждая показывает: priority badge (HIGH/MEDIUM/LOW), human label `RULE_LABEL[ruleKey]`, message от backend, объяснение `REASON_EXPLAIN[reasonCode]`.
- Кнопок `dismiss / apply / в план` НЕТ (старая страница имела «В план» — убрана).
- Единственное действие — `Подробнее` ведёт в drill-down drawer этого SKU.

**Period picker** — два `<input type="date">` (default: последние 30 дней). Все вызовы dashboard / dynamics / abc / top / drill-down параметризуются периодом, refetch при смене.

**Paused-баннер** — если `activeTenant.accessState ∈ {TRIAL_EXPIRED, SUSPENDED, CLOSED}`:
- амбер-баннер с текстом `«Read-only режим. Tenant в состоянии {state}. Рекомендации и snapshot'ы остаются доступны на чтение, rebuild/refresh заблокированы политикой компании»`;
- все три rebuild-кнопки `disabled` + `title` объясняет почему;
- read остаётся работающим — это важно для §4 сценарий 4.

**Drill-down drawer** — правая панель открывается по клику на SKU в Top или из «Подробнее» в рекомендации:
- 6 KPI (revenueNet, unitsSold, ordersCount, returnsCount, avgPrice, period);
- таблица последних 30 заказов с marketplace / № / дата / шт / сумма / статус.

### 3. Защита от backend ошибок

- Все запросы в `Promise.all` — один `try/catch` ловит любую ошибку и показывает её в `error` баннере с возможностью закрыть.
- Empty states по каждому блоку:
  - dashboard `EMPTY` → серый бейдж «Нет данных за период», нулевые KPI;
  - ABC snapshot отсутствует → плейсхолдер с кнопкой «Построить сейчас»;
  - Top пустой → «Нет данных за период»;
  - Recommendations пустой → emerald «Нет активных подсказок. Можно работать.»;

### 4. Архитектура компонента

```
Analytics                       — root state + fetchAll + rebuild handlers
├── PeriodPicker                — from/to date inputs
├── SnapshotMetaCard            — freshness badge + meta
├── KpiGrid                     — 6 KPI tiles
├── RevenueDynamics chart       — recharts AreaChart wb/ozon
├── ABC pie + group breakdown
├── TopProductsCard             — таблица + CSV export daily
├── RecommendationsCard         — read-only hints
└── ProductDrawer (modal)       — drill-down drawer
```

Все sub-компоненты получают данные через props, никаких глобальных store — переиспользуют `useAuth` для `activeTenant`.

### 5. CSV Export

Кнопки `CSV daily` (внутри Top SKU карточки) и `CSV` (внутри ABC карточки) открывают `/analytics/export?target=...&format=csv` через `window.open` — браузер скачивает файл напрямую (backend выставляет `Content-Disposition: attachment`).

### 6. Что НЕ делает (намеренно)

- НЕ показывает `gross revenue` в dashboard (§13 правило MVP);
- НЕ вытаскивает legacy endpoints в UI (они остаются на backend как backward-compat, но frontend на них не ходит);
- НЕ добавляет dismiss/applied workflow для рекомендаций (§15);
- НЕ инициирует rebuild при paused tenant (§5 + §10 контракт TASK_ANALYTICS_5).

### 7. Проверки

- `npx tsc --noEmit` (apps/web) → **0 ошибок**, все типы из ответов API совпадают с backend.
- Lint: одно предупреждение от recharts о deprecated `Cell` — это API-level deprecation в recharts 3.x, поведение работает; миграция на `<Pie children=...>` в отдельной задаче.
- Backend tests: `jest --testPathPatterns="analytics"` → 76/76 ✓ (без изменений, frontend трогает только потребление API).

### 8. DoD сверка

- ✅ **Аналитика объясняет цифры и рекомендации, а не только отображает их**: каждая рекомендация имеет `RULE_LABEL` + `message` + `REASON_EXPLAIN` (3 уровня детализации — заголовок правила, конкретное сообщение, объяснение почему сработало). Бейдж freshness имеет `title` с пояснением. KPI tiles содержат `topMarketplaceShare` с долей в %.
- ✅ **Stale/incomplete states читаются без двусмысленности**: 4 разных tone'а (emerald/amber/orange/rose), отдельные labels, явные `title` объяснения. Backend `evaluateStaleness` и frontend бейджи используют один источник истины — `freshness.classification`.
- ✅ **UI остаётся сфокусированным на согласованном MVP-наборе KPI и витрин**: 6 KPI tiles ровно по §13, никаких дополнительных метрик; recommendations подкармливаются только из rule engine (без freeform комментариев); export ограничен daily/abc.

### 9. Что НЕ сделано (за пределами scope)

- **Удаление `analytics.service.ts` (legacy backend)** — endpoints всё ещё под `/analytics/*/legacy`, удаление в отдельной cleanup-итерации.
- **Метрики/observability + nightly cron** — TASK_ANALYTICS_7.
- **Геоаналитика (`/analytics/geo`)** — не входит в MVP-set §13.
