import {
    NotificationCategory,
    NotificationChannel,
    NotificationSeverity,
    NotificationDispatchPolicy,
} from '@prisma/client';

// ─── Mandatory categories ──────────────────────────────────────────
// AUTH/BILLING/SYSTEM события не могут быть полностью подавлены
// пользовательскими preferences (§4 сценарий 4, §10 аналитики).
// Enforcement happens in NotificationPolicyService.
export const MANDATORY_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
    NotificationCategory.AUTH,
    NotificationCategory.BILLING,
    NotificationCategory.SYSTEM,
]);

// ─── Dedup window ──────────────────────────────────────────────────
// §10: 15-минутное окно дедупликации на уровне событий. Проверяется в
// NotificationPolicyService._checkDedup для событий с явным dedupKey.
// Только не-mandatory события дедуплицируются — critical alerts не
// должны теряться из-за dedup (безопаснее дублировать, чем потерять).
export const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ─── Throttle window ───────────────────────────────────────────────
// §14/§15: окно подавления повторных dispatches для THROTTLED policy.
// Применяется в NotificationDeliveryWorker._isThrottleSuppressed.
// Намеренно равно DEDUP_WINDOW_MS — унифицированное 15-минутное окно
// для обоих уровней подавления. Отдельная константа для ясности
// при независимом изменении любого из окон в будущем.
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (intentionally same as DEDUP_WINDOW_MS)

// ─── Channels available in MVP ─────────────────────────────────────
// §22: MVP scope — EMAIL + IN_APP. TELEGRAM/MAX future-ready.
export const MVP_CHANNELS: ReadonlySet<NotificationChannel> = new Set([
    NotificationChannel.EMAIL,
    NotificationChannel.IN_APP,
]);

// ─── Future-ready channels (not implemented in MVP) ────────────────
// TELEGRAM и MAX — реализация адаптеров в будущих задачах (TASK_NOTIFICATIONS_6+).
// В текущем delivery worker они вернут permanent FAILED с кодом CHANNEL_NOT_IMPLEMENTED.
// Status API явно показывает их как configured: false, status: 'unconfigured'.
// Добавить в MVP_CHANNELS после реализации соответствующего адаптера.
export const FUTURE_CHANNELS: ReadonlySet<NotificationChannel> = new Set([
    NotificationChannel.TELEGRAM,
    NotificationChannel.MAX,
]);

// ─── Default dispatch policy per category/severity ─────────────────
// THROTTLED для повторяющихся info/warning событий SYNC и INVENTORY.
// INSTANT для всех остальных (включая mandatory).
export const THROTTLED_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
    NotificationCategory.SYNC,
    NotificationCategory.INVENTORY,
]);

// ─── Input DTO for domain modules ─────────────────────────────────
// Доменный модуль вызывает NotificationsService.publishEvent() с этим объектом.
// isMandatory по умолчанию определяется категорией через MANDATORY_CATEGORIES,
// но caller может явно override на true для конкретного события.
export interface PublishNotificationInput {
    tenantId: string;
    category: NotificationCategory;
    severity: NotificationSeverity;
    /** Явный override mandatory. Если не задан — определяется по категории. */
    isMandatory?: boolean;
    /**
     * Ключ дедупликации в формате `<event_type>:<entity_id>`, например
     * `sync_run_failed:acc_xxx`. Вместе с tenantId+category формирует 15-мин
     * dedup окно (DEDUP_WINDOW_MS). Опционален — события без ключа не дедуплицируются.
     */
    dedupKey?: string;
    /** Контекст для workers при форматировании сообщения. */
    payload?: Record<string, unknown>;
}

// ─── Dispatch plan ─────────────────────────────────────────────────
// Результат работы policy engine — план каналов и политики доставки.
export interface ChannelDispatchPlan {
    channel: NotificationChannel;
    policy: NotificationDispatchPolicy;
}

export interface DispatchPlan {
    dispatches: ChannelDispatchPlan[];
    /** Событие было пропущено из-за dedup (duplicate в active window). */
    skippedByDedup: boolean;
}

// ─── Default preferences fallback ──────────────────────────────────
// Используется когда tenant не имеет записи NotificationPreferences.
//
// ВАЖНО: ключи должны быть строго lowercase (совпадают с JSONB-ключами в
// notification_preferences.channels/categories). Policy service ищет по
// channel.toLowerCase() и category.toLowerCase(). Использование uppercase
// ключей (как в Prisma enum) приводит к тому, что все каналы показываются
// отключёнными для тенантов без preferences, и не-mandatory события теряются.
export const DEFAULT_CHANNEL_PREFERENCES: Record<string, boolean> = {
    email: true,
    in_app: true,
    telegram: false,
    max: false,
};

export const DEFAULT_CATEGORY_PREFERENCES: Record<string, boolean> = {
    auth: true,
    billing: true,
    sync: true,
    inventory: true,
    referral: true,
    system: true,
};
