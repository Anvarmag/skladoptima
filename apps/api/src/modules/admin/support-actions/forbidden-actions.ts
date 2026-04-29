/// Реестр запрещённых support-действий (TASK_ADMIN_5 §15, §22).
///
/// Это «защитный» source of truth для код-ревью и тестов: каждое из этих
/// действий ОТСУТСТВУЕТ в admin-плоскости намеренно. Если кто-то соберётся
/// добавить новый endpoint, который попадает под одну из категорий ниже —
/// он должен либо удалить запись из этого реестра вместе с product/security
/// approval'ом, либо отказаться от endpoint'а.
///
/// Реестр НЕ исполняется в runtime-guard'е (нет «отрицательного» enforcement'а),
/// но используется в тестах как whitelist «support-плоскость не объявляет
/// маршрутов с этими токенами» (см. forbidden-actions.spec.ts).
export const FORBIDDEN_SUPPORT_ACTIONS = {
    /// Логин «как пользователь» / impersonation — в MVP полностью запрещены.
    /// SUPPORT не получает session-токен tenant-пользователя ни через какой
    /// endpoint. Если нужен доступ от лица user'а — это всегда reset-flow и
    /// явный self-service login пользователем.
    LOGIN_AS_USER: 'login-as-user',
    IMPERSONATE: 'impersonate',

    /// Чтение plaintext-секретов: пароли, password hashes, API-ключи,
    /// marketplace-токены. Tenant 360 отдаёт только status-поля
    /// (`credentialStatus`), но никогда сам секрет.
    READ_PASSWORD_HASH: 'read-password-hash',
    READ_PLAINTEXT_PASSWORD: 'read-plaintext-password',
    READ_MARKETPLACE_CREDENTIALS: 'read-marketplace-credentials',

    /// Billing override: выдача платного доступа без записи в биллинговом
    /// контуре. Технически закрыто двумя слоями:
    ///   1. SetAccessStateDto разрешает только {TRIAL_ACTIVE, SUSPENDED};
    ///   2. AccessStatePolicy.assertSupportTransitionAllowed бросает
    ///      `BILLING_OVERRIDE_NOT_ALLOWED` при попытке target ∈
    ///      {ACTIVE_PAID, GRACE_PERIOD, EARLY_ACCESS}.
    BILLING_OVERRIDE: 'billing-override',
    SPECIAL_FREE_ACCESS: 'special-free-access',
    GRANT_PAID_PLAN: 'grant-paid-plan',

    /// Произвольная запись в БД мимо доменных контрактов. Любое mutation
    /// идёт строго через TenantService.*/AuthService.* — admin-плоскость
    /// не имеет endpoint'ов, принимающих SQL/JSON-patch/raw payload.
    RAW_SQL: 'raw-sql',
    DIRECT_DB_PATCH: 'direct-db-patch',

    /// Действия, требующие отдельного product/legal review до включения в MVP.
    /// Сейчас умышленно отсутствуют — фиксируем, чтобы не «протекли» через
    /// расширение существующих endpoint'ов.
    DELETE_TENANT_HARD: 'delete-tenant-hard',
    DELETE_USER_HARD: 'delete-user-hard',
    EXPORT_TENANT_PII: 'export-tenant-pii',
} as const;

export type ForbiddenSupportAction =
    (typeof FORBIDDEN_SUPPORT_ACTIONS)[keyof typeof FORBIDDEN_SUPPORT_ACTIONS];

/// URL-подстроки, которых НЕ должно быть ни в одном controller-маршруте
/// admin-плоскости. Используется в integration-тесте forbidden-actions.spec.ts.
export const FORBIDDEN_ADMIN_ROUTE_TOKENS: readonly string[] = Object.values(
    FORBIDDEN_SUPPORT_ACTIONS,
);
