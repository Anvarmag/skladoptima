import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    Prisma,
    SupportActionResultStatus,
    SupportActionType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantService } from '../../tenants/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_DOMAINS, AUDIT_EVENTS } from '../../audit/audit-event-catalog';
import { SupportUserContext } from '../admin-auth/decorators/current-support-user.decorator';
import { AdminMetricNames, AdminMetricsRegistry } from '../admin.metrics';

interface ActionContext {
    actor: SupportUserContext;
    ip: string | null;
    userAgent: string | null;
    /// Correlation id, прокинутый из request заголовка (`x-correlation-id` / `x-request-id`).
    /// Сохраняется в `support_actions.correlation_id` и пробрасывается дальше в
    /// AuditLog.correlationId — это даёт сквозную связь между admin-плоскостью,
    /// privileged audit и tenant-facing trail при разборе инцидента.
    correlationId: string | null;
}

/// Оркестратор support actions. Все mutating действия admin-плоскости проходят
/// строго через этот сервис — controllers не дёргают доменные сервисы напрямую.
///
/// Контракт каждой action:
///   1. Валидация reason (controller-DTO уже проверил длину >= 10);
///   2. Вызов доменного сервиса (TenantService.* / AuthService.*);
///   3. Запись `support_actions` с resultStatus=success/failed/blocked;
///   4. Запись tenant-facing AuditLog через `writePrivilegedEvent`
///      (visibility=internal_only, actorType=support);
///   5. На любую ошибку — фиксируем blocked/failed запись и пробрасываем дальше.
///
/// Это даёт инвариант "каждое действие имеет валидируемый reason и
/// воспроизводимый execution path" из критериев DoD TASK_ADMIN_3.
@Injectable()
export class SupportActionsService {
    private readonly logger = new Logger(SupportActionsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantService: TenantService,
        private readonly authService: AuthService,
        private readonly auditService: AuditService,
        private readonly metrics: AdminMetricsRegistry,
    ) {}

    // ─── EXTEND_TRIAL ──────────────────────────────────────────────────────

    async extendTrial(tenantId: string, reason: string, ctx: ActionContext) {
        return this.runTenantAction({
            tenantId,
            actionType: SupportActionType.EXTEND_TRIAL,
            reason,
            ctx,
            payload: {},
            run: async () => {
                const result = await this.tenantService.extendTrialBySupport(tenantId, {
                    supportUserId: ctx.actor.id,
                    reasonCode: 'SUPPORT_EXTEND_TRIAL',
                });
                return {
                    domainResult: result,
                    audit: {
                        eventType: AUDIT_EVENTS.TENANT_STATE_CHANGED,
                        eventDomain: AUDIT_DOMAINS.TENANT,
                        before: { accessState: result.previousState },
                        after: { accessState: result.currentState },
                        metadata: {
                            supportAction: 'EXTEND_TRIAL',
                            idempotent: result.idempotent,
                        },
                    },
                };
            },
        });
    }

    // ─── SET_ACCESS_STATE ──────────────────────────────────────────────────

    async setAccessState(
        tenantId: string,
        toState: string,
        reason: string,
        ctx: ActionContext,
    ) {
        return this.runTenantAction({
            tenantId,
            actionType: SupportActionType.SET_ACCESS_STATE,
            reason,
            ctx,
            payload: { toState },
            run: async () => {
                const result = await this.tenantService.transitionAccessState(
                    tenantId,
                    {
                        toState: toState as any,
                        reasonCode: 'SUPPORT_SET_ACCESS_STATE',
                        actorType: 'SUPPORT',
                        actorId: ctx.actor.id,
                    } as any,
                    { supportContext: true },
                );
                return {
                    domainResult: result,
                    audit: {
                        eventType: AUDIT_EVENTS.TENANT_STATE_CHANGED,
                        eventDomain: AUDIT_DOMAINS.TENANT,
                        before: { accessState: result.previousState },
                        after: { accessState: result.currentState },
                        metadata: { supportAction: 'SET_ACCESS_STATE' },
                    },
                };
            },
        });
    }

    // ─── RESTORE_TENANT ────────────────────────────────────────────────────

