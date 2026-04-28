import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancePolicyService } from './finance-policy.service';
import { FinanceMetricsRegistry, FinanceMetricNames } from './finance.metrics';

/**
 * Cost profile updates (TASK_FINANCE_4).
 *
 * Manual input в MVP **разрешён только** для трёх полей: `baseCost`,
 * `packagingCost`, `additionalCost` (§10 + §13 + §20 риск). Любая
 * попытка через API передать другое поле игнорируется на DTO-слое;
 * сервис принимает только эти три поля.
 *
 * Role gating: только Owner/Admin (§6 API table). Сервис проверяет
 * membership самостоятельно — текущая архитектура не пробрасывает role
 * в request, и заводить отдельный RolesGuard ради двух endpoint'ов
 * избыточно (тот же подход, что в `OrdersReprocessService`).
 *
 * Tenant state: PATCH запрещён при TRIAL_EXPIRED/SUSPENDED/CLOSED через
 * `TenantWriteGuard` на controller-слое. Здесь дополнительная проверка
 * не нужна (write-guard уже отбил).
 */

export interface UpdateCostInput {
    baseCost?: number | string | null;
    packagingCost?: number | string | null;
    additionalCost?: number | string | null;
    costCurrency?: string;
}

export interface UpdateCostResult {
    productId: string;
    profileId: string;
    baseCost: string | null;
    packagingCost: string | null;
    additionalCost: string | null;
    costCurrency: string;
    isCostManual: boolean;
    updatedAt: string;
    /** true если профиль был создан (не существовал ранее). */
    created: boolean;
}

@Injectable()
export class FinanceCostProfileService {
    private readonly logger = new Logger(FinanceCostProfileService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: FinancePolicyService,
        private readonly metrics: FinanceMetricsRegistry,
    ) {}

    /**
     * Upsert cost profile per product. Любое из трёх полей `null` =
     * явное стирание значения (UI отправил пустой input). Не
     * передавать поле = оставить как есть.
     */
    async updateProductCost(args: {
        tenantId: string;
        productId: string;
        actorUserId: string;
        input: UpdateCostInput;
    }): Promise<UpdateCostResult> {
        // ── 0. TASK_FINANCE_5: source-of-truth whitelist enforcement ─
        // Если caller передал поле, не входящее в MANUAL_COST_FIELDS_WHITELIST
        // — кидаем 403. DTO уже отсекает большинство, но эта runtime-
        // проверка защищает на случай прямого вызова сервиса (например,
        // из cron job'а или другого модуля).
        for (const key of Object.keys(args.input)) {
            const v = (args.input as any)[key];
            if (v === undefined) continue;
            try {
                this.policy.assertManualCostInputAllowed(key);
            } catch (err) {
                this.metrics.increment(FinanceMetricNames.MANUAL_INPUT_REJECTED, {
                    tenantId: args.tenantId,
                    reason: key,
                });
                throw err;
            }
        }

        // ── 1. Role guard: Owner/Admin only ──────────────────────────
        const membership = await this.prisma.membership.findFirst({
            where: { tenantId: args.tenantId, userId: args.actorUserId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        if (membership.role !== Role.OWNER && membership.role !== Role.ADMIN) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }

        // ── 2. Validate product принадлежит tenant'у ─────────────────
        const product = await this.prisma.product.findFirst({
            where: { id: args.productId, tenantId: args.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!product) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        // ── 3. Validate values: >= 0, no NaN/Infinity ────────────────
        const baseCost = this._normalize(args.input.baseCost, 'baseCost');
        const packagingCost = this._normalize(args.input.packagingCost, 'packagingCost');
        const additionalCost = this._normalize(args.input.additionalCost, 'additionalCost');

        // ── 4. Upsert ────────────────────────────────────────────────
        const existing = await this.prisma.productFinanceProfile.findUnique({
            where: { productId: args.productId },
            select: { id: true },
        });

        const upsertData = {
            // Только переданные поля. undefined = не трогать.
            ...(args.input.baseCost !== undefined ? { baseCost } : {}),
            ...(args.input.packagingCost !== undefined ? { packagingCost } : {}),
            ...(args.input.additionalCost !== undefined ? { additionalCost } : {}),
            ...(args.input.costCurrency ? { costCurrency: args.input.costCurrency.slice(0, 3).toUpperCase() } : {}),
            isCostManual: true,
            updatedBy: args.actorUserId,
        };

        const profile = await this.prisma.productFinanceProfile.upsert({
            where: { productId: args.productId },
            create: {
                tenantId: args.tenantId,
                productId: args.productId,
                baseCost: baseCost ?? null,
                packagingCost: packagingCost ?? null,
                additionalCost: additionalCost ?? null,
                costCurrency: args.input.costCurrency?.slice(0, 3).toUpperCase() ?? 'RUB',
                isCostManual: true,
                updatedBy: args.actorUserId,
            },
            update: upsertData,
        });

        this.logger.log(JSON.stringify({
            event: 'finance_cost_profile_updated',
            tenantId: args.tenantId,
            productId: args.productId,
            actorUserId: args.actorUserId,
            wasCreated: !existing,
        }));
        this.metrics.increment(FinanceMetricNames.COST_PROFILE_UPDATES, {
            tenantId: args.tenantId,
            reason: existing ? 'update' : 'create',
        });

        return {
            productId: profile.productId,
            profileId: profile.id,
            baseCost: profile.baseCost?.toString() ?? null,
            packagingCost: profile.packagingCost?.toString() ?? null,
            additionalCost: profile.additionalCost?.toString() ?? null,
            costCurrency: profile.costCurrency,
            isCostManual: profile.isCostManual,
            updatedAt: profile.updatedAt.toISOString(),
            created: !existing,
        };
    }

    private _normalize(v: number | string | null | undefined, field: string): Prisma.Decimal | null {
        if (v === undefined) return null;
        if (v === null) return null;
        const num = typeof v === 'string' ? parseFloat(v) : v;
        if (!Number.isFinite(num)) {
            throw new BadRequestException({
                code: 'COST_VALIDATION_FAILED',
                message: `${field} must be a finite number`,
            });
        }
        if (num < 0) {
            throw new BadRequestException({
                code: 'COST_VALIDATION_FAILED',
                message: `${field} must be >= 0`,
            });
        }
        // Prisma Decimal принимает number/string — используем строку
        // чтобы не потерять precision на больших значениях.
        return new Prisma.Decimal(num.toFixed(2));
    }
}
