import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, ReferralAttributionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudGuardService } from './fraud-guard.service';
import { ReferralAuditService } from './referral-audit.service';
import { ReferralLinkService } from './referral-link.service';

/**
 * Двухэтапная attribution-логика рефералов (TASK_REFERRALS_1).
 *
 * §13 + §10 контракт:
 *   1. **Регистрация** (`captureRegistration`):
 *      - валидируем код через `ReferralLinkService.findActiveByCode`;
 *      - сохраняем `ReferralAttribution(referredUserId, status=ATTRIBUTED,
 *        referredTenantId=null)` + utm/sourceIp/userAgent context;
 *      - UNIQUE(referredUserId) гарантирует, что повторный signup того
 *        же user-а не создаёт дубль; при collision возвращаем существующую.
 *      - НЕ кидаем exception если код невалидный — регистрация должна
 *        пройти даже с битой ссылкой; attribution просто не создаётся.
 *
 *   2. **Tenant creation** (`lockOnTenantCreation`):
 *      - находим attribution по `referredUserId`;
 *      - self-referral check: если `link.ownerUserId === userId` ИЛИ
 *        у user уже была membership в `link.tenantId` → status=REJECTED,
 *        rejectionReason='SELF_REFERRAL_BLOCKED', НЕ ставим referredTenantId
 *        (reward всё равно никогда не начислится);
 *      - иначе ставим `referredTenantId` + `tenantLockedAt = now`. UNIQUE
 *        на `referredTenantId` — §13 lock policy.
 *      - **idempotent**: если attribution уже locked на этого tenant'а,
 *        возвращаем без exception (повторный вызов tenant creation не
 *        ломает ничего).
 *      - **conflict**: если attribution уже locked на ДРУГОЙ tenant'а —
 *        кидаем `409 REFERRAL_ATTRIBUTION_ALREADY_LOCKED`. Это §13 правило
 *        «не допускает silent reassignment».
 *
 * Status `PAID` / `REWARDED` / `FRAUD_REVIEW` выставляются позже —
 * billing/wallet/anti-fraud (TASK_REFERRALS_4/5). Здесь только этапы
 * attribution context'а.
 */

export interface CaptureRegistrationArgs {
    referralCode: string;
    referredUserId: string;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    sourceIp?: string | null;
    userAgent?: string | null;
}

export interface CaptureRegistrationResult {
    captured: boolean;
    attributionId: string | null;
    /** Коды отказа: `INVALID_CODE` (код не найден/неактивен) или `null` если ok. */
    reason: 'INVALID_CODE' | 'ALREADY_CAPTURED' | null;
}

export interface LockOnTenantCreationArgs {
    referredUserId: string;
    referredTenantId: string;
}

export interface LockOnTenantCreationResult {
    locked: boolean;
    attributionId: string | null;
    status: ReferralAttributionStatus;
    rejectionReason: string | null;
    /** True если attribution для этого user'а нет (нерефератный signup). */
    skipped: boolean;
}

@Injectable()
export class ReferralAttributionService {
    private readonly logger = new Logger(ReferralAttributionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly linkService: ReferralLinkService,
        private readonly fraudGuard: FraudGuardService,
        private readonly audit: ReferralAuditService,
    ) {}

    /**
     * Этап 1: фиксируем attribution context при успешной регистрации.
     * Идемпотентен по `referredUserId` (UNIQUE).
     */
    async captureRegistration(args: CaptureRegistrationArgs): Promise<CaptureRegistrationResult> {
        const code = (args.referralCode ?? '').trim().toUpperCase();
        if (!code) {
            return { captured: false, attributionId: null, reason: 'INVALID_CODE' };
        }

        const link = await this.linkService.findActiveByCode(code);
        if (!link) {
            this.logger.warn(
                `referral attribution skipped: invalid code=${code} user=${args.referredUserId}`,
            );
            return { captured: false, attributionId: null, reason: 'INVALID_CODE' };
        }

        try {
            const attribution = await this.prisma.referralAttribution.create({
                data: {
                    referralLinkId: link.id,
                    referralCode: code,
                    referredUserId: args.referredUserId,
                    status: ReferralAttributionStatus.ATTRIBUTED,
                    utmSource: args.utmSource ?? null,
                    utmMedium: args.utmMedium ?? null,
                    utmCampaign: args.utmCampaign ?? null,
                    utmContent: args.utmContent ?? null,
                    utmTerm: args.utmTerm ?? null,
                    sourceIp: args.sourceIp ?? null,
                    userAgent: args.userAgent ?? null,
                },
            });
            this.logger.log(
                `referral attribution captured user=${args.referredUserId} code=${code} ` +
                    `attribution=${attribution.id}`,
            );
            void this.audit.log({
                eventType: 'ATTRIBUTION_CAPTURED',
                attributionId: attribution.id,
                actorId: args.referredUserId,
                data: { code, utmSource: args.utmSource ?? null, sourceIp: args.sourceIp ?? null },
            });
            return { captured: true, attributionId: attribution.id, reason: null };
        } catch (err: any) {
            // P2002 на UNIQUE(referredUserId) — повторный signup того же
            // user'а. Возвращаем существующую без перезаписи.
            if (err?.code === 'P2002') {
                const existing = await this.prisma.referralAttribution.findUnique({
                    where: { referredUserId: args.referredUserId },
                    select: { id: true },
                });
                return {
                    captured: false,
                    attributionId: existing?.id ?? null,
                    reason: 'ALREADY_CAPTURED',
                };
            }
            throw err;
        }
    }

