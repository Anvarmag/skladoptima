import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';

type TenantAccessContext = { accessState: string; userRole: string };
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CURRENT_CATALOG_VERSION, getStepsForScope } from './step-catalog';

type OnboardingStateWithSteps = Prisma.OnboardingStateGetPayload<{
    include: { steps: true };
}>;

@Injectable()
export class OnboardingService {
    private readonly logger = new Logger(OnboardingService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Init helpers (вызываются из auth и tenant сервисов) ─────────────────────

    async initUserBootstrap(userId: string) {
        const existing = await this.prisma.onboardingState.findUnique({
            where: { userId_scope: { userId, scope: 'USER_BOOTSTRAP' } },
        });
        if (existing) return existing;

        const steps = getStepsForScope('USER_BOOTSTRAP');

        try {
            return await this.prisma.$transaction(async (tx) => {
                const state = await tx.onboardingState.create({
                    data: {
                        userId,
                        scope: 'USER_BOOTSTRAP',
                        catalogVersion: CURRENT_CATALOG_VERSION,
                    },
                });

                await tx.onboardingStepProgress.createMany({
                    data: steps.map((s) => ({
                        onboardingStateId: state.id,
                        stepKey: s.key,
                    })),
                });

                this.logger.log(
                    JSON.stringify({ event: 'onboarding_bootstrap_created', userId, ts: new Date().toISOString() }),
                );

                return state;
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                return this.prisma.onboardingState.findUniqueOrThrow({
                    where: { userId_scope: { userId, scope: 'USER_BOOTSTRAP' } },
                });
            }
            throw e;
        }
    }

    async initTenantActivation(tenantId: string) {
        const existing = await this.prisma.onboardingState.findUnique({
            where: { tenantId_scope: { tenantId, scope: 'TENANT_ACTIVATION' } },
        });
        if (existing) return existing;

        const steps = getStepsForScope('TENANT_ACTIVATION');

        try {
            return await this.prisma.$transaction(async (tx) => {
                const state = await tx.onboardingState.create({
                    data: {
                        tenantId,
                        scope: 'TENANT_ACTIVATION',
                        catalogVersion: CURRENT_CATALOG_VERSION,
                    },
                });

                await tx.onboardingStepProgress.createMany({
                    data: steps.map((s) => ({
                        onboardingStateId: state.id,
                        stepKey: s.key,
                    })),
                });

                this.logger.log(
                    JSON.stringify({ event: 'onboarding_activation_created', tenantId, ts: new Date().toISOString() }),
                );

                return state;
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                return this.prisma.onboardingState.findUniqueOrThrow({
                    where: { tenantId_scope: { tenantId, scope: 'TENANT_ACTIVATION' } },
                });
            }
            throw e;
        }
    }

    // ─── State API ───────────────────────────────────────────────────────────────

    async getState(userId: string, activeTenantId: string | null) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            if (ctx.userRole === 'STAFF') return { state: null };
            const state = await this.findState(userId, activeTenantId);
            return { state: state ? this.formatResponse(state, ctx) : null };
        }
        const state = await this.findState(userId, activeTenantId);
        return { state: state ? this.formatResponse(state) : null };
    }

    async startState(userId: string, activeTenantId: string | null) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            if (ctx.userRole === 'STAFF') return { state: null };
            await this.initTenantActivation(activeTenantId);
            const state = await this.getTenantActivationState(activeTenantId);
            return { state: state ? this.formatResponse(state, ctx) : null };
        }
        await this.initUserBootstrap(userId);
        const state = await this.getUserBootstrapState(userId);
        return { state: state ? this.formatResponse(state) : null };
    }

    async updateStep(
        userId: string,
        activeTenantId: string | null,
        stepKey: string,
        newStatus: 'done' | 'skipped' | 'viewed',
    ) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            this.assertTenantWriteAllowed(ctx, newStatus === 'viewed' ? 'step_view' : 'step_action');
        }
        const state = await this.findStateOrThrow(userId, activeTenantId);

        const catalogSteps = getStepsForScope(
            state.scope as 'USER_BOOTSTRAP' | 'TENANT_ACTIVATION',
            state.catalogVersion,
        );
        if (!catalogSteps.find((s) => s.key === stepKey)) {
            throw new NotFoundException({ code: 'ONBOARDING_STEP_NOT_FOUND' });
        }

        const currentRow = state.steps.find((s) => s.stepKey === stepKey);
        const currentStatus = (currentRow?.status ?? 'PENDING') as string;
        const newStatusUpper = newStatus.toUpperCase();

        if (currentStatus === newStatusUpper) {
            return { state: this.formatResponse(state) }; // no-op
        }
        if (currentStatus === 'DONE') {
            throw new BadRequestException({ code: 'ONBOARDING_INVALID_TRANSITION' });
        }
        if (currentStatus === 'SKIPPED') {
            // прямые переходы из SKIPPED запрещены — нужен reopen
            throw new BadRequestException({ code: 'ONBOARDING_INVALID_TRANSITION' });
        }

        const now = new Date();
        const updateData: Record<string, unknown> = { status: newStatusUpper };
        if (newStatusUpper === 'VIEWED' && !currentRow?.viewedAt) updateData.viewedAt = now;
        if (newStatusUpper === 'DONE') updateData.completedAt = now;
        if (newStatusUpper === 'SKIPPED') updateData.skippedAt = now;

        await this.prisma.$transaction(async (tx) => {
            await tx.onboardingStepProgress.upsert({
                where: {
                    onboardingStateId_stepKey: { onboardingStateId: state.id, stepKey },
                },
                update: updateData,
                create: { onboardingStateId: state.id, stepKey, ...updateData },
            });

            if (newStatusUpper === 'VIEWED') {
                await tx.onboardingState.update({
                    where: { id: state.id },
                    data: { lastStepKey: stepKey },
                });
            }
        });

        this.logger.log(
            JSON.stringify({
                event: 'onboarding_step_updated',
                stateId: state.id,
                stepKey,
                from: currentStatus,
                to: newStatusUpper,
                source: 'user_action',
                ts: now.toISOString(),
            }),
        );

        const fresh = await this.findStateOrThrow(userId, activeTenantId);
        return { state: this.formatResponse(fresh) };
    }

    async closeState(userId: string, activeTenantId: string | null) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            this.assertTenantWriteAllowed(ctx, 'state_change');
        }
        const state = await this.findStateOrThrow(userId, activeTenantId);

        if (state.status === 'COMPLETED') {
            throw new ConflictException({ code: 'ONBOARDING_WRONG_STATE' });
        }
        if (state.status === 'CLOSED') {
            return { state: this.formatResponse(state) }; // idempotent
        }

        const now = new Date();
        const updated = await this.prisma.onboardingState.update({
            where: { id: state.id },
            data: { status: 'CLOSED', closedAt: now },
            include: { steps: { orderBy: { createdAt: 'asc' } } },
        });

        this.logger.log(
            JSON.stringify({ event: 'onboarding_state_closed', stateId: state.id, ts: now.toISOString() }),
        );
        return { state: this.formatResponse(updated) };
    }

    async reopenState(userId: string, activeTenantId: string | null) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            this.assertTenantWriteAllowed(ctx, 'state_change');
        }
        const state = await this.findStateOrThrow(userId, activeTenantId);

        if (state.status === 'COMPLETED') {
            throw new ConflictException({ code: 'ONBOARDING_ALREADY_COMPLETED' });
        }
        if (state.status === 'IN_PROGRESS') {
            return { state: this.formatResponse(state) }; // уже открыт
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.onboardingState.update({
                where: { id: state.id },
                data: { status: 'IN_PROGRESS' },
            });
            await tx.onboardingStepProgress.updateMany({
                where: { onboardingStateId: state.id, status: 'SKIPPED' },
                data: { status: 'PENDING', skippedAt: null },
            });
        });

        this.logger.log(
            JSON.stringify({ event: 'onboarding_state_reopened', stateId: state.id, ts: new Date().toISOString() }),
        );

        const fresh = await this.findStateOrThrow(userId, activeTenantId);
        return { state: this.formatResponse(fresh) };
    }

    async completeState(userId: string, activeTenantId: string | null) {
        if (activeTenantId) {
            const ctx = await this.getTenantAccessContext(userId, activeTenantId);
            this.assertTenantWriteAllowed(ctx, 'state_change');
        }
        const state = await this.findStateOrThrow(userId, activeTenantId);

        if (state.status === 'COMPLETED') {
            throw new ConflictException({ code: 'ONBOARDING_WRONG_STATE' });
        }
        if (state.status === 'CLOSED') {
            throw new ConflictException({ code: 'ONBOARDING_WRONG_STATE' });
        }

        const now = new Date();
        const updated = await this.prisma.onboardingState.update({
            where: { id: state.id },
            data: { status: 'COMPLETED', completedAt: now },
            include: { steps: { orderBy: { createdAt: 'asc' } } },
        });

        this.logger.log(
            JSON.stringify({ event: 'onboarding_state_completed', stateId: state.id, ts: now.toISOString() }),
        );
        return { state: this.formatResponse(updated) };
    }

    // ─── Domain events (вызывается из доменных сервисов) ────────────────────────

    /**
     * Идемпотентно помечает шаг онбординга как DONE по domain event.
     * Не бросает ошибок если state не существует — onboarding мог не быть инициализирован.
     */
    async markStepDone(
        scope: 'USER_BOOTSTRAP' | 'TENANT_ACTIVATION',
        scopeId: string,
        stepKey: string,
        source: 'domain_event' | 'migration',
    ): Promise<void> {
        const state =
            scope === 'USER_BOOTSTRAP'
                ? await this.getUserBootstrapState(scopeId)
                : await this.getTenantActivationState(scopeId);

        if (!state) return;

        const currentRow = state.steps.find((s) => s.stepKey === stepKey);
        if (currentRow?.status === 'DONE') return; // идемпотентен

        const now = new Date();

        await this.prisma.onboardingStepProgress.upsert({
            where: { onboardingStateId_stepKey: { onboardingStateId: state.id, stepKey } },
            update: { status: 'DONE', completedAt: now },
            create: { onboardingStateId: state.id, stepKey, status: 'DONE', completedAt: now },
        });

        this.logger.log(
            JSON.stringify({
                event: 'onboarding_step_updated',
                stateId: state.id,
                stepKey,
                from: currentRow?.status ?? 'PENDING',
                to: 'DONE',
                source,
                ts: now.toISOString(),
            }),
        );

        // USER_BOOTSTRAP автозавершается при setup_company DONE (компания создана)
        if (scope === 'USER_BOOTSTRAP' && stepKey === 'setup_company' && state.status === 'IN_PROGRESS') {
            await this.prisma.onboardingState.update({
                where: { id: state.id },
                data: { status: 'COMPLETED', completedAt: now },
            });
            this.logger.log(
                JSON.stringify({ event: 'onboarding_state_completed', stateId: state.id, ts: now.toISOString() }),
            );
        }
    }

    // ─── Funnel alerting ─────────────────────────────────────────────────────────

    /**
     * Emits onboarding_step_stale for each pending/viewed step in states
     * that have not been updated for more than staleDaysThreshold days.
     * Intended for a scheduled job (e.g. daily cron).
     */
    async checkStuckSteps(staleDaysThreshold = 7): Promise<void> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - staleDaysThreshold);

        const stuckStates = await this.prisma.onboardingState.findMany({
            where: { status: 'IN_PROGRESS', updatedAt: { lt: cutoff } },
            include: { steps: { where: { status: { in: ['PENDING', 'VIEWED'] } } } },
        });

        const now = new Date().toISOString();
        for (const state of stuckStates) {
            for (const step of state.steps) {
                this.logger.log(
                    JSON.stringify({
                        event: 'onboarding_step_stale',
                        stateId: state.id,
                        scope: state.scope,
                        stepKey: step.stepKey,
                        userId: state.userId,
                        tenantId: state.tenantId,
                        staleSince: state.updatedAt,
                        ts: now,
                    }),
                );
            }
        }
    }

    // ─── Чтение состояния (используется в T4-03, T4-04) ─────────────────────────

    async getUserBootstrapState(userId: string) {
        return this.prisma.onboardingState.findUnique({
            where: { userId_scope: { userId, scope: 'USER_BOOTSTRAP' } },
            include: { steps: { orderBy: { createdAt: 'asc' } } },
        });
    }

    async getTenantActivationState(tenantId: string) {
        return this.prisma.onboardingState.findUnique({
            where: { tenantId_scope: { tenantId, scope: 'TENANT_ACTIVATION' } },
            include: { steps: { orderBy: { createdAt: 'asc' } } },
        });
    }

    // ─── Private helpers ──────────────────────────────────────────────────────────

    private async findState(
        userId: string,
        activeTenantId: string | null,
    ): Promise<OnboardingStateWithSteps | null> {
        if (activeTenantId) {
            return this.prisma.onboardingState.findUnique({
                where: { tenantId_scope: { tenantId: activeTenantId, scope: 'TENANT_ACTIVATION' } },
                include: { steps: { orderBy: { createdAt: 'asc' } } },
            });
        }
        return this.prisma.onboardingState.findUnique({
            where: { userId_scope: { userId, scope: 'USER_BOOTSTRAP' } },
            include: { steps: { orderBy: { createdAt: 'asc' } } },
        });
    }

    private async findStateOrThrow(
        userId: string,
        activeTenantId: string | null,
    ): Promise<OnboardingStateWithSteps> {
        const state = await this.findState(userId, activeTenantId);
        if (!state) throw new NotFoundException({ code: 'ONBOARDING_STATE_NOT_FOUND' });
        return state;
    }

    private async getTenantAccessContext(userId: string, tenantId: string): Promise<TenantAccessContext> {
        const [tenant, membership] = await Promise.all([
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { accessState: true } }),
            this.prisma.membership.findFirst({ where: { userId, tenantId, status: 'ACTIVE' }, select: { role: true } }),
        ]);
        return {
            accessState: tenant?.accessState ?? 'ACTIVE_PAID',
            userRole: membership?.role ?? 'OWNER',
        };
    }

    private computeBlockReason(ctx?: TenantAccessContext): string | null {
        if (!ctx) return null;
        const { accessState, userRole } = ctx;
        if (userRole === 'MANAGER') return 'ROLE_INSUFFICIENT';
        if (accessState === 'TRIAL_EXPIRED') return 'TRIAL_EXPIRED';
        if (accessState === 'SUSPENDED') return 'TENANT_SUSPENDED';
        if (accessState === 'CLOSED') return 'TENANT_CLOSED';
        return null;
    }

    private assertTenantWriteAllowed(
        ctx: TenantAccessContext,
        operation: 'step_view' | 'step_action' | 'state_change',
    ): void {
        const { accessState, userRole } = ctx;
        if (userRole === 'STAFF') {
            throw new ForbiddenException({ code: 'ONBOARDING_FORBIDDEN' });
        }
        const WRITE_BLOCKED = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];
        if (WRITE_BLOCKED.includes(accessState)) {
            throw new ForbiddenException({ code: 'ONBOARDING_FORBIDDEN' });
        }
        if (userRole === 'MANAGER' && operation !== 'step_view') {
            throw new ForbiddenException({ code: 'ONBOARDING_FORBIDDEN' });
        }
    }

    private formatResponse(state: OnboardingStateWithSteps, ctx?: TenantAccessContext) {
        const catalogSteps = getStepsForScope(
            state.scope as 'USER_BOOTSTRAP' | 'TENANT_ACTIVATION',
            state.catalogVersion,
        );
        const stepsMap = new Map(state.steps.map((s) => [s.stepKey, s]));

        const blockReason = this.computeBlockReason(ctx);
        const isCtaBlocked = blockReason !== null;

        const steps = catalogSteps.map((def) => {
            const progress = stepsMap.get(def.key);
            return {
                key: def.key,
                title: def.title,
                description: def.description,
                required: def.required,
                ctaLink: def.ctaLink,
                autoCompleteEvent: def.autoCompleteEvent,
                status: (progress?.status ?? 'PENDING') as string,
                isCtaBlocked,
                viewedAt: progress?.viewedAt ?? null,
                completedAt: progress?.completedAt ?? null,
                skippedAt: progress?.skippedAt ?? null,
                metadata: progress?.metadata ?? null,
            };
        });

        const doneCount = steps.filter((s) => s.status === 'DONE').length;
        const skippedCount = steps.filter((s) => s.status === 'SKIPPED').length;
        const nextRecommendedStep =
            steps.find((s) => s.status === 'PENDING' || s.status === 'VIEWED')?.key ?? null;

        return {
            scope: state.scope,
            status: state.status,
            catalogVersion: state.catalogVersion,
            lastStepKey: state.lastStepKey,
            completedAt: state.completedAt,
            closedAt: state.closedAt,
            progress: {
                total: steps.length,
                done: doneCount,
                skipped: skippedCount,
            },
            nextRecommendedStep,
            isBlocked: isCtaBlocked,
            blockReason,
            steps,
        };
    }
}
