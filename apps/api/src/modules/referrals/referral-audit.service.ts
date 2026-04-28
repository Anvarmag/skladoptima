import { Injectable, Logger } from '@nestjs/common';
import { ReferralAuditEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Персистентный audit log для событий реферального модуля (TASK_REFERRALS_5).
 *
 * Принципы:
 *   - Fire-and-forget: ошибки записи логируются, но НИКОГДА не re-throw'ятся.
 *     Сбой аудита не должен прерывать основной бизнес-flow.
 *   - Не используется для business-logic decisions — только для observability,
 *     воспроизводимости fraud-решений и compliance audit trail.
 */

export interface LogAuditArgs {
    eventType: ReferralAuditEventType;
    attributionId?: string;
    actorId?: string;
    tenantId?: string;
    ruleId?: string;
    data?: Record<string, unknown>;
}

@Injectable()
export class ReferralAuditService {
    private readonly logger = new Logger(ReferralAuditService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Записывает audit-событие. Fire-and-forget — никогда не бросает exception.
     */
    async log(args: LogAuditArgs): Promise<void> {
        try {
            await this.prisma.referralAuditLog.create({
                data: {
                    eventType: args.eventType,
                    attributionId: args.attributionId ?? null,
                    actorId: args.actorId ?? null,
                    tenantId: args.tenantId ?? null,
                    ruleId: args.ruleId ?? null,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: (args.data ?? null) as any,
                },
            });
        } catch (err: any) {
            this.logger.error(
                `referral_audit_write_failed event=${args.eventType} attribution=${args.attributionId} err=${err?.message}`,
            );
        }
    }
}
