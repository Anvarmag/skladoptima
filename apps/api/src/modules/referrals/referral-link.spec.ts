/**
 * TASK_REFERRALS_1 spec для `ReferralLinkService`.
 *
 * Покрывает §6:
 *   - getOrCreateForOwner идемпотентен — повторный вызов возвращает
 *     существующую ссылку без exception;
 *   - параллельные вызовы (P2002 на UNIQUE owner+tenant) сходятся к одной;
 *   - findActiveByCode возвращает null для битых кодов и неактивных;
 *   - findActiveByCode нормализует регистр (case-insensitive lookup).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
}));

import { ReferralLinkService } from './referral-link.service';

function makePrisma(opts: { existing?: any | null; createResult?: any; createError?: any } = {}) {
    return {
        referralLink: {
            findUnique: jest
                .fn()
                .mockResolvedValueOnce(opts.existing ?? null)
                .mockResolvedValue(opts.existing ?? null),
            create: opts.createError
                ? jest.fn().mockRejectedValue(opts.createError)
                : jest.fn().mockResolvedValue(
                      opts.createResult ?? {
                          id: 'rl-1', code: 'ABCD1234', isActive: true,
                          createdAt: new Date('2026-04-28T10:00:00Z'),
                      },
                  ),
        },
    } as any;
}

describe('ReferralLinkService.getOrCreateForOwner', () => {
    it('существующая ссылка → возвращает без create', async () => {
        const prisma = makePrisma({
            existing: {
                id: 'rl-old', code: 'OLDCODE1', isActive: true,
                createdAt: new Date('2026-04-01T00:00:00Z'),
            },
        });
        const svc = new ReferralLinkService(prisma);
        const r = await svc.getOrCreateForOwner({ ownerUserId: 'u1', tenantId: 't1' });
        expect(r.code).toBe('OLDCODE1');
        expect(prisma.referralLink.create).not.toHaveBeenCalled();
    });

    it('нет ссылки → создаёт новую', async () => {
        const prisma = makePrisma({});
        const svc = new ReferralLinkService(prisma);
        const r = await svc.getOrCreateForOwner({ ownerUserId: 'u1', tenantId: 't1' });
        expect(r.code).toBe('ABCD1234');
        expect(prisma.referralLink.create).toHaveBeenCalled();
    });

    it('race: P2002 → читает уже созданную параллельно', async () => {
        const prisma = makePrisma({
            createError: { code: 'P2002' },
        });
        // Первый findUnique вернул null, второй (после P2002) вернёт существующую.
        prisma.referralLink.findUnique = jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: 'rl-concurrent', code: 'CONCRT12', isActive: true,
                createdAt: new Date('2026-04-28T10:00:00Z'),
            });
        const svc = new ReferralLinkService(prisma);
        const r = await svc.getOrCreateForOwner({ ownerUserId: 'u1', tenantId: 't1' });
        expect(r.code).toBe('CONCRT12');
    });
});

describe('ReferralLinkService.findActiveByCode', () => {
    it('пустой код → null без обращения к БД', async () => {
        const prisma = makePrisma({});
        const svc = new ReferralLinkService(prisma);
        expect(await svc.findActiveByCode('')).toBeNull();
        expect(await svc.findActiveByCode('   ')).toBeNull();
    });

    it('код не найден → null', async () => {
        const prisma = {
            referralLink: { findUnique: jest.fn().mockResolvedValue(null) },
        } as any;
        const svc = new ReferralLinkService(prisma);
        expect(await svc.findActiveByCode('NOTFOUND')).toBeNull();
    });

    it('isActive=false → null', async () => {
        const prisma = {
            referralLink: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'rl-x', code: 'INACTIVE', ownerUserId: 'u', tenantId: 't', isActive: false,
                }),
            },
        } as any;
        const svc = new ReferralLinkService(prisma);
        expect(await svc.findActiveByCode('INACTIVE')).toBeNull();
    });

    it('нормализует регистр (case-insensitive lookup)', async () => {
        const prisma = {
            referralLink: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'rl', code: 'UPPER123', ownerUserId: 'u', tenantId: 't', isActive: true,
                }),
            },
        } as any;
        const svc = new ReferralLinkService(prisma);
        await svc.findActiveByCode('upper123');
        expect(prisma.referralLink.findUnique).toHaveBeenCalledWith({
            where: { code: 'UPPER123' },
            select: expect.any(Object),
        });
    });
});
