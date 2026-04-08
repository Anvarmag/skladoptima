# TASK_ORDERS_6 — Frontend Orders UX и Diagnostics

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
  - `TASK_ORDERS_5`
- Что нужно сделать:
  - расширить `/app/orders` фильтрами, внутренними статусами и stock-effect indicators;
  - собрать карточку заказа и timeline событий;
  - показывать, влияет ли заказ на stock и применился ли side-effect успешно;
  - объяснить `UNRESOLVED`, `unmatched SKU`, `warehouse scope missing`, `blocked stock effect`;
  - при `TRIAL_EXPIRED / SUSPENDED / CLOSED` показать, что история доступна, но новые внешние заказы не поступают до снятия паузы.
- Критерий закрытия:
  - UI отражает внутреннюю доменную логику, а не только сырой marketplace status;
  - пользователь понимает причину отсутствия stock-effect;
  - фронтенд не создает ложных ожиданий по paused integrations.

**Что сделано**

- Не выполнено.
