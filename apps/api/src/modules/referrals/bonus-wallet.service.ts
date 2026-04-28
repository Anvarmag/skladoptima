import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Бонусный леджер (TASK_REFERRALS_2).
 *
 * Принципы:
 *   1. `credit` и `debit` — единственные мутирующие методы. Они атомарно
 *      пишут запись в `BonusTransaction` и обновляют `BonusWallet.balance`
 *      в одной DB-транзакции. Прямой UPDATE balance вне этих методов
 *      запрещён — DoD §8/§10.
 *
 *   2. Идемпотентность credit: UNIQUE(walletId, reasonCode, referredTenantId)
 *      гарантирует, что один referred tenant не получит reward дважды.
 *      P2002 → `alreadyCredited: true` без exception (вызывающий код —
 *      first-payment webhook — должен трактовать это как успех).
 *
 *   3. NULL referredTenantId (debit, ручные операции) — PostgreSQL NULLS
 *      DISTINCT, поэтому несколько строк с NULL разрешены (доп. гарантий
 *      не нужно).
 */

export interface CreditArgs {
    ownerUserId: string;
    amount: number;
    reasonCode: string;
    referredTenantId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface DebitArgs {
    ownerUserId: string;
    amount: number;
    reasonCode: string;
    referredTenantId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface CreditResult {
    alreadyCredited: boolean;
    transactionId: string | null;
}

export interface BonusTransactionDto {
    id: string;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    reasonCode: string;
    referredTenantId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface BalanceDto {
    balance: number;
    currency: string;
}

export interface TransactionsDto {
    items: BonusTransactionDto[];
    nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class BonusWalletService {
    private readonly logger = new Logger(BonusWalletService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Возвращает текущий баланс владельца. Если кошелёк ещё не создан
     * (owner ни разу не получал reward) — возвращает 0, не бросает 404.
     */
    async getBalance(ownerUserId: string): Promise<BalanceDto> {
        const wallet = await this.prisma.bonusWallet.findUnique({
            where: { ownerUserId },
            select: { balance: true },
        });
        return {
            balance: wallet ? toNumber(wallet.balance) : 0,
            currency: 'RUB',
        };
    }

    /**
     * Paginated история операций (cursor-based по `id`).
     * Если кошелёк не существует — возвращает пустой список.
     */
    async getTransactions(ownerUserId: string, opts?: { limit?: number; cursor?: string }): Promise<TransactionsDto> {
        const wallet = await this.prisma.bonusWallet.findUnique({
            where: { ownerUserId },
            select: { id: true },
        });
        if (!wallet) return { items: [], nextCursor: null };

        const take = Math.min(opts?.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

        const rows = await this.prisma.bonusTransaction.findMany({
            where: { walletId: wallet.id },
            orderBy: { createdAt: 'desc' },
            take: take + 1,
            ...(opts?.cursor
                ? { cursor: { id: opts.cursor }, skip: 1 }
                : {}),
        });

        const hasMore = rows.length > take;
        const items = hasMore ? rows.slice(0, take) : rows;

        return {
            items: items.map(txToDto),
            nextCursor: hasMore ? items[items.length - 1].id : null,
        };
    }

    /**
     * Зачисляет бонус owner'у. Атомарно:
     *   1. upsert BonusWallet (создаёт при первом reward);
     *   2. создаёт BonusTransaction(CREDIT);
     *   3. инкрементирует balance.
     *
     * P2002 → уже зачислено, idempotent: `alreadyCredited: true`.
     */
    async credit(args: CreditArgs): Promise<CreditResult> {
        if (args.amount <= 0) {
            throw new ConflictException({ code: 'BONUS_INVALID_AMOUNT', message: 'credit amount must be positive' });
        }
        try {
            const txn = await this.prisma.$transaction(async (tx) => {
                const wallet = await tx.bonusWallet.upsert({
                    where: { ownerUserId: args.ownerUserId },
                    create: { ownerUserId: args.ownerUserId, balance: args.amount },
                    update: { balance: { increment: args.amount } },
                });
                return tx.bonusTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: 'CREDIT',
                        amount: args.amount,
                        reasonCode: args.reasonCode,
                        referredTenantId: args.referredTenantId ?? null,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        metadata: (args.metadata ?? null) as any,
                    },
                });
            });
            this.logger.log(
                `bonus_credit owner=${args.ownerUserId} amount=${args.amount} reason=${args.reasonCode} txn=${txn.id}`,
            );
            return { alreadyCredited: false, transactionId: txn.id };
        } catch (err: any) {
            if (err?.code === 'P2002') {
                // UNIQUE(walletId, reasonCode, referredTenantId) violated — already credited.
                this.logger.warn(
                    `bonus_credit_duplicate owner=${args.ownerUserId} reason=${args.reasonCode} referredTenant=${args.referredTenantId}`,
                );
                return { alreadyCredited: true, transactionId: null };
            }
            throw err;
        }
    }

    /**
     * Списывает бонус для оплаты. Проверяет наличие кошелька и достаточность
     * баланса. Атомарно: создаёт BonusTransaction(DEBIT) + decrements balance.
     */
    async debit(args: DebitArgs): Promise<{ transactionId: string }> {
        if (args.amount <= 0) {
            throw new ConflictException({ code: 'BONUS_INVALID_AMOUNT', message: 'debit amount must be positive' });
        }
        const result = await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.bonusWallet.findUnique({
                where: { ownerUserId: args.ownerUserId },
            });
            if (!wallet) {
                throw new ConflictException({ code: 'BONUS_WALLET_NOT_FOUND' });
            }
            if (toNumber(wallet.balance) < args.amount) {
                throw new ConflictException({ code: 'BONUS_INSUFFICIENT_BALANCE' });
            }
            await tx.bonusWallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: args.amount } },
            });
            return tx.bonusTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: 'DEBIT',
                    amount: args.amount,
                    reasonCode: args.reasonCode,
                    referredTenantId: args.referredTenantId ?? null,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    metadata: (args.metadata ?? null) as any,
                },
            });
        });
        this.logger.log(
            `bonus_debit owner=${args.ownerUserId} amount=${args.amount} reason=${args.reasonCode} txn=${result.id}`,
        );
        return { transactionId: result.id };
    }
}

function toNumber(v: Decimal | number): number {
    if (typeof v === 'number') return v;
    return v.toNumber();
}

function txToDto(t: {
    id: string;
    type: string;
    amount: Decimal | number;
    reasonCode: string;
    referredTenantId: string | null;
    metadata: unknown;
    createdAt: Date;
}): BonusTransactionDto {
    return {
        id: t.id,
        type: t.type as 'CREDIT' | 'DEBIT',
        amount: toNumber(t.amount as Decimal | number),
        reasonCode: t.reasonCode,
        referredTenantId: t.referredTenantId ?? null,
        metadata: (t.metadata as Record<string, unknown>) ?? null,
        createdAt: t.createdAt.toISOString(),
    };
}