    async restoreTenant(tenantId: string, reason: string, ctx: ActionContext) {
        return this.runTenantAction({
            tenantId,
            actionType: SupportActionType.RESTORE_TENANT,
            reason,
            ctx,
            payload: {},
            run: async () => {
                const result = await this.tenantService.restoreTenantBySupport(tenantId, {
                    supportUserId: ctx.actor.id,
                    reasonCode: 'SUPPORT_RESTORE_TENANT',
                });
                return {
                    domainResult: result,
                    audit: {
                        eventType: AUDIT_EVENTS.TENANT_RESTORED,
                        eventDomain: AUDIT_DOMAINS.TENANT,
                        before: { status: 'CLOSED' },
                        after: { status: result.status, accessState: result.accessState },
                        metadata: { supportAction: 'RESTORE_TENANT' },
                    },
                };
            },
        });
    }

    // ─── TRIGGER_PASSWORD_RESET ───────────────────────────────────────────

    async triggerPasswordReset(userId: string, reason: string, ctx: ActionContext) {
        const startedAt = Date.now();
        this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_STARTED, {
            actionType: 'TRIGGER_PASSWORD_RESET',
            supportUserId: ctx.actor.id,
            role: ctx.actor.role,
        });

        // Резолвим tenantId через primary owner / membership — для журнала.
        // Если user не принадлежит tenant'у (например, owner закрытого tenant'а),
        // tenantId остаётся null и попадёт в support_actions как user-level event.
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                memberships: {
                    where: { status: 'ACTIVE' },
                    select: { tenantId: true },
                    take: 1,
                },
            },
        });
        if (!user) {
            await this.recordAction({
                tenantId: null,
                actionType: SupportActionType.TRIGGER_PASSWORD_RESET,
                reason,
                payload: {},
                ctx,
                resultStatus: SupportActionResultStatus.blocked,
                errorCode: 'AUTH_USER_NOT_FOUND',
                resultDetails: { userId },
                targetUserId: userId,
                auditLogId: null,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_FAILED, {
                actionType: 'TRIGGER_PASSWORD_RESET',
                reason: 'AUTH_USER_NOT_FOUND',
            });
            this.metrics.observeActionDuration(Date.now() - startedAt, {
                actionType: 'TRIGGER_PASSWORD_RESET',
            });
            throw new NotFoundException({ code: 'AUTH_USER_NOT_FOUND' });
        }

        const tenantId = user.memberships[0]?.tenantId ?? null;

        try {
            const domainResult = await this.authService.triggerPasswordResetBySupport(
                userId,
                { supportUserId: ctx.actor.id, ip: ctx.ip },
            );

            // Privileged audit — visibility=internal_only, actorType=support
            // принудительно. Возвращённый id сохраняется в support_actions.audit_log_id,
            // чтобы каждое support действие было связано с tenant-facing audit trail.
            // password reset без resolved tenantId (orphan owner) пишется только в
            // support_actions — AuditLog требует tenantId.
            let auditLogId: string | null = null;
            if (tenantId) {
                auditLogId = await this.safeWriteAudit({
                    tenantId,
                    eventType: AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
                    eventDomain: AUDIT_DOMAINS.PASSWORD,
                    entityType: 'user',
                    entityId: userId,
                    actorId: ctx.actor.id,
                    source: 'api',
                    correlationId: ctx.correlationId ?? undefined,
                    metadata: {
                        supportAction: 'TRIGGER_PASSWORD_RESET',
                        reason,
                    },
                });
            }

            await this.recordAction({
                tenantId,
                actionType: SupportActionType.TRIGGER_PASSWORD_RESET,
                reason,
                payload: {},
                ctx,
                resultStatus: SupportActionResultStatus.success,
                errorCode: null,
                resultDetails: domainResult,
                targetUserId: userId,
                auditLogId,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_SUCCEEDED, {
                actionType: 'TRIGGER_PASSWORD_RESET',
                supportUserId: ctx.actor.id,
            });
            this.metrics.observeActionDuration(Date.now() - startedAt, {
                actionType: 'TRIGGER_PASSWORD_RESET',
            });

            return { ok: true, userId, tenantId, auditLogId };
        } catch (err: any) {
            const code = err?.response?.code ?? err?.code ?? 'UNKNOWN_ERROR';
            const isBlocked = err?.status === 403 || err?.status === 409 || err?.status === 400;
            await this.recordAction({
                tenantId,
                actionType: SupportActionType.TRIGGER_PASSWORD_RESET,
                reason,
                payload: {},
                ctx,
                resultStatus: isBlocked
                    ? SupportActionResultStatus.blocked
                    : SupportActionResultStatus.failed,
                errorCode: String(code),
                resultDetails: { message: err?.message ?? String(err) },
                targetUserId: userId,
                auditLogId: null,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_FAILED, {
                actionType: 'TRIGGER_PASSWORD_RESET',
                reason: String(code),
            });
            this.metrics.observeActionDuration(Date.now() - startedAt, {
                actionType: 'TRIGGER_PASSWORD_RESET',
            });
            throw err;
        }
    }

    // ─── ADD_INTERNAL_NOTE (см. SupportNotesService — но журнал тут) ──────

    async recordNoteAdded(
        tenantId: string,
        noteId: string,
        ctx: ActionContext,
    ): Promise<{ auditLogId: string | null }> {
        // Notes тоже привязываются к общему audit trail: SUPPORT_NOTE_ADDED идёт
        // через writePrivilegedEvent (internal_only), и его id фиксируется в
        // support_actions.audit_log_id. Это закрывает требование TASK_ADMIN_4
        // «связать notes/actions с общим audit trail».
        const auditLogId = await this.safeWriteAudit({
            tenantId,
            eventType: AUDIT_EVENTS.SUPPORT_NOTE_ADDED,
            eventDomain: AUDIT_DOMAINS.SUPPORT,
            entityType: 'support_note',
            entityId: noteId,
            actorId: ctx.actor.id,
            source: 'api',
            correlationId: ctx.correlationId ?? undefined,
            metadata: { supportAction: 'ADD_INTERNAL_NOTE' },
        });

        await this.recordAction({
            tenantId,
            actionType: SupportActionType.ADD_INTERNAL_NOTE,
            reason: 'internal_note_added',
            payload: { noteId },
            ctx,
            resultStatus: SupportActionResultStatus.success,
            errorCode: null,
            resultDetails: null,
            targetUserId: null,
            auditLogId,
        });
        this.metrics.increment(AdminMetricNames.NOTES_CREATED, {
            supportUserId: ctx.actor.id,
            role: ctx.actor.role,
        });

        return { auditLogId };
    }

    // ─── Internals ─────────────────────────────────────────────────────────

    /// Унифицированный шаблон tenant-level action: проверяет существование
    /// tenant, выполняет доменный вызов через `run`, фиксирует success/failed/blocked.
    private async runTenantAction<T extends { domainResult: any; audit: any }>(args: {
        tenantId: string;
        actionType: SupportActionType;
        reason: string;
        ctx: ActionContext;
        payload: Record<string, unknown>;
        run: () => Promise<T>;
    }) {
        const { tenantId, actionType, reason, ctx, payload, run } = args;
        const startedAt = Date.now();
        // Каждое попавшее в сервис action попадает в started — даже если будет
        // блокировано pre-check'ом. Это даёт алертам §19 видеть всю воронку:
        // started → failed/blocked.
        this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_STARTED, {
            actionType: actionType,
            supportUserId: ctx.actor.id,
            role: ctx.actor.role,
        });

        // Pre-check: tenant существует. 404 на отсутствующем tenant → blocked.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        if (!tenant) {
            await this.recordAction({
                tenantId,
                actionType,
                reason,
                payload,
                ctx,
                resultStatus: SupportActionResultStatus.blocked,
                errorCode: 'ADMIN_TENANT_NOT_FOUND',
                resultDetails: null,
                targetUserId: null,
                auditLogId: null,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_FAILED, {
                actionType: actionType,
                reason: 'ADMIN_TENANT_NOT_FOUND',
            });
            this.metrics.observeActionDuration(Date.now() - startedAt, { actionType });
            throw new NotFoundException({ code: 'ADMIN_TENANT_NOT_FOUND' });
        }

        try {
            const result = await run();

            // Privileged audit-event (внутренняя видимость). Возвращённый id
            // сохраняется в support_actions.audit_log_id — связь admin-журнала
            // и общего audit trail (требование TASK_ADMIN_4).
            const auditLogId = await this.safeWriteAudit({
                tenantId,
                eventType: result.audit.eventType,
                eventDomain: result.audit.eventDomain,
                entityType: 'tenant',
                entityId: tenantId,
                actorId: ctx.actor.id,
                source: 'api',
                correlationId: ctx.correlationId ?? undefined,
                before: result.audit.before,
                after: result.audit.after,
                metadata: { ...result.audit.metadata, reason },
            });

            await this.recordAction({
                tenantId,
                actionType,
                reason,
                payload,
                ctx,
                resultStatus: SupportActionResultStatus.success,
                errorCode: null,
                resultDetails: result.domainResult,
                targetUserId: null,
                auditLogId,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_SUCCEEDED, {
                actionType,
                supportUserId: ctx.actor.id,
            });
            this.metrics.observeActionDuration(Date.now() - startedAt, { actionType });

            return result.domainResult;
        } catch (err: any) {
            const code = err?.response?.code ?? err?.code ?? 'UNKNOWN_ERROR';
            // Доменные guard'ы (policy / retention / state-conflict) — это
            // blocked, а не failed: правила работают, не ошибка системы.
            const isBlocked =
                err?.status === 400 || err?.status === 403 || err?.status === 409;
            await this.recordAction({
                tenantId,
                actionType,
                reason,
                payload,
                ctx,
                resultStatus: isBlocked
                    ? SupportActionResultStatus.blocked
                    : SupportActionResultStatus.failed,
                errorCode: String(code),
                resultDetails: { message: err?.message ?? String(err) },
                targetUserId: null,
                auditLogId: null,
            });
            this.metrics.increment(AdminMetricNames.SUPPORT_ACTIONS_FAILED, {
                actionType,
                reason: String(code),
            });
            // §15 / §22 — каждое попадание в BILLING_OVERRIDE_NOT_ALLOWED и
            // TENANT_RETENTION_WINDOW_EXPIRED отдельно: их видимость в
            // алертах = доказательство, что guard'ы реально срабатывают.
            if (code === 'BILLING_OVERRIDE_NOT_ALLOWED') {
                this.metrics.increment(AdminMetricNames.BILLING_OVERRIDE_BLOCKED, {
                    actionType,
                });
            } else if (code === 'TENANT_RETENTION_WINDOW_EXPIRED') {
                this.metrics.increment(AdminMetricNames.RESTORE_BLOCKED_BY_RETENTION, {
                    actionType,
                });
            }
            this.metrics.observeActionDuration(Date.now() - startedAt, { actionType });
            throw err;
        }
    }

    private async recordAction(args: {
        tenantId: string | null;
        actionType: SupportActionType;
        reason: string;
        payload: Record<string, unknown>;
        ctx: ActionContext;
        resultStatus: SupportActionResultStatus;
        errorCode: string | null;
        resultDetails: any;
        targetUserId: string | null;
        auditLogId: string | null;
    }) {
        try {
            await this.prisma.supportAction.create({
                data: {
                    tenantId: args.tenantId,
                    actorSupportUserId: args.ctx.actor.id,
                    actionType: args.actionType,
                    reason: args.reason,
                    payload: args.payload as Prisma.InputJsonValue,
                    resultStatus: args.resultStatus,
                    errorCode: args.errorCode,
                    resultDetails: args.resultDetails as Prisma.InputJsonValue,
                    targetUserId: args.targetUserId,
                    auditLogId: args.auditLogId,
                    correlationId: args.ctx.correlationId,
                    ip: args.ctx.ip,
                    userAgent: args.ctx.userAgent,
                },
            });
        } catch (err: any) {
            // Сбой записи журнала не должен ломать UX — просто warn.
            this.logger.warn(
                JSON.stringify({
                    event: 'support_action_journal_failed',
                    actionType: args.actionType,
                    err: err?.message ?? String(err),
                }),
            );
        }
    }

    /// Обёртка над `auditService.writePrivilegedEvent`, которая никогда не валит
    /// support action: если запись в AuditLog упала, support_actions всё равно
    /// сохранится с `auditLogId = null`. Так мы не теряем admin-журнал из-за
    /// проблем общего audit trail (тот же подход, что и в recordAction —
    /// журнал не ломает UX).
    private async safeWriteAudit(
        payload: Parameters<AuditService['writePrivilegedEvent']>[0],
    ): Promise<string | null> {
        try {
            return await this.auditService.writePrivilegedEvent(payload);
        } catch (err: any) {
            this.logger.warn(
                JSON.stringify({
                    event: 'support_audit_write_failed',
                    eventType: payload.eventType,
                    tenantId: payload.tenantId,
                    err: err?.message ?? String(err),
                }),
            );
            return null;
        }
    }
}
