# TASK_ONBOARDING_2 — State API, Step Updates, Close, Reopen, Complete

> Модуль: `04-onboarding`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_ONBOARDING_1`
- Что нужно сделать:
  - реализовать `GET /onboarding/state`, `POST /start`, `PATCH /steps/:stepKey`, `POST /close`, `POST /reopen`, `POST /complete`;
  - сделать update шагов идемпотентным для повторных кликов и параллельных вкладок;
  - поддержать статусы `pending`, `viewed`, `done`, `skipped`;
  - не разрешать `complete` без стартованного onboarding state;
  - сохранять прогресс консистентно между сессиями.
- Критерий закрытия:
  - state API покрывает полный lifecycle onboarding;
  - skip/reopen/complete работают предсказуемо;
  - backend остается единственным источником истины по прогрессу.

**Что сделано**

- Не выполнено.
