/**
 * TASK_ANALYTICS_5 spec для `AnalyticsPolicyService`.
 *
 * Покрывает §10 + §13 + §16 + §19:
 *   - assertRebuildAllowed блокирует TRIAL_EXPIRED / SUSPENDED / CLOSED;
 *   - read остаётся доступным во ВСЕХ состояниях (включая paused);
 *   - evaluateStaleness корректно различает 4 классификации;
 *   - source-of-truth контракт зафиксирован константой (не меняется
 *     случайно — regression assertion);
 *   - integration refresh запрещён (load-bearing flag).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
    AnalyticsSnapshotStatus: {
        READY: 'READY', STALE: 'STALE', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED',
    },
}));

import { ForbiddenException } from '@nestjs/common';
import {
    AnalyticsPolicyService,
    ANALYTICS_FORBIDS_INTEGRATION_REFRESH,
    ANALYTICS_SOURCE_OF_TRUTH,
} from './analytics-policy.service';

const TENANT = 'tenant-1';

function makePrisma(accessState: string | null) {
    return {
        tenant: {
            findUnique: jest.fn().mockResolvedValue(
                accessState === null ? null : { accessState, id: TENANT },
            ),
        },
    } as any;
}

describe('AnalyticsPolicyService.assertRebuildAllowed', () => {
    it.each([
        ['ACTIVE_PAID', true],
        ['TRIAL_ACTIVE', true],
        ['EARLY_ACCESS', true],
        ['GRACE_PERIOD', true],
    ])('allows rebuild при %s', async (state, _ok) => {
        const svc = new AnalyticsPolicyService(makePrisma(state));
        await expect(svc.assertRebuildAllowed(TENANT)).resolves.toBe(state);
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'blocks rebuild при %s → 403 ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE',
        async (state) => {
            const svc = new AnalyticsPolicyService(makePrisma(state));
            await expect(svc.assertRebuildAllowed(TENANT)).rejects.toThrow(ForbiddenException);
        },
    );

    it('tenant не существует → 403 с reason tenant_not_found', async () => {
        const svc = new AnalyticsPolicyService(makePrisma(null));
        await expect(svc.assertRebuildAllowed(TENANT)).rejects.toThrow(ForbiddenException);
    });
});

describe('AnalyticsPolicyService.isReadAllowed', () => {
    it.each(['ACTIVE_PAID', 'TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'read разрешён при %s (history read-only)',
        async (state) => {
            const svc = new AnalyticsPolicyService(makePrisma(state));
            await expect(svc.isReadAllowed(TENANT)).resolves.toBe(true);
        },
    );

    it('tenant не существует → false', async () => {
        const svc = new AnalyticsPolicyService(makePrisma(null));
        await expect(svc.isReadAllowed(TENANT)).resolves.toBe(false);
    });
});

describe('AnalyticsPolicyService.evaluateStaleness', () => {
    const svc = new AnalyticsPolicyService({} as any);

    it('FRESH_AND_COMPLETE: source свежий, status READY', () => {
        expect(
            svc.evaluateStaleness({
                sourceFreshness: { orders: { isStale: false } },
                snapshotStatus: 'READY',
            }),
        ).toEqual({ isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE' });
    });

    it('STALE_BUT_COMPLETE: source stale, status READY', () => {
        expect(
            svc.evaluateStaleness({
                sourceFreshness: { orders: { isStale: true } },
                snapshotStatus: 'READY',
            }).classification,
        ).toBe('STALE_BUT_COMPLETE');
    });

    it('INCOMPLETE_BUT_FRESH: status INCOMPLETE, source свежий', () => {
        expect(
            svc.evaluateStaleness({
                sourceFreshness: { orders: { isStale: false } },
                snapshotStatus: 'INCOMPLETE',
            }).classification,
        ).toBe('INCOMPLETE_BUT_FRESH');
    });

    it('STALE_AND_INCOMPLETE: обе проблемы одновременно', () => {
        expect(
            svc.evaluateStaleness({
                sourceFreshness: { orders: { isStale: true } },
                snapshotStatus: 'INCOMPLETE',
            }).classification,
        ).toBe('STALE_AND_INCOMPLETE');
    });

    it('snapshotStatus=STALE сам по себе → isStale=true (без sourceFreshness)', () => {
        expect(
            svc.evaluateStaleness({ sourceFreshness: null, snapshotStatus: 'STALE' }).isStale,
        ).toBe(true);
    });
});

describe('AnalyticsPolicyService.isLastEventStale (static helper)', () => {
    it('null → false (нет события — нечего считать stale)', () => {
        expect(AnalyticsPolicyService.isLastEventStale(null)).toBe(false);
    });

    it('событие < 48h назад → false', () => {
        const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
        expect(AnalyticsPolicyService.isLastEventStale(recent)).toBe(false);
    });

    it('событие > 48h назад → true', () => {
        const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
        expect(AnalyticsPolicyService.isLastEventStale(old)).toBe(true);
    });
});

describe('Source-of-truth contracts (load-bearing)', () => {
    it('ANALYTICS_FORBIDS_INTEGRATION_REFRESH === true', () => {
        // Если кто-то изменит на false — тест падает; сигнал, что добавился
        // обходной путь к marketplace API из analytics слоя.
        expect(ANALYTICS_FORBIDS_INTEGRATION_REFRESH).toBe(true);
    });

    it('ANALYTICS_SOURCE_OF_TRUTH покрывает все витрины и не использует raw API', () => {
        const keys = Object.keys(ANALYTICS_SOURCE_OF_TRUTH);
        expect(keys).toEqual(
            expect.arrayContaining([
                'daily_layer',
                'abc_snapshot',
                'recommendations_low_stock',
                'recommendations_low_rating',
                'recommendations_stale',
                'export',
                'status',
            ]),
        );
        for (const value of Object.values(ANALYTICS_SOURCE_OF_TRUTH)) {
            // Каждая запись должна явно фиксировать «НЕ raw marketplace API»
            // или указывать нормализованную витрину/таблицу — это
            // load-bearing документация, regression на §13 контракт.
            const v = value.toLowerCase();
            expect(
                v.includes('не raw') ||
                    v.includes('не live') ||
                    v.includes('materialized') ||
                    v.includes('нормализованн') ||
                    v.includes('aggregate'),
            ).toBe(true);
        }
    });
});
