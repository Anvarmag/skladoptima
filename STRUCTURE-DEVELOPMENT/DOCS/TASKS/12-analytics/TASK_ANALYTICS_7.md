# TASK_ANALYTICS_7 — QA, Regression и Observability

> Модуль: `12-analytics`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ANALYTICS_1`
  - `TASK_ANALYTICS_2`
  - `TASK_ANALYTICS_3`
  - `TASK_ANALYTICS_4`
  - `TASK_ANALYTICS_5`
  - `TASK_ANALYTICS_6`
- Что нужно сделать:
  - покрыть тестами dashboard на пустом tenant и tenant с продажами;
  - добавить кейсы ABC при равной выручке, stale snapshot, blocked rebuild в `TRIAL_EXPIRED`;
  - проверить, что первый dashboard отдает только согласованный MVP-набор KPI;
  - покрыть recommendations без пользовательских действий `dismiss/applied`;
  - завести метрики и алерты по stale views, failed exports, snapshot build duration, recommendation coverage.
- Критерий закрытия:
  - регрессии по KPI contracts, ABC ranking и policy-block сценариям ловятся автоматически;
  - observability показывает состояние freshness, rebuild и recommendation generation;
  - QA matrix покрывает утвержденную MVP-модель аналитики.

**Что сделано**

- Не выполнено.
