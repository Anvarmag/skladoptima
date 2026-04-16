# Управление командой — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Оценить, как tenant масштабирует доступ через инвайты, насколько эффективно проходят активация участников и насколько стабильно работает модель ролей (Primary Owner / Admin / Manager / Staff). Метрики раздела напрямую влияют на retention и скорость операционной работы команды.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Invite Acceptance Rate | Доля принятых инвайтов | >= 60% | `accepted_invites / sent_invites` |
| Invite Time to Accept | Время от отправки до принятия | <= 48ч p50 | `median(invite_accepted_at - invite_sent_at)` |
| Team Activation Rate | Доля tenant с минимум 2 активными участниками | >= 50% | `tenants_with_2plus_active_members / active_tenants` |
| Role Change Error Rate | Ошибки изменения ролей | <= 1% | `failed_role_changes / role_change_attempts` |
| Pending Invite Aging | Инвайты старше 7 дней | <= 20% | `pending_invites_7d / pending_invites_total` |

---

## 3. Воронки и конверсии

```
Отправка инвайта -> Открытие ссылки -> Принятие -> Первый вход участника -> Первая активность
100%             -> 72%            -> 60%      -> 54%                  -> 48%
```

Отдельно для новых пользователей по приглашению:

```
Invite link -> Регистрация -> Verify email -> Membership активен
100%        -> 68%         -> 58%         -> 55%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Primary Owner | Активно приглашает и управляет ролями | Удобный список команды и статус инвайтов |
| Admin | Поддерживает операционное управление | Прозрачные границы прав |
| Manager | Чаще всего исполнитель в операциях | Быстрый доступ к рабочим модулям без billing/admin рисков |
| Staff | Ограниченное использование | Минимальная сложность интерфейса и четкие запреты |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `team_invite_sent` | Отправлен инвайт | `role_assigned`, `inviter_role`, `channel=email` | High |
| `team_invite_resend` | Повторная отправка инвайта | `invite_age_days`, `resend_count` | Med |
| `team_invite_accepted` | Инвайт принят | `accept_latency_hours`, `existing_user` | High |
| `team_invite_expired` | Ссылка истекла | `days_since_send` | Med |
| `team_member_role_changed` | Изменена роль участника | `from_role`, `to_role`, `actor_role` | High |
| `team_member_removed` | Удаление участника из tenant | `removed_role`, `actor_role` | High |
| `team_member_left` | Участник сам вышел из tenant | `member_role` | Med |
| `team_permission_denied` | Попытка действия без прав | `module`, `required_role`, `actor_role` | High |

---

## 6. Текущее состояние (baseline)

- UI модуля в roadmap обозначен как неполный, поэтому baseline нужно собирать с момента запуска полного сценария инвайтов.
- Отдельно нужен baseline по просроченным инвайтам и причинам отказа.
- По ролям сейчас нет единого отчета по распределению участников внутри tenant.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Email-шаблон инвайта с конкретным CTA повысит принятие | `Invite Acceptance Rate` | Идея |
| Авто-напоминание через 48 часов снизит долю pending invite | `Pending Invite Aging` | Идея |
| Отдельный экран ролей с предупреждением о последствиях уменьшит ошибки | `Role Change Error Rate` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Team Growth: динамика участников по tenant и ролям.
- [ ] Invite Funnel: отправлено/принято/истекло/отклонено.
- [ ] Role Governance: изменения ролей, удаления, permission denied.
- [ ] Collaboration Health: tenant с активной командой, а не solo-owner.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Низкое принятие инвайтов | `< 40%` | Пересмотреть copy, deliverability и срок ссылки |
| Высокий процент истекших ссылок | `> 30% pending` | Добавить авто-reminder и валидацию процесса приглашений |
| Рост permission denied у Manager | `> 8% действий` | Проверить RBAC матрицу и UX обозначение прав |
| Удаление участников без последующей замены | `> 10% в неделю` | Алерт Owner о риске потери операционного покрытия |

---

## 11. Источники данных и правила расчета

- Основной источник: `invitations`, `memberships`, audit/team events.
- Invite funnel считается по `invitation_id`, а не только по email, чтобы не терять resend и повторные invite.
- Team activation tenant считается по active memberships, исключая `suspended/left`.
- Permission denied для роли Manager должен считаться отдельно по модулю, чтобы различать UX-проблему и реальную нехватку прав.

---

## 12. Data Quality и QA-проверки

- Один email не должен иметь две `PENDING` invitations в один tenant одновременно.
- `accepted_invites` не может превышать `sent_invites` по одной когорте invite.
- QA должна проверить invite existing user, invite new user, expired invite, resend, role change, last owner guard.
- При удалении участника membership не должен физически исчезать из истории аналитики, если нужен retention analysis.

---

## 13. Владельцы метрик и ритм ревью

- Product owner: invite acceptance и team activation.
- Backend lead: RBAC, membership lifecycle, invite expiry/reminders.
- QA: role matrix и edge-cases по ownership.
- Data review: еженедельно по invite funnel, ежемесячно по team growth и role distribution.

---

## 14. Зависимости, допущения и границы

- Командная модель строится поверх tenant membership и не может интерпретироваться отдельно от tenant lifecycle.
- Роль пользователя должна оцениваться в рамках tenant, а не глобально по системе.
- Сценарии приглашений существующих и новых пользователей необходимо анализировать раздельно, потому что у них разная friction и другая причина отказов.
- Ограничения по последнему owner и критичным правам не являются UX-решением, это обязательное бизнес-правило безопасности владения tenant.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
