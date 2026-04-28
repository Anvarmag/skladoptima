/**
 * TASK_REFERRALS_2 spec для `BonusWalletService`.
 *
 * Покрывает §8 + §10 + §16:
 *   - getBalance: нет кошелька → 0; есть → баланс;
 *   - getTransactions: нет кошелька → []; есть → cursor-pagination;
 *   - credit: happy path → transactionId, alreadyCredited=false;
 *   - credit: P2002 (дубль) → alreadyCredited=true, без exception;
 *   - credit: нет кошелька → upsert создаёт новый;
 *   - credit: amount <= 0 → ConflictException BONUS_INVALID_AMOUNT;
 *   - debit: happy path → transactionId;
 *   - debit: кошелька нет → ConflictException BONUS_WALLET_NOT_FOUND;
 *   - debit: баланс недостаточен → ConflictException BONUS_INSUFFICIENT_BALANCE;
 *   - debit: amount <= 0 → ConflictException BONUS_INVALID_AMOUNT.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    BonusTransactionType: { CREDIT: 'CREDIT', DEBIT: 'DEBIT' },
}));

import { ConflictException } from '@nestjs/common';
import { BonusWalletService } from './bonus-wallet.service';

const OWNER = 'user-owner';
const WALLET_ID = 'wallet-1';

function makeDecimal(n: number) {
    return { toNumber: () => n } as any;
}

function makePrisma(opts: {
    wallet?: any | null;
    transactions?: any[];
    upsertResult?: any;
    createResult?: any;
    createError?: any;
    updateResult?: any;
} = {}) {
    const wallet = opts.wallet !== undefined
        ? opts.wallet
        : { id: WALLET_ID, balance: makeDecimal(100) };

    const prisma: any = {
        bonusWallet: {
            findUnique: jest.fn().mockResolvedValue(wallet),
            upsert: jest.fn().mockResolvedValue(
                opts.upsertResult ?? { id: WALLET_ID, balance: makeDecimal(250) },
            ),
            update: jest.fn().mockResolvedValue(
                opts.updateResult ?? { id: WALLET_ID, balance: makeDecimal(50) },
            ),
        },
        bonusTransaction: {
            findMany: jest.fn().mockResolvedValue(opts.transactions ?? []),
            create: opts.createError
                ? jest.fn().mockRejectedValue(opts.createError)
                : jest.fn().mockResolvedValue(
                      opts.createResult ?? {
                          id: 'txn-1',
                          type: 'CREDIT',
                          amount: makeDecimal(150),
                          reasonCode: 'REFERRAL_REWARD',
                          referredTenantId: 'tenant-2',
                          metadata: null,
                          createdAt: new Date('2026-04-28T12:00:00Z'),
                      },
                  ),
        },
    };
    // $transaction: выполняет callback с тем же prisma-объектом
    prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    return prisma;
}

// ---------------------------------------------------------------------------
describe('BonusWalletService.getBalance', () => {
    it('нет кошелька → 0', async () => {
        const svc = new BonusWalletService(makePrisma({ wallet: null }));
        const r = await svc.getBalance(OWNER);
        expect(r.balance).toBe(0);
        expect(r.currency).toBe('RUB');
    });

    it('кошелёк есть → возвращает баланс', async () => {
        const svc = new BonusWalletService(makePrisma({ wallet: { id: WALLET_ID, balance: makeDecimal(300) } }));
        const r = await svc.getBalance(OWNER);
        expect(r.balance).toBe(300);
    });
});

// ---------------------------------------------------------------------------
describe('BonusWalletService.getTransactions', () => {
    it('нет кошелька → пустой список', async () => {
        const svc = new BonusWalletService(makePrisma({ wallet: null }));
        const r = await svc.getTransactions(OWNER);
        expect(r.items).toHaveLength(0);
        expect(r.nextCursor).toBeNull();
    });

    it('кошелёк есть, нет транзакций → пустой список', async () => {
        const svc = new BonusWalletService(makePrisma({ transactions: [] }));
        const r = await svc.getTransactions(OWNER);
        expect(r.items).toHaveLength(0);
        expect(r.nextCursor).toBeNull();
    });

    it('возвращает транзакции и nextCursor при наличии следующей страницы', async () => {
        const rows = Array.from({ length: 3 }, (_, i) => ({
            id: `txn-${i}`,
            type: 'CREDIT',
            amount: makeDecimal(100),
            reasonCode: 'REFERRAL_REWARD',
            referredTenantId: `tenant-${i}`,
            metadata: null,
            createdAt: new Date(),
        }));
        const prisma = makePrisma({ transactions: rows });
        const svc = new BonusWalletService(prisma);
        // take=2 + 1 extra → 3 rows → hasMore=true
        const r = await svc.getTransactions(OWNER, { limit: 2 });
        expect(r.items).toHaveLength(2);
        expect(r.nextCursor).toBe('txn-1');
    });

    it('нет следующей страницы → nextCursor=null', async () => {
        const rows = Array.from({ length: 2 }, (_, i) => ({
            id: `txn-${i}`,
            type: 'CREDIT',
            amount: makeDecimal(50),
            reasonCode: 'REFERRAL_REWARD',
            referredTenantId: null,
            metadata: null,
            createdAt: new Date(),
        }));
        const svc = new BonusWalletService(makePrisma({ transactions: rows }));
        const r = await svc.getTransactions(OWNER, { limit: 20 });
        expect(r.items).toHaveLength(2);
        expect(r.nextCursor).toBeNull();
    });
});

// ---------------------------------------------------------------------------
describe('BonusWalletService.credit', () => {
    it('amount <= 0 → ConflictException BONUS_INVALID_AMOUNT', async () => {
        const svc = new BonusWalletService(makePrisma());
        await expect(svc.credit({ ownerUserId: OWNER, amount: 0, reasonCode: 'REFERRAL_REWARD' }))
            .rejects.toThrow(ConflictException);
    });

    it('happy path → alreadyCredited=false, transactionId установлен', async () => {
        const prisma = makePrisma({ createResult: { id: 'txn-new', type: 'CREDIT', amount: makeDecimal(150), reasonCode: 'REFERRAL_REWARD', referredTenantId: 'tenant-2', metadata: null, createdAt: new Date() } });
        const svc = new BonusWalletService(prisma);
        const r = await svc.credit({
            ownerUserId: OWNER, amount: 150,
            reasonCode: 'REFERRAL_REWARD', referredTenantId: 'tenant-2',
        });
        expect(r.alreadyCredited).toBe(false);
        expect(r.transactionId).toBe('txn-new');
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('нет кошелька → upsert создаёт новый', async () => {
        const prisma = makePrisma({ wallet: null });
        const svc = new BonusWalletService(prisma);
        const r = await svc.credit({ ownerUserId: OWNER, amount: 100, reasonCode: 'REFERRAL_REWARD' });
        expect(r.alreadyCredited).toBe(false);
        expect(prisma.bonusWallet.upsert).toHaveBeenCalled();
    });

    it('дубль credit (P2002) → alreadyCredited=true, без exception', async () => {
        const prisma = makePrisma({ createError: { code: 'P2002' } });
        const svc = new BonusWalletService(prisma);
        const r = await svc.credit({
            ownerUserId: OWNER, amount: 150,
            reasonCode: 'REFERRAL_REWARD', referredTenantId: 'tenant-2',
        });
        expect(r.alreadyCredited).toBe(true);
        expect(r.transactionId).toBeNull();
    });

    it('неожиданная ошибка → пробрасывается наверх', async () => {
        const prisma = makePrisma({ createError: new Error('DB_DOWN') });
        const svc = new BonusWalletService(prisma);
        await expect(svc.credit({ ownerUserId: OWNER, amount: 100, reasonCode: 'REFERRAL_REWARD' }))
            .rejects.toThrow('DB_DOWN');
    });
});

// ---------------------------------------------------------------------------
describe('BonusWalletService.debit', () => {
    it('amount <= 0 → ConflictException BONUS_INVALID_AMOUNT', async () => {
        const svc = new BonusWalletService(makePrisma());
        await expect(svc.debit({ ownerUserId: OWNER, amount: -10, reasonCode: 'BONUS_SPEND' }))
            .rejects.toThrow(ConflictException);
    });

    it('нет кошелька → ConflictException BONUS_WALLET_NOT_FOUND', async () => {
        const svc = new BonusWalletService(makePrisma({ wallet: null }));
        await expect(svc.debit({ ownerUserId: OWNER, amount: 50, reasonCode: 'BONUS_SPEND' }))
            .rejects.toMatchObject({ response: { code: 'BONUS_WALLET_NOT_FOUND' } });
    });

    it('баланс недостаточен → ConflictException BONUS_INSUFFICIENT_BALANCE', async () => {
        const svc = new BonusWalletService(makePrisma({
            wallet: { id: WALLET_ID, balance: makeDecimal(30) },
        }));
        await expect(svc.debit({ ownerUserId: OWNER, amount: 100, reasonCode: 'BONUS_SPEND' }))
            .rejects.toMatchObject({ response: { code: 'BONUS_INSUFFICIENT_BALANCE' } });
    });

    it('happy path → transactionId установлен', async () => {
        const createResult = {
            id: 'txn-debit',
            type: 'DEBIT',
            amount: makeDecimal(50),
            reasonCode: 'BONUS_SPEND',
            referredTenantId: null,
            metadata: null,
            createdAt: new Date(),
        };
        const prisma = makePrisma({
            wallet: { id: WALLET_ID, balance: makeDecimal(100) },
            createResult,
        });
        const svc = new BonusWalletService(prisma);
        const r = await svc.debit({ ownerUserId: OWNER, amount: 50, reasonCode: 'BONUS_SPEND' });
        expect(r.transactionId).toBe('txn-debit');
        // Проверяем, что balance.decrement был вызван
        expect(prisma.bonusWallet.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ balance: { decrement: 50 } }),
            }),
        );
    });
});
