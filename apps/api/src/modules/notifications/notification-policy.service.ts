import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    NotificationCategory,
    NotificationChannel,
    NotificationSeverity,
    NotificationDispatchPolicy,
    NotificationPreferences,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    MANDATORY_CATEGORIES,
    DEDUP_WINDOW_MS,
    MVP_CHANNELS,
    THROTTLED_CATEGORIES,
    DEFAULT_CHANNEL_PREFERENCES,
    DEFAULT_CATEGORY_PREFERENCES,
    ChannelDispatchPlan,
    DispatchPlan,
} from './notification.contract';
import { NotificationsMetricsService } from './notifications-metrics.service';

/**
 * Delivery policy engine (TASK_NOTIFICATIONS_2).
 *
 * Единственный источник истины для решений:
 *   1. Какие каналы получат dispatch для конкретного события;
 *   2. Какую политику доставки (INSTANT/SCHEDULED/THROTTLED) применить;
 *   3. Нужно ли пропустить событие как дубль (dedup window).
 *
 * Mandatory rule (§10 system-analytics):
 *   AUTH/BILLING/SYSTEM события ВСЕГДА попадают минимум в IN_APP, даже
 *   если owner отключил все каналы. Это не обходит preferences, а задаёт
 *   пол доставки: can't go below IN_APP for critical alerts.
 *
 * DIGEST policy не реализуется в MVP (§22 confirmed decisions).
 *   NotificationDispatchPolicy.DIGEST не используется ни в одном путе
 *   этого сервиса — future-compatible enum остаётся в схеме, но не
 *   назначается orchestrator'ом.
 *
 * Что НЕ делает сервис:
 *   - НЕ создаёт записи в БД (этим занимается NotificationOrchestrator);
 *   - НЕ форматирует сообщения для каналов (TASK_NOTIFICATIONS_3);
 *   - НЕ отправляет уведомления (TASK_NOTIFICATIONS_3).
 */
@Injectable()
export class NotificationPolicyService {
    private readonly logger = new Logger(NotificationPolicyService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly metrics?: NotificationsMetricsService,
    ) {}

    /**
     * Основной entry point policy engine.
     *
     * Возвращает `DispatchPlan` — либо список каналов/политик для создания
     * dispatch-записей, либо `skippedByDedup=true` если событие является
     * дублём в активном dedup window.
     */
    async evaluate(params: {
        tenantId: string;
        category: NotificationCategory;
        severity: NotificationSeverity;
        isMandatory: boolean;
        dedupKey: string | undefined;
        eventId: string;
    }): Promise<DispatchPlan> {
        const { tenantId, category, severity, isMandatory, dedupKey, eventId } = params;

        // 1. Dedup check — если это не mandatory событие и dedup_key задан,
        //    проверяем активное окно. Mandatory alerts не дедуплицируются
        //    (безопаснее дублировать critical alert, чем потерять).
        if (!isMandatory && dedupKey) {
            const isDuplicate = await this._checkDedup(tenantId, category, dedupKey, eventId);
            if (isDuplicate) {
                this.metrics?.increment('dedup_suppressed');
                this.logger.log(JSON.stringify({
                    event: 'notification_dedup_suppressed',
                    tenantId,
                    category,
                    dedupKey,
                    ts: new Date().toISOString(),
                }));
                return { dispatches: [], skippedByDedup: true };
            }
        }

        // 2. Загружаем preferences tenant'а. Если записи нет — используем дефолты.
        const prefs = await this._loadPreferences(tenantId);

        // 3. Определяем каналы для dispatch.
        const channels = this._selectChannels(category, severity, isMandatory, prefs);

        if (channels.length === 0) {
            // Все каналы подавлены preferences. Для mandatory — не должно
            // происходить (selectChannels гарантирует минимум IN_APP),
            // для optional — валидный результат.
            this.logger.log(JSON.stringify({
                event: 'notification_all_channels_suppressed',
                tenantId,
                category,
                isMandatory,
                ts: new Date().toISOString(),
            }));
            return { dispatches: [], skippedByDedup: false };
        }

        // 4. Назначаем delivery policy каждому каналу.
        const dispatches: ChannelDispatchPlan[] = channels.map((channel) => ({
            channel,
            policy: this._assignPolicy(category, severity, isMandatory),
        }));

        return { dispatches, skippedByDedup: false };
    }

    // ─── Channel selection ────────────────────────────────────────────────

