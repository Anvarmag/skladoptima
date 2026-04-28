/**
 * TASK_FINANCE_7 spec для `FinanceCostProfileService`.
 *
 * Покрывает §16 (manual input cases):
 *   - role gating Owner/Admin (Manager/Staff → 403);
 *   - tenant ownership (cross-tenant → 404);
 *   - whitelist enforcement (попытка передать revenue/marketplaceFees → 403);
 *   - validation (отрицательные значения → 400);
 *   - audit-trail: isCostManual=true + updatedBy;
 *   - upsert семантика (создание vs обновление).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { Decimal: class { constructor(public n: any) {} toString() { return String(this.n); } } },
    Role: { OWNER: 'OWNER', ADMIN: 'ADMIN', MANAGER: 'MANAGER', STAFF: 'STAFF' },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
}));

import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { FinanceCostProfileService } from './finance-cost-profile.service';
import { FinancePolicyService } from './finance-policy.service';
import { FinanceMetricsRegistry } from './finance.metrics';

const TENANT = 'tenant-1';
const PRODUCT = 'prod-1';
const ACTOR = 'usr-1';

function makePrisma(opts: { role?: string | null; productExists?: boolean; profileExists?: boolean } = {}) {
    return {
        membership: {
            findFirst: jest.fn().mockResolvedValue(opts.role === null ? null : { role: opts.role ?? 'OWNER' }),
        },
        product: {
            findFirst: jest.fn().mockResolvedValue(opts.productExists === false ? null : { id: PRODUCT }),
        },
        productFinanceProfile: {
            findUnique: jest.fn().mockResolvedValue(opts.profileExists ? { id: 'pfp-1' } : null),
            upsert: jest.fn().mockResolvedValue({
                id: 'pfp-new', productId: PRODUCT,
                baseCost: { toString: () => '500' },
                packagingCost: null,
                additionalCost: null,
                costCurrency: 'RUB',
                isCostManual: true,
                updatedAt: new Date('2026-04-28T10:00:00Z'),
            }),
        },
    } as any;
}

function makeSvc(prisma: any) {
    return new FinanceCostProfileService(prisma, new FinancePolicyService(prisma), new FinanceMetricsRegistry());
}

describe('FinanceCostProfileService.updateProductCost — role gating', () => {
    it('OWNER → ok', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        const r = await svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        });
        expect(r.created).toBe(true);
    });

    it('ADMIN → ok', async () => {
        const prisma = makePrisma({ role: 'ADMIN' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        })).resolves.toBeDefined();
    });

    it('MANAGER → 403 ROLE_FORBIDDEN', async () => {
        const prisma = makePrisma({ role: 'MANAGER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        })).rejects.toThrow(ForbiddenException);
    });

    it('STAFF → 403', async () => {
        const prisma = makePrisma({ role: 'STAFF' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        })).rejects.toThrow(ForbiddenException);
    });

    it('нет membership → 403 TENANT_ACCESS_DENIED', async () => {
        const prisma = makePrisma({ role: null });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        })).rejects.toThrow(ForbiddenException);
    });
});

describe('FinanceCostProfileService.updateProductCost — manual whitelist (§13)', () => {
    it('marketplaceFees → 403 MANUAL_INPUT_NOT_ALLOWED, upsert НЕ вызывался', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { marketplaceFees: 100 } as any,
        })).rejects.toThrow(ForbiddenException);
        expect(prisma.productFinanceProfile.upsert).not.toHaveBeenCalled();
    });

    it('revenue → 403, попытка ручной подмены revenue запрещена (§13)', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { revenue: 12345 } as any,
        })).rejects.toThrow(ForbiddenException);
    });

    it('таx/ads/returns/logistics → все запрещены (§14 optional inputs)', async () => {
        for (const field of ['taxImpact', 'adsCost', 'returnsImpact', 'logistics']) {
            const prisma = makePrisma({ role: 'OWNER' });
            const svc = makeSvc(prisma);
            await expect(svc.updateProductCost({
                tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
                input: { [field]: 1 } as any,
            })).rejects.toThrow(ForbiddenException);
        }
    });

    it('baseCost + packagingCost + additionalCost + costCurrency — все 4 разрешены', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500, packagingCost: 50, additionalCost: 20, costCurrency: 'RUB' },
        })).resolves.toBeDefined();
    });
});

describe('FinanceCostProfileService.updateProductCost — tenant ownership', () => {
    it('product не существует или из чужого tenant → 404 PRODUCT_NOT_FOUND', async () => {
        const prisma = makePrisma({ role: 'OWNER', productExists: false });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        })).rejects.toThrow(NotFoundException);
    });
});

describe('FinanceCostProfileService.updateProductCost — validation', () => {
    it('отрицательное значение → 400 COST_VALIDATION_FAILED', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: -100 },
        })).rejects.toThrow(BadRequestException);
    });

    it('NaN → 400', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await expect(svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 'not-a-number' as any },
        })).rejects.toThrow(BadRequestException);
    });

    it('null явно стирает значение, undefined игнорируется', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        // Только baseCost=null, packagingCost не передан
        await svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: null },
        });
        // Update mode: spread не должен включать packagingCost
        const upsertCall = prisma.productFinanceProfile.upsert.mock.calls[0][0];
        expect(upsertCall.update).toHaveProperty('baseCost');
        expect(upsertCall.update).not.toHaveProperty('packagingCost');
    });
});

describe('FinanceCostProfileService.updateProductCost — audit', () => {
    it('isCostManual=true + updatedBy записываются всегда', async () => {
        const prisma = makePrisma({ role: 'OWNER' });
        const svc = makeSvc(prisma);
        await svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        });
        const call = prisma.productFinanceProfile.upsert.mock.calls[0][0];
        expect(call.create.isCostManual).toBe(true);
        expect(call.create.updatedBy).toBe(ACTOR);
        expect(call.update.isCostManual).toBe(true);
        expect(call.update.updatedBy).toBe(ACTOR);
    });

    it('создание (no existing) → created=true, обновление → created=false', async () => {
        const prisma = makePrisma({ role: 'OWNER', profileExists: false });
        const svc = makeSvc(prisma);
        const r1 = await svc.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 500 },
        });
        expect(r1.created).toBe(true);

        const prisma2 = makePrisma({ role: 'OWNER', profileExists: true });
        const svc2 = makeSvc(prisma2);
        const r2 = await svc2.updateProductCost({
            tenantId: TENANT, productId: PRODUCT, actorUserId: ACTOR,
            input: { baseCost: 600 },
        });
        expect(r2.created).toBe(false);
    });
});