    /**
     * Этап 2: lock attribution на tenant. Вызывается из `TenantService.createTenant`.
     */
    async lockOnTenantCreation(
        args: LockOnTenantCreationArgs,
    ): Promise<LockOnTenantCreationResult> {
        const attribution = await this.prisma.referralAttribution.findUnique({
            where: { referredUserId: args.referredUserId },
            include: { referralLink: { select: { ownerUserId: true, tenantId: true } } },
        });

        if (!attribution) {
            // Нерефератный signup — нечего lock'ать.
            return {
                locked: false,
                attributionId: null,
                status: ReferralAttributionStatus.ATTRIBUTED,
                rejectionReason: null,
                skipped: true,
            };
        }

        // Idempotency: уже locked на тот же tenant — ok.
        if (attribution.referredTenantId === args.referredTenantId) {
            return {
                locked: true,
                attributionId: attribution.id,
                status: attribution.status,
                rejectionReason: attribution.rejectionReason,
                skipped: false,
            };
        }

        // Lock conflict: уже locked на ДРУГОЙ tenant — §13 правило.
        if (attribution.referredTenantId && attribution.referredTenantId !== args.referredTenantId) {
            throw new ConflictException({
                code: 'REFERRAL_ATTRIBUTION_ALREADY_LOCKED',
                message:
                    `attribution for user ${args.referredUserId} already locked to ` +
                    `another tenant ${attribution.referredTenantId}`,
            });
        }

        // Self-referral check: link.owner === user или user уже member
        // tenant'а ссылки.
        const isSelfByOwner = attribution.referralLink?.ownerUserId === args.referredUserId;
        const isSelfByMembership = attribution.referralLink?.tenantId
            ? !!(await this.prisma.membership.findFirst({
                  where: {
                      userId: args.referredUserId,
                      tenantId: attribution.referralLink.tenantId,
                      status: 'ACTIVE',
                  },
                  select: { id: true },
              }))
            : false;

        if (isSelfByOwner || isSelfByMembership) {
            const updated = await this.prisma.referralAttribution.update({
                where: { id: attribution.id },
                data: {
                    status: ReferralAttributionStatus.REJECTED,
                    rejectionReason: 'SELF_REFERRAL_BLOCKED',
                    // Намеренно НЕ ставим referredTenantId — иначе повторная
                    // попытка владельца создать ещё один tenant под своей же
                    // ссылкой упрётся в UNIQUE(referredTenantId).
                },
            });
            this.logger.warn(
                `referral attribution rejected (self-referral) user=${args.referredUserId} ` +
                    `link=${attribution.referralLinkId}`,
            );
            void this.audit.log({
                eventType: 'ATTRIBUTION_REJECTED',
                attributionId: updated.id,
                actorId: args.referredUserId,
                tenantId: args.referredTenantId,
                ruleId: 'SELF_REFERRAL_BLOCKED',
            });
            return {
                locked: false,
                attributionId: updated.id,
                status: updated.status,
                rejectionReason: updated.rejectionReason,
                skipped: false,
            };
        }

        // Anti-fraud check (TASK_REFERRALS_5): оцениваем attribution по IP-правилам
        // до фактической блокировки tenant'а.
        const fraud = await this.fraudGuard.evaluate({
            attributionId: attribution.id,
            referralLinkId: attribution.referralLinkId,
            sourceIp: attribution.sourceIp,
        });

        if (fraud.suspicious) {
            const updated = await this.prisma.referralAttribution.update({
                where: { id: attribution.id },
                data: {
                    status: ReferralAttributionStatus.FRAUD_REVIEW,
                    rejectionReason: fraud.ruleId,
                },
            });
            this.logger.warn(
                `referral attribution fraud_review user=${args.referredUserId} ` +
                    `rule=${fraud.ruleId} severity=${fraud.severity} ${fraud.details}`,
            );
            void this.audit.log({
                eventType: 'ATTRIBUTION_FRAUD_REVIEW',
                attributionId: updated.id,
                actorId: args.referredUserId,
                tenantId: args.referredTenantId,
                ruleId: fraud.ruleId ?? undefined,
                data: { severity: fraud.severity, details: fraud.details },
            });
            return {
                locked: false,
                attributionId: updated.id,
                status: updated.status,
                rejectionReason: updated.rejectionReason,
                skipped: false,
            };
        }

        // Happy path: lock attribution на tenant.
        try {
            const updated = await this.prisma.referralAttribution.update({
                where: { id: attribution.id },
                data: {
                    referredTenantId: args.referredTenantId,
                    tenantLockedAt: new Date(),
                },
            });
            this.logger.log(
                `referral attribution locked user=${args.referredUserId} tenant=${args.referredTenantId}`,
            );
            void this.audit.log({
                eventType: 'ATTRIBUTION_LOCKED',
                attributionId: updated.id,
                actorId: args.referredUserId,
                tenantId: args.referredTenantId,
            });
            return {
                locked: true,
                attributionId: updated.id,
                status: updated.status,
                rejectionReason: null,
                skipped: false,
            };
        } catch (err: any) {
            // P2002 на UNIQUE(referredTenantId) — другой attribution уже
            // занял tenant (теоретически невозможно, но защищаемся).
            if (err?.code === 'P2002') {
                throw new ConflictException({
                    code: 'REFERRAL_ATTRIBUTION_ALREADY_LOCKED',
                    message: `tenant ${args.referredTenantId} already attributed to another user`,
                });
            }
            throw err;
        }
    }