    /**
     * Выбирает каналы доставки с учётом preferences и mandatory rules.
     *
     * Алгоритм:
     *   1. Получаем candidate channels из preferences.channels (только MVP каналы).
     *   2. Если категория отключена в preferences.categories — пустой список
     *      (но mandatory rule ниже перезапишет).
     *   3. Mandatory rule: если isMandatory и итоговый список пустой —
     *      принудительно добавляем IN_APP (минимальный обязательный канал).
     */
    private _selectChannels(
        category: NotificationCategory,
        _severity: NotificationSeverity,
        isMandatory: boolean,
        prefs: NotificationPreferences | null,
    ): NotificationChannel[] {
        const channelPrefs = this._parseJson<Record<string, boolean>>(
            prefs?.channels,
            DEFAULT_CHANNEL_PREFERENCES,
        );
        const categoryPrefs = this._parseJson<Record<string, boolean>>(
            prefs?.categories,
            DEFAULT_CATEGORY_PREFERENCES,
        );

        // Если категория полностью отключена — никаких каналов (кроме mandatory ниже).
        const categoryKey = category.toLowerCase();
        const categoryEnabled = categoryPrefs[categoryKey] ?? true;

        if (!categoryEnabled && !isMandatory) {
            return [];
        }

        // Собираем включённые MVP каналы из preferences.
        const selected: NotificationChannel[] = [];
        for (const channel of MVP_CHANNELS) {
            const channelKey = channel.toLowerCase();
            const channelEnabled = channelPrefs[channelKey] ?? false;
            if (channelEnabled) {
                selected.push(channel);
            }
        }

        // Mandatory rule (§10): для mandatory events гарантируем минимум IN_APP.
        if (isMandatory && !selected.includes(NotificationChannel.IN_APP)) {
            selected.push(NotificationChannel.IN_APP);
        }

        return selected;
    }

    // ─── Policy assignment ────────────────────────────────────────────────

    /**
     * Назначает delivery policy для dispatch.
     *
     * Rules (§14 system-analytics):
     *   - isMandatory или severity=CRITICAL → INSTANT (без исключений);
     *   - SYNC/INVENTORY с INFO/WARNING → THROTTLED (dedup/rate-limit);
     *   - остальные → INSTANT.
     *
     * DIGEST исключён из MVP (§22). SCHEDULED зарезервирован для billing
     * reminder jobs (TASK_NOTIFICATIONS_3+), но не назначается здесь —
     * billing events с явным scheduled delivery будут иметь isMandatory=true
     * и придут с overridden policy от caller, если нужно.
     */
    private _assignPolicy(
        category: NotificationCategory,
        severity: NotificationSeverity,
        isMandatory: boolean,
    ): NotificationDispatchPolicy {
        if (isMandatory || severity === NotificationSeverity.CRITICAL) {
            return NotificationDispatchPolicy.INSTANT;
        }

        // После раннего return выше severity = INFO | WARNING (TypeScript narrowing).
        // SYNC/INVENTORY с non-critical severity → THROTTLED: worker подавит повторы в 15-мин окне.
        if (THROTTLED_CATEGORIES.has(category)) {
            return NotificationDispatchPolicy.THROTTLED;
        }

        return NotificationDispatchPolicy.INSTANT;
    }

    // ─── Dedup check ──────────────────────────────────────────────────────

    /**
     * Проверяет, существует ли событие с тем же (tenantId, category, dedup_key)
     * в рамках DEDUP_WINDOW_MS.
     *
     * Исключает текущий eventId из поиска, чтобы сам свежесозданный event не
     * считался дублём себя.
     */
    private async _checkDedup(
        tenantId: string,
        category: NotificationCategory,
        dedupKey: string,
        currentEventId: string,
    ): Promise<boolean> {
        const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);
        const existing = await this.prisma.notificationEvent.findFirst({
            where: {
                tenantId,
                category,
                dedup_key: dedupKey,
                id: { not: currentEventId },
                createdAt: { gte: windowStart },
            },
            select: { id: true },
        });
        return existing !== null;
    }

    // ─── Preferences loading ──────────────────────────────────────────────

    private async _loadPreferences(tenantId: string): Promise<NotificationPreferences | null> {
        return this.prisma.notificationPreferences.findUnique({
            where: { tenantId },
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    private _parseJson<T extends object>(
        value: unknown,
        fallback: T,
    ): T {
        if (!value) return fallback;
        if (typeof value === 'object') return value as T;
        try {
            return JSON.parse(value as string) as T;
        } catch {
            return fallback;
        }
    }
}
