# TASK_FINANCE_1 — Data Model, Cost Profiles и Warnings

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `11-finance`
  - согласованы `05-catalog`, `10-orders`
- Что нужно сделать:
  - завести таблицы `product_finance_profiles`, `finance_snapshots`, `finance_data_warnings`;
  - закрепить manual input только для `base_cost`, `packaging_cost`, `additional_cost`;
  - описать warning types для missing cost, fees, logistics, tax, ads, returns и stale source;
  - предусмотреть `formula_version`, `snapshot_status`, `source_freshness`, `generated_at/by`;
  - согласовать модель с catalog products и normalized orders.
- Критерий закрытия:
  - data model покрывает cost profiles, snapshots и warning layer;
  - ручной ввод периодных расходов не поддерживается в MVP;
  - модель пригодна для воспроизводимого read-model расчета.

**Что сделано**

- Не выполнено.
