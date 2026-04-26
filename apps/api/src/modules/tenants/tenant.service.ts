import {
    Injectable,
    ConflictException,
    ForbiddenException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TransitionAccessStateDto } from './dto/transition-access-state.dto';
import { AccessStatePolicy } from './access-state.policy';
import { OnboardingService } from '../onboarding/onboarding.service';

const RETENTION_WINDOW_DAYS = 90;

@Injectable()
export class TenantService {
    private readonly logger = new Logger(TenantService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: AccessStatePolicy,
        private readonly onboardingService: OnboardingService,
    ) {}

    // ─── Create ───────────────────────────────────────────────────────────────────

    async createTenant(userId: string, dto: CreateTenantDto) {
        const existing = await this.prisma.tenant.findFirst({
            where: { inn: dto.inn, status: 'ACTIVE' },
        });
        if (existing) {
            throw new ConflictException({ code: 'TENANT_INN_ALREADY_EXISTS' });
        }

        const tenant = await this.prisma.$transaction(async (tx) => {
            const newTenant = await tx.tenant.create({
                data: {
                    name: dto.name,
                    inn: dto.inn,
                    accessState: 'TRIAL_ACTIVE',
                    primaryOwnerUserId: userId,
                    settings: {
                        create: {
                            taxSystem: dto.taxSystem,
                            country: dto.country,
                            currency: dto.currency,
                            timezone: dto.timezone,
                            legalName: dto.legalName ?? null,
                        },
                    },
                    memberships: {
                        create: { userId, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
                    },
                    accessStateEvents: {
                        create: {
                            toState: 'TRIAL_ACTIVE',
                            reasonCode: 'TENANT_CREATED',
                            actorType: 'USER',
                            actorId: userId,
                        },
                    },
                },
                include: { settings: true },
            });

            // Фиксируем как активный тенант пользователя
            await tx.userPreference.upsert({
                where: { userId },
                create: { userId, lastUsedTenantId: newTenant.id },
                update: { lastUsedTenantId: newTenant.id },
            });

            return newTenant;
        });

        this.auditLog('tenant_created', { tenantId: tenant.id, userId, inn: dto.inn });

        // T4-03: handoff — fire-and-forget, не блокируем ответ
        this.handleTenantCreatedOnboarding(userId, tenant.id).catch((err: unknown) =>
            this.logger.warn(
                JSON.stringify({
                    event: 'onboarding_handoff_failed',
                    tenantId: tenant.id,
                    userId,
                    err: (err as any)?.message,
                }),
            ),
        );

        return {
            tenantId: tenant.id,
            name: tenant.name,
            accessState: tenant.accessState,
            activeTenantSelected: true,
        };
    }

    // ─── List ─────────────────────────────────────────────────────────────────────

    async listTenants(userId: string) {
        const memberships = await this.prisma.membership.findMany({
            where: { userId, status: 'ACTIVE' },
            include: {
                tenant: {
                    include: {
                        settings: true,
                        closureJob: { select: { scheduledFor: true } },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        return memberships.map((m) => this.formatTenantSummary(m.tenant, m.role));
    }

    // ─── Current ─────────────────────────────────────────────────────────────────

    async getCurrentTenant(userId: string) {
        const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
        if (!pref?.lastUsedTenantId) return null;

        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId: pref.lastUsedTenantId, status: 'ACTIVE' },
            include: { tenant: { include: { settings: true, closureJob: { select: { scheduledFor: true } } } } },
        });

        if (!membership) return null;
        return this.formatTenantSummary(membership.tenant, membership.role);
    }

    // ─── Switch ───────────────────────────────────────────────────────────────────

    async switchTenant(userId: string, tenantId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            select: { tenant: { select: { status: true, accessState: true } } },
        });

        if (!membership) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }

        if (membership.tenant.status === 'CLOSED' || membership.tenant.accessState === 'CLOSED') {
            throw new ForbiddenException({ code: 'TENANT_CLOSED' });
        }

        await this.prisma.userPreference.upsert({
            where: { userId },
            create: { userId, lastUsedTenantId: tenantId },
            update: { lastUsedTenantId: tenantId },
        });

        this.auditLog('tenant_selected_as_active', { tenantId, userId });

        return { tenantId, activeTenant: true };
    }

    // ─── Get by ID ────────────────────────────────────────────────────────────────

