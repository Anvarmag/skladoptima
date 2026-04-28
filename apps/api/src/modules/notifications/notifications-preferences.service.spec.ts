/**
 * TASK_NOTIFICATIONS_7 — NotificationsPreferencesService spec.
 *
 * Покрывает §10 и §22 system-analytics (mandatory channel protection):
 *   - хотя бы один MVP-канал (email или in_app) должен оставаться включённым;
 *   - попытка выключить оба → ForbiddenException MANDATORY_NOTIFICATION_CHANNEL_REQUIRED;
 *   - partial merge: незатронутые поля сохраняются из existing;
 *   - нет записи → возвращаются дефолты с isDefault=true.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    NotificationCategory: {
        AUTH: 'AUTH', BILLING: 'BILLING', SYNC: 'SYNC',
        INVENTORY: 'INVENTORY', REFERRAL: 'REFERRAL', SYSTEM: 'SYSTEM',
    },
    NotificationChannel: { EMAIL: 'EMAIL', IN_APP: 'IN_APP', TELEGRAM: 'TELEGRAM', MAX: 'MAX' },
    NotificationSeverity: { CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' },
    NotificationDispatchPolicy: { INSTANT: 'INSTANT', THROTTLED: 'THROTTLED', SCHEDULED: 'SCHEDULED', DIGEST: 'DIGEST' },
    NotificationDispatchStatus: { QUEUED: 'QUEUED', SENT: 'SENT', DELIVERED: 'DELIVERED', FAILED: 'FAILED', SKIPPED: 'SKIPPED' },
}));

import { ForbiddenException } from '@nestjs/common';
import { NotificationsPreferencesService } from './notifications-preferences.service';

const TENANT = 'tenant-1';

function makePrefsRecord(channels: Record<string, boolean> = { email: true, in_app: true }) {
    return {
        tenantId: TENANT,
        channels,
        categories: { auth: true, billing: true, sync: true, inventory: true, referral: true, system: true },
        primaryChannel: 'IN_APP',
        digestTime: null,
        timezone: null,
        updatedAt: new Date('2026-04-28T10:00:00Z'),
    };
}

function makePrisma(opts: { existing?: any | null } = {}) {
    const existing = opts.existing !== undefined ? opts.existing : null;
    return {
        notificationPreferences: {
            findUnique: jest.fn().mockResolvedValue(existing),
            upsert: jest.fn().mockImplementation(({ create, update }: any) =>
                Promise.resolve({ ...(existing ?? {}), ...(existing ? update : create), tenantId: TENANT, updatedAt: new Date() })
            ),
        },
    } as any;
}

// ─── getPreferences ──────────────────────────────────────────────────────────

describe('NotificationsPreferencesService.getPreferences', () => {
    it('нет записи → возвращает дефолты с isDefault=true', async () => {
        const prisma = makePrisma({ existing: null });
        const svc = new NotificationsPreferencesService(prisma);

        const result = await svc.getPreferences(TENANT);

        expect(result.isDefault).toBe(true);
        expect(result.channels).toMatchObject({ email: true, in_app: true });
    });

    it('запись существует → isDefault=false, возвращает сохранённые значения', async () => {
        const prisma = makePrisma({ existing: makePrefsRecord({ email: false, in_app: true }) });
        const svc = new NotificationsPreferencesService(prisma);

        const result = await svc.getPreferences(TENANT);

        expect(result.isDefault).toBe(false);
    });
});

// ─── updatePreferences — mandatory channel protection ────────────────────────

describe('NotificationsPreferencesService.updatePreferences — mandatory channel protection', () => {
    it('отключить email, оставить in_app → разрешено, upsert вызван', async () => {
        const prisma = makePrisma({ existing: null });
        const svc = new NotificationsPreferencesService(prisma);

        await expect(
            svc.updatePreferences(TENANT, { channels: { email: false, in_app: true } }),
        ).resolves.not.toThrow();

        expect(prisma.notificationPreferences.upsert).toHaveBeenCalledTimes(1);
    });

    it('отключить in_app, оставить email → разрешено', async () => {
        const prisma = makePrisma({ existing: null });
        const svc = new NotificationsPreferencesService(prisma);

        await expect(
            svc.updatePreferences(TENANT, { channels: { email: true, in_app: false } }),
        ).resolves.not.toThrow();
    });

    it('отключить оба MVP-канала → ForbiddenException (MANDATORY_NOTIFICATION_CHANNEL_REQUIRED)', async () => {
        const prisma = makePrisma({ existing: null });
        const svc = new NotificationsPreferencesService(prisma);

        await expect(
            svc.updatePreferences(TENANT, { channels: { email: false, in_app: false } }),
        ).rejects.toThrow(ForbiddenException);

        expect(prisma.notificationPreferences.upsert).not.toHaveBeenCalled();
    });

    it('частичное обновление: existing email=true, меняем только in_app=false → email сохранён', async () => {
        const prisma = makePrisma({
            existing: makePrefsRecord({ email: true, in_app: true }),
        });
        const svc = new NotificationsPreferencesService(prisma);

        await svc.updatePreferences(TENANT, { channels: { in_app: false } });

        const upsertCall = prisma.notificationPreferences.upsert.mock.calls[0][0];
        expect(upsertCall.update.channels.email).toBe(true);
        expect(upsertCall.update.channels.in_app).toBe(false);
    });

    it('владелец пытается выключить mandatory security/billing alerts через channels → защищено', async () => {
        // Оба канала выключены = ForbiddenException даже если категория billing/auth
        const prisma = makePrisma({ existing: makePrefsRecord({ email: true, in_app: true }) });
        const svc = new NotificationsPreferencesService(prisma);

        await expect(
            svc.updatePreferences(TENANT, {
                channels: { email: false, in_app: false },
                categories: { billing: false, auth: false },
            }),
        ).rejects.toThrow(ForbiddenException);
    });
});
