import { Injectable } from '@nestjs/common';
import { NotificationDispatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_CHANNEL_PREFERENCES } from './notification.contract';

/** Лимит выборки dispatches для p95 latency — достаточно для точности, не нагружает БД. */
const LATENCY_SAMPLE_LIMIT = 500;

/** Окно delivery-статистики для status dashboard (24 часа). */
const STATS_WINDOW_HOURS = 24;

@Injectable()
export class NotificationsStatusService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Статус каналов и delivery health для owner dashboard.
     *
     * channels — конфигурация и enabled/disabled state каждого канала.
     * delivery — агрегированные счётчики dispatches за последние 24 часа.
     *
     * EMAIL: stub (не отправляет реальные письма до появления провайдера);
     *   `configured` = true, если задан SMTP_HOST или EMAIL_PROVIDER или SENDGRID_API_KEY.
     * IN_APP: всегда configured (native inbox).
     * TELEGRAM/MAX: future-ready, не сконфигурированы в MVP.
     */
    async getStatus(tenantId: string) {
        const [prefs, delivery, latency] = await Promise.all([
            this.prisma.notificationPreferences.findUnique({ where: { tenantId } }),
            this._getDeliveryStats(tenantId),
            this._getDeliveryLatency(tenantId),
        ]);

        const channelPrefs = this._parseJson<Record<string, boolean>>(
            prefs?.channels,
            DEFAULT_CHANNEL_PREFERENCES,
        );

        const emailConfigured = !!(
            process.env.SMTP_HOST ||
            process.env.EMAIL_PROVIDER ||
            process.env.SENDGRID_API_KEY
        );

        const channels = {
            in_app: {
                enabled: channelPrefs['in_app'] !== false,
                configured: true,
                status: channelPrefs['in_app'] !== false ? 'active' : 'disabled',
            },
            email: {
                enabled: channelPrefs['email'] !== false,
                configured: emailConfigured,
                status: channelPrefs['email'] === false
                    ? 'disabled'
                    : emailConfigured ? 'active' : 'stub',
            },
            telegram: {
                enabled: channelPrefs['telegram'] === true,
                configured: false,
                status: 'unconfigured',
            },
            max: {
                enabled: channelPrefs['max'] === true,
                configured: false,
                status: 'unconfigured',
            },
        };

        return {
            tenantId,
            channels,
            delivery,
            latency,
            preferencesUpdatedAt: prefs?.updatedAt ?? null,
        };
    }

    private async _getDeliveryStats(tenantId: string) {
        const since = new Date(Date.now() - STATS_WINDOW_HOURS * 60 * 60 * 1000);

        const stats = await this.prisma.notificationDispatch.groupBy({
            by: ['status'],
            where: {
                event: { tenantId },
                createdAt: { gte: since },
            },
            _count: { _all: true },
        });

        const result: Record<string, number> = {
            queued: 0,
            sent: 0,
            delivered: 0,
            failed: 0,
            skipped: 0,
        };

        for (const row of stats) {
            const key = row.status.toLowerCase() as NotificationDispatchStatus extends string
                ? string
                : never;
            result[key] = row._count._all;
        }

        return { windowHours: STATS_WINDOW_HOURS, ...result };
    }

    /**
     * Вычисляет p50/p95 delivery latency (ms) из реальных dispatches за 24 ч.
     * Latency = sentAt - event.createdAt (event-to-dispatch-to-delivery цепочка).
     */
    private async _getDeliveryLatency(tenantId: string) {
        const since = new Date(Date.now() - STATS_WINDOW_HOURS * 60 * 60 * 1000);

        const rows = await this.prisma.notificationDispatch.findMany({
            where: {
                status: { in: [NotificationDispatchStatus.SENT, NotificationDispatchStatus.DELIVERED] },
                sentAt: { gte: since },
                event: { tenantId },
            },
            select: { sentAt: true, event: { select: { createdAt: true } } },
            take: LATENCY_SAMPLE_LIMIT,
        });

        const values = rows
            .filter((r) => r.sentAt && r.event?.createdAt)
            .map((r) => r.sentAt!.getTime() - r.event.createdAt.getTime())
            .sort((a, b) => a - b);

        if (values.length === 0) {
            return { windowHours: STATS_WINDOW_HOURS, p50_ms: null, p95_ms: null, sample_size: 0 };
        }

        const p = (pct: number) =>
            values[Math.min(values.length - 1, Math.floor(values.length * pct))];

        return {
            windowHours: STATS_WINDOW_HOURS,
            p50_ms: p(0.5),
            p95_ms: p(0.95),
            sample_size: values.length,
        };
    }

    private _parseJson<T extends object>(value: unknown, fallback: T): T {
        if (!value) return fallback;
        if (typeof value === 'object') return value as T;
        try {
            return JSON.parse(value as string) as T;
        } catch {
            return fallback;
        }
    }
}