    async getTenant(userId: string, tenantId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            include: { tenant: { include: { settings: true, closureJob: { select: { scheduledFor: true } } } } },
        });

        if (!membership) {
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }

        return this.formatTenantSummary(membership.tenant, membership.role);
    }

    // ─── Close ────────────────────────────────────────────────────────────────────

    async closeTenant(userId: string, tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { status: true, accessState: true, primaryOwnerUserId: true },
        });

        if (!tenant) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        if (tenant.status === 'CLOSED') throw new ConflictException({ code: 'TENANT_ALREADY_CLOSED' });
        if (tenant.primaryOwnerUserId !== userId) {
            throw new ForbiddenException({ code: 'TENANT_CLOSE_OWNER_ONLY' });
        }

        const now = new Date();
        const scheduledFor = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        await this.prisma.$transaction(async (tx) => {
            await tx.tenant.update({
                where: { id: tenantId },
                data: { status: 'CLOSED', accessState: 'CLOSED', closedAt: now },
            });

            await tx.tenantAccessStateEvent.create({
                data: {
                    tenantId,
                    fromState: tenant.accessState,
                    toState: 'CLOSED',
                    reasonCode: 'OWNER_CLOSED',
                    actorType: 'USER',
                    actorId: userId,
                },
            });

            await tx.tenantClosureJob.upsert({
                where: { tenantId },
                create: { tenantId, scheduledFor },
                update: { status: 'PENDING', scheduledFor, processedAt: null, failureReason: null },
            });
        });

        this.auditLog('tenant_closed', { tenantId, userId, retentionUntil: scheduledFor });

        return { tenantId, status: 'CLOSED', retentionUntil: scheduledFor };
    }

    // ─── Restore ──────────────────────────────────────────────────────────────────

    async restoreTenant(userId: string, tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            include: { closureJob: { select: { scheduledFor: true, status: true } } },
        });

        if (!tenant) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        if (tenant.status !== 'CLOSED') throw new ConflictException({ code: 'TENANT_NOT_CLOSED' });
        if (tenant.primaryOwnerUserId !== userId) {
            throw new ForbiddenException({ code: 'TENANT_RESTORE_OWNER_ONLY' });
        }

        const retentionExpired =
            !tenant.closureJob || tenant.closureJob.scheduledFor <= new Date();
        if (retentionExpired) {
            throw new ForbiddenException({ code: 'TENANT_RETENTION_WINDOW_EXPIRED' });
        }

        const restoreToState = 'SUSPENDED' as const;

        await this.prisma.$transaction(async (tx) => {
            await tx.tenant.update({
                where: { id: tenantId },
                data: { status: 'ACTIVE', accessState: restoreToState, closedAt: null },
            });

            await tx.tenantAccessStateEvent.create({
                data: {
                    tenantId,
                    fromState: 'CLOSED',
                    toState: restoreToState,
                    reasonCode: 'OWNER_RESTORED',
                    actorType: 'USER',
                    actorId: userId,
                },
            });

            await tx.tenantClosureJob.update({
                where: { tenantId },
                data: { status: 'ARCHIVED', processedAt: new Date() },
            });
        });

        this.auditLog('tenant_restored', { tenantId, userId });

        return { tenantId, status: 'ACTIVE', accessState: restoreToState };
    }

    // ─── Access State Transition ─────────────────────────────────────────────────

    async transitionAccessState(tenantId: string, dto: TransitionAccessStateDto) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, accessState: true, status: true },
        });

        if (!tenant) {
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }

        this.policy.assertTransitionAllowed(tenant.accessState, dto.toState);

        const isClosed = dto.toState === 'CLOSED';

        const updated = await this.prisma.$transaction(async (tx) => {
            const updatedTenant = await tx.tenant.update({
                where: { id: tenantId },
                data: {
                    accessState: dto.toState,
                    ...(isClosed && { status: 'CLOSED', closedAt: new Date() }),
                },
            });

            await tx.tenantAccessStateEvent.create({
                data: {
                    tenantId,
                    fromState: tenant.accessState,
                    toState: dto.toState,
                    reasonCode: dto.reasonCode,
                    reasonDetails: dto.reasonDetails ? (dto.reasonDetails as any) : undefined,
                    actorType: dto.actorType,
                    actorId: dto.actorId ?? null,
                },
            });

            return updatedTenant;
        });

        this.auditLog('tenant_access_state_changed', {
            tenantId,
            from: tenant.accessState,
            to: dto.toState,
            reasonCode: dto.reasonCode,
            actorType: dto.actorType,
            actorId: dto.actorId,
        });

        return {
            tenantId,
            previousState: tenant.accessState,
            currentState: updated.accessState,
            status: updated.status,
        };
    }

    // ─── Access Warnings ──────────────────────────────────────────────────────────

    async getAccessWarnings(userId: string, tenantId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            select: { tenant: { select: { accessState: true } } },
        });

        if (!membership) {
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }

        return {
            tenantId,
            accessState: membership.tenant.accessState,
            isWriteAllowed: this.policy.isWriteAllowed(membership.tenant.accessState),
            warnings: this.policy.getWarnings(membership.tenant.accessState),
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────────

    private async handleTenantCreatedOnboarding(userId: string, tenantId: string): Promise<void> {
        await this.onboardingService.initTenantActivation(tenantId);
        await this.onboardingService.markStepDone('USER_BOOTSTRAP', userId, 'setup_company', 'domain_event');
    }

    private formatTenantSummary(tenant: any, role: string) {
        return {
            id: tenant.id,
            name: tenant.name,
            inn: tenant.inn,
            status: tenant.status,
            accessState: tenant.accessState,
            role,
            settings: tenant.settings
                ? {
                    taxSystem: tenant.settings.taxSystem,
                    country: tenant.settings.country,
                    currency: tenant.settings.currency,
                    timezone: tenant.settings.timezone,
                    legalName: tenant.settings.legalName,
                }
                : null,
            closedAt: tenant.closedAt ?? null,
            retentionUntil: tenant.closureJob?.scheduledFor ?? null,
            createdAt: tenant.createdAt,
        };
    }

    private auditLog(event: string, data: Record<string, unknown> = {}): void {
        this.logger.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
    }
}
