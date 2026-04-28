/**
 * TASK_NOTIFICATIONS_7 — NotificationPolicyService spec.
 *
 * Покрывает policy engine (§9-15 system-analytics):
 *   Dedup:
 *     - дубль sync alert (одинаковый dedupKey в 15-мин окне) → skippedByDedup;
 *     - mandatory event → dedup пропускается (critical alerts не теряются);
 *     - нет dedupKey → dedup check не вызывается.
 *   Channel selection:
 *     - нет preferences → DEFAULT email + in_app;
 *     - email отключён → только in_app;
 *     - категория отключена (non-mandatory) → нет dispatches;
 *     - mandatory event + все каналы выключены → IN_APP принудительно добавляется.
 *   Policy assignment:
 *     - mandatory / CRITICAL → INSTANT;
 *     - SYNC/INVENTORY non-critical → THROTTLED (подавление low-stock / sync-error спама);
 *     - REFERRAL / BILLING non-critical → INSTANT.
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

import { NotificationPolicyService } from './notification-policy.service';
import {
    NotificationCategory,
    NotificationChannel,
    NotificationSeverity,
    NotificationDispatchPolicy,
} from '@prisma/client';

const TENANT = 'tenant-1';
const EV_ID = 'event-new';

function makePrisma(opts: { duplicate?: boolean; prefs?: object | null } = {}) {
    return {
        notificationEvent: {
            findFirst: jest.fn().mockResolvedValue(
                opts.duplicate ? { id: 'event-existing' } : null,
            ),
        },
        notificationPreferences: {
            findUnique: jest.fn().mockResolvedValue(opts.prefs !== undefined ? opts.prefs : null),
        },
    } as any;
}

function baseParams(overrides: Partial<Parameters<NotificationPolicyService['evaluate']>[0]> = {}) {
    return {
        tenantId: TENANT,
        category: NotificationCategory.SYNC,
        severity: NotificationSeverity.WARNING,
        isMandatory: false,
        dedupKey: 'sync_failed:acc-1',
        eventId: EV_ID,
        ...overrides,
    };
}

// ─── Dedup ───────────────────────────────────────────────────────────────────

describe('NotificationPolicyService — dedup', () => {
    it('дубль sync alert (одинаковый dedupKey) → skippedByDedup=true, dispatches пустой', async () => {
        const prisma = makePrisma({ duplicate: true });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams());

        expect(result.skippedByDedup).toBe(true);
        expect(result.dispatches).toHaveLength(0);
        expect(prisma.notificationEvent.findFirst).toHaveBeenCalledTimes(1);
    });

    it('mandatory AUTH event — dedup пропускается даже если dedupKey совпадает', async () => {
        const prisma = makePrisma({ duplicate: true });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.AUTH,
            isMandatory: true,
        }));

        expect(prisma.notificationEvent.findFirst).not.toHaveBeenCalled();
        expect(result.skippedByDedup).toBe(false);
        expect(result.dispatches.length).toBeGreaterThan(0);
    });

    it('нет дубля → skippedByDedup=false, dispatch строится нормально', async () => {
        const prisma = makePrisma({ duplicate: false });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams());

        expect(result.skippedByDedup).toBe(false);
        expect(result.dispatches.length).toBeGreaterThan(0);
    });

    it('нет dedupKey → dedup check не вызывается', async () => {
        // Если бы dedup вызвался — нашёл бы дубль и подавил. Но при dedupKey=undefined проверки нет.
        const prisma = makePrisma({ duplicate: true });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({ dedupKey: undefined }));

        expect(prisma.notificationEvent.findFirst).not.toHaveBeenCalled();
        expect(result.skippedByDedup).toBe(false);
    });
});

// ─── Channel selection ────────────────────────────────────────────────────────

describe('NotificationPolicyService — channel selection', () => {
    it('нет preferences → DEFAULT: email + in_app выбраны (telegram/max нет)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({ dedupKey: undefined }));

        const channels = result.dispatches.map((d) => d.channel);
        expect(channels).toContain(NotificationChannel.EMAIL);
        expect(channels).toContain(NotificationChannel.IN_APP);
        expect(channels).not.toContain(NotificationChannel.TELEGRAM);
        expect(channels).not.toContain(NotificationChannel.MAX);
    });

    it('email отключён в prefs → только in_app', async () => {
        const prefs = {
            tenantId: TENANT,
            channels: { email: false, in_app: true, telegram: false, max: false },
            categories: { sync: true, auth: true, billing: true, inventory: true, referral: true, system: true },
            primaryChannel: 'IN_APP',
        };
        const prisma = makePrisma({ duplicate: false, prefs });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({ dedupKey: undefined }));

        const channels = result.dispatches.map((d) => d.channel);
        expect(channels).toContain(NotificationChannel.IN_APP);
        expect(channels).not.toContain(NotificationChannel.EMAIL);
    });

    it('категория sync отключена в prefs, non-mandatory → нет dispatches', async () => {
        const prefs = {
            tenantId: TENANT,
            channels: { email: true, in_app: true },
            categories: { sync: false },
        };
        const prisma = makePrisma({ duplicate: false, prefs });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.SYNC,
            isMandatory: false,
            dedupKey: undefined,
        }));

        expect(result.dispatches).toHaveLength(0);
        expect(result.skippedByDedup).toBe(false);
    });

    it('mandatory BILLING alert, все каналы отключены → IN_APP принудительно добавляется', async () => {
        const prefs = {
            tenantId: TENANT,
            channels: { email: false, in_app: false, telegram: false, max: false },
            categories: { billing: true },
        };
        const prisma = makePrisma({ duplicate: false, prefs });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.BILLING,
            isMandatory: true,
            dedupKey: undefined,
        }));

        const channels = result.dispatches.map((d) => d.channel);
        expect(channels).toContain(NotificationChannel.IN_APP);
    });

    it('mandatory SYSTEM alert, категория system отключена → IN_APP доставляется несмотря на prefs', async () => {
        const prefs = {
            tenantId: TENANT,
            channels: { email: true, in_app: true },
            categories: { system: false },
        };
        const prisma = makePrisma({ duplicate: false, prefs });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.SYSTEM,
            isMandatory: true,
            dedupKey: undefined,
        }));

        const channels = result.dispatches.map((d) => d.channel);
        expect(channels.length).toBeGreaterThan(0);
        expect(channels).toContain(NotificationChannel.IN_APP);
    });
});

// ─── Policy assignment ────────────────────────────────────────────────────────

describe('NotificationPolicyService — policy assignment', () => {
    it('mandatory event → INSTANT (mandatory alerts не подавляются throttle)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.AUTH,
            isMandatory: true,
            dedupKey: undefined,
        }));

        expect(result.dispatches.length).toBeGreaterThan(0);
        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.INSTANT);
        });
    });

    it('CRITICAL severity → INSTANT (независимо от категории)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            severity: NotificationSeverity.CRITICAL,
            isMandatory: false,
            dedupKey: undefined,
        }));

        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.INSTANT);
        });
    });

    it('SYNC WARNING → THROTTLED (подавление повторяющихся sync alert)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.SYNC,
            severity: NotificationSeverity.WARNING,
            isMandatory: false,
            dedupKey: undefined,
        }));

        expect(result.dispatches.length).toBeGreaterThan(0);
        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.THROTTLED);
        });
    });

    it('INVENTORY INFO → THROTTLED (low-stock throttle, без спама)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.INVENTORY,
            severity: NotificationSeverity.INFO,
            isMandatory: false,
            dedupKey: undefined,
        }));

        expect(result.dispatches.length).toBeGreaterThan(0);
        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.THROTTLED);
        });
    });

    it('REFERRAL INFO → INSTANT (не throttle)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.REFERRAL,
            severity: NotificationSeverity.INFO,
            isMandatory: false,
            dedupKey: undefined,
        }));

        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.INSTANT);
        });
    });

    it('BILLING WARNING non-mandatory → INSTANT (billing важен, не throttle)', async () => {
        const prisma = makePrisma({ duplicate: false, prefs: null });
        const svc = new NotificationPolicyService(prisma);

        const result = await svc.evaluate(baseParams({
            category: NotificationCategory.BILLING,
            severity: NotificationSeverity.WARNING,
            isMandatory: false,
            dedupKey: undefined,
        }));

        result.dispatches.forEach((d) => {
            expect(d.policy).toBe(NotificationDispatchPolicy.INSTANT);
        });
    });
});
