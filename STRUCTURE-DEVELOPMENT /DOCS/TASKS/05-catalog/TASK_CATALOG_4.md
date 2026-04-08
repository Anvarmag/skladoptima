# TASK_CATALOG_4 — Auto/Manual Mappings и Duplicate Merge

> Модуль: `05-catalog`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_1`
  - `TASK_CATALOG_3`
  - согласованы `08-marketplace-accounts` и `09-sync`
- Что нужно сделать:
  - реализовать auto-match по SKU и manual mapping для unmatched external items;
  - реализовать `GET unmatched` и `POST manual mapping`;
  - добавить ручной merge дублей как дополнительный MVP-сценарий;
  - не позволять sync/import бесконтрольно перепривязывать mapping;
  - писать mapping/merge изменения в audit.
- Критерий закрытия:
  - unmatched товары видны и могут быть вручную связаны;
  - duplicate merge поддержан как отдельный управляемый сценарий;
  - mappings остаются консистентны между импортом, sync и orders/stocks flow.

**Что сделано**

- Не выполнено.
