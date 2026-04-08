# TASK_FINANCE_2 — Calculator Service, Formula Versioning и Completeness Rules

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_FINANCE_1`
  - согласованы `10-orders`, `05-catalog`
- Что нужно сделать:
  - реализовать расчет `Revenue`, `COGS`, `Profit`, `MarginPct`, `ROIPct`;
  - version-ировать формулы через `formula_version`;
  - считать обязательным ядром `base_cost + marketplace fees + logistics`;
  - при отсутствии `ads / tax / returns` не скрывать строку, а ставить `isIncomplete=true` и warnings;
  - не подменять отсутствующие критичные данные молчаливыми нулями.
- Критерий закрытия:
  - расчет детерминирован и воспроизводим;
  - incomplete строки объяснимы и не маскируются под полные;
  - formula version позволяет воспроизвести исторические цифры.

**Что сделано**

- Не выполнено.