    /**
     * Read для `GET /referrals/status` — owner'у показываем funnel
     * по его ссылке: сколько ATTRIBUTED / PAID / REWARDED / REJECTED.
     */
    async getOwnerStatus(args: { ownerUserId: string; tenantId: string }) {
        const link = await this.prisma.referralLink.findUnique({
            where: {
                ownerUserId_tenantId: {
                    ownerUserId: args.ownerUserId,
                    tenantId: args.tenantId,
                },
            },
            select: { id: true, code: true, isActive: true, createdAt: true },
        });

        if (!link) {
            return {
                hasLink: false,
                link: null,
                stats: {
                    attributed: 0,
                    paid: 0,
                    rewarded: 0,
                    rejected: 0,
                    fraudReview: 0,
                    total: 0,
                },
                rules: this._mvpRules(),
            };
        }

        const grouped = await this.prisma.referralAttribution.groupBy({
            by: ['status'],
            where: { referralLinkId: link.id },
            _count: { _all: true },
        });

        const stats = { attributed: 0, paid: 0, rewarded: 0, rejected: 0, fraudReview: 0, total: 0 };
        for (const g of grouped) {
            const n = g._count._all;
            stats.total += n;
            switch (g.status) {
                case ReferralAttributionStatus.ATTRIBUTED:
                    stats.attributed = n;
                    break;
                case ReferralAttributionStatus.PAID:
                    stats.paid = n;
                    break;
                case ReferralAttributionStatus.REWARDED:
                    stats.rewarded = n;
                    break;
                case ReferralAttributionStatus.REJECTED:
                    stats.rejected = n;
                    break;
                case ReferralAttributionStatus.FRAUD_REVIEW:
                    stats.fraudReview = n;
                    break;
            }
        }

        return {
            hasLink: true,
            link: {
                id: link.id,
                code: link.code,
                isActive: link.isActive,
                createdAt: link.createdAt.toISOString(),
            },
            stats,
            rules: this._mvpRules(),
        };
    }

    /**
     * §10 + §13 + §14 правила MVP — UI показывает их пользователю,
     * чтобы он понимал, как формируется reward, и не ожидал больше.
     */
    private _mvpRules() {
        return {
            rewardTrigger: 'first_paid_subscription',
            rewardOncePerReferredTenant: true,
            selfReferralBlocked: true,
            attributionLockedOnTenantCreation: true,
            promoBonusStackPolicy: 'EXCLUSIVE',
        };
    }
}
