import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/// Tenant 360 read-model. Цели §18 аналитики:
///   • p95 < 700ms даже на крупных tenants;
///   • никаких ad hoc joins по тяжёлым таблицам (orders, sync_run_items);
///   • данные представлены в summary-форме: счётчики + ограниченные recents.
///
/// Стратегия:
///   • один `Promise.all` параллельных bounded запросов вместо одного
///     mega-include на Tenant;
///   • для каждой "области" возвращаем counts + последние N записей
///     (`take: 5`) — этого достаточно support'у для триажа, но не
///     заваливает контекст;
///   • для notes/actions, которые добавятся в T4, возвращаем стабильную
///     форму (`pending_t4`) — frontend не сломается на их появлении.
@Injectable()
export class TenantSummaryService {
    constructor(private readonly prisma: PrismaService) {}

    async getTenant360(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                inn: true,
                status: true,
                accessState: true,
                closedAt: true,
                createdAt: true,
                updatedAt: true,
                primaryOwner: {
                    select: {
                        id: true,
                        email: true,
                        status: true,
                        emailVerifiedAt: true,
                        lastLoginAt: true,
                    },
                },
                settings: {
                    select: {
                        taxSystem: true,
                        country: true,
                        currency: true,
                        timezone: true,
                        legalName: true,
                    },
                },
                closureJob: {
                    select: {
                        status: true,
                        scheduledFor: true,
                        processedAt: true,
                        failureReason: true,
                    },
                },
            },
        });

        if (!tenant) {
            throw new NotFoundException({ code: 'ADMIN_TENANT_NOT_FOUND' });
        }

        const [
            team,
            invitations,
            accessHistory,
            marketplaceAccounts,
            recentSyncRuns,
            syncIssueCounts,
            recentNotifications,
            workerJobs,
            files,
            auditCounts,
            recentAudit,
            securityEvents,
            notes,
            recentSupportActions,
        ] = await Promise.all([
            this.collectTeam(tenantId),
            this.collectInvitations(tenantId),
            this.collectAccessHistory(tenantId),
            this.collectMarketplaceAccounts(tenantId),
            this.collectRecentSyncRuns(tenantId),
            this.collectSyncIssueCounts(tenantId),
            this.collectRecentNotifications(tenantId),
            this.collectWorkerJobs(tenantId),
            this.collectFiles(tenantId),
            this.collectAuditCounts(tenantId),
            this.collectRecentAudit(tenantId),
            this.collectSecurityEvents(tenantId),
            this.collectNotes(tenantId),
            this.collectRecentSupportActions(tenantId),
        ]);

        return {
            core: {
                id: tenant.id,
                name: tenant.name,
                inn: tenant.inn,
                status: tenant.status,
                accessState: tenant.accessState,
                closedAt: tenant.closedAt,
                createdAt: tenant.createdAt,
                updatedAt: tenant.updatedAt,
                settings: tenant.settings,
                closureJob: tenant.closureJob,
            },
            owner: tenant.primaryOwner,
            team,
            invitations,
            subscription: {
                accessState: tenant.accessState,
                tenantStatus: tenant.status,
                closedAt: tenant.closedAt,
                history: accessHistory,
            },
            marketplaceAccounts,
            sync: {
                recentRuns: recentSyncRuns,
                ...syncIssueCounts,
            },
            notifications: recentNotifications,
            worker: workerJobs,
            files,
            audit: {
                ...auditCounts,
                recent: recentAudit,
            },
            securityEvents,
            // §22: support_notes — internal handoff между сменами поддержки.
            // Список ограничен последними 10 записями; полный список доступен
            // через GET /api/admin/tenants/:tenantId/notes.
            notes: {
                status: 'ready' as const,
                items: notes,
            },
            // Recent support actions — даёт оператору сразу видеть, что
            // последние X действий уже выполняли коллеги (важно для handoff).
            supportActions: {
                recent: recentSupportActions,
            },
        };
    }

    // ─── team summary ─────────────────────────────────────────────

    private async collectTeam(tenantId: string) {
        const [byRole, recentJoins] = await Promise.all([
            this.prisma.membership.groupBy({
                by: ['role', 'status'],
                where: { tenantId },
                _count: { _all: true },
            }),
            this.prisma.membership.findMany({
                where: { tenantId, status: 'ACTIVE' },
                orderBy: { joinedAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    role: true,
                    joinedAt: true,
                    user: { select: { id: true, email: true } },
                },
            }),
        ]);

        const totals = byRole.reduce(
            (acc, row) => {
                const c = row._count._all;
                acc.total += c;
                if (row.status === 'ACTIVE') acc.active += c;
                if (row.status === 'REVOKED') acc.revoked += c;
                if (row.status === 'LEFT') acc.left += c;
                return acc;
            },
            { total: 0, active: 0, revoked: 0, left: 0 },
        );

        return {
            ...totals,
            byRole: byRole.map((row) => ({
                role: row.role,
                status: row.status,
                count: row._count._all,
            })),
            recentMembers: recentJoins,
        };
    }

    private async collectInvitations(tenantId: string) {
        const groups = await this.prisma.invitation.groupBy({
            by: ['status'],
            where: { tenantId },
            _count: { _all: true },
        });
        const map: Record<string, number> = { PENDING: 0, ACCEPTED: 0, CANCELLED: 0, EXPIRED: 0 };
        for (const g of groups) map[g.status] = g._count._all;
        return map;
    }

    private async collectAccessHistory(tenantId: string) {
        return this.prisma.tenantAccessStateEvent.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                id: true,
                fromState: true,
                toState: true,
                reasonCode: true,
                actorType: true,
                actorId: true,
                createdAt: true,
            },
        });
    }

    // ─── marketplace summary ──────────────────────────────────────

    private async collectMarketplaceAccounts(tenantId: string) {
        return this.prisma.marketplaceAccount.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                marketplace: true,
                label: true,
                lifecycleStatus: true,
                credentialStatus: true,
                syncHealthStatus: true,
                syncHealthReason: true,
                lastValidatedAt: true,
                lastSyncAt: true,
                lastSyncResult: true,
                lastSyncErrorCode: true,
                lastSyncErrorMessage: true,
                deactivatedAt: true,
                createdAt: true,
            },
        });
    }

    // ─── sync summary ─────────────────────────────────────────────

    private async collectRecentSyncRuns(tenantId: string) {
        return this.prisma.syncRun.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                id: true,
                marketplaceAccountId: true,
                triggerType: true,
                triggerScope: true,
                status: true,
                blockedReason: true,
                processedCount: true,
                errorCount: true,
                errorCode: true,
                errorMessage: true,
                startedAt: true,
                finishedAt: true,
                durationMs: true,
                createdAt: true,
            },
        });
    }

    private async collectSyncIssueCounts(tenantId: string) {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const [failedRuns, openConflicts] = await Promise.all([
            this.prisma.syncRun.count({
                where: { tenantId, status: 'FAILED', createdAt: { gte: since } },
            }),
            this.prisma.syncConflict.count({
                where: { tenantId, resolvedAt: null },
            }),
        ]);
        return {
            failedRunsLast7d: failedRuns,
            openConflicts,
        };
    }

    // ─── notifications summary ────────────────────────────────────

    private async collectRecentNotifications(tenantId: string) {
        const [recent, severityCounts] = await Promise.all([
            this.prisma.notificationEvent.findMany({
                where: { tenantId },
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    category: true,
                    severity: true,
                    isMandatory: true,
                    createdAt: true,
                },
            }),
            this.prisma.notificationEvent.groupBy({
                by: ['severity'],
                where: {
                    tenantId,
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
                },
                _count: { _all: true },
            }),
        ]);
        const counts: Record<string, number> = { INFO: 0, WARNING: 0, CRITICAL: 0 };
        for (const row of severityCounts) counts[row.severity] = row._count._all;
        return { recent, severityCountsLast7d: counts };
    }

    // ─── worker summary ───────────────────────────────────────────

    private async collectWorkerJobs(tenantId: string) {
        const [byStatus, recentFailed] = await Promise.all([
            this.prisma.workerJob.groupBy({
                by: ['status'],
                where: { tenantId },
                _count: { _all: true },
            }),
            this.prisma.workerJob.findMany({
                where: { tenantId, status: { in: ['failed', 'dead_lettered'] } },
                orderBy: { finishedAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    jobType: true,
                    queueName: true,
                    status: true,
                    attempt: true,
                    maxAttempts: true,
                    lastError: true,
                    finishedAt: true,
                },
            }),
        ]);
        const counts: Record<string, number> = {};
        for (const row of byStatus) counts[row.status] = row._count._all;
        return { statusCounts: counts, recentFailed };
    }

    // ─── files summary ────────────────────────────────────────────

    private async collectFiles(tenantId: string) {
        const [byStatus, totalSize] = await Promise.all([
            this.prisma.file.groupBy({
                by: ['status'],
                where: { tenantId },
                _count: { _all: true },
            }),
            this.prisma.file.aggregate({
                where: { tenantId, status: 'active' },
                _sum: { sizeBytes: true },
            }),
        ]);
        const counts: Record<string, number> = {};
        for (const row of byStatus) counts[row.status] = row._count._all;
        return {
            statusCounts: counts,
            // BigInt → string, чтобы безопасно сериализоваться в JSON
            // (JSON.stringify не поддерживает BigInt напрямую).
            totalSizeBytes: (totalSize._sum.sizeBytes ?? BigInt(0)).toString(),
        };
    }

    // ─── audit summary ────────────────────────────────────────────

    private async collectAuditCounts(tenantId: string) {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const [last7d, total] = await Promise.all([
            this.prisma.auditLog.count({ where: { tenantId, createdAt: { gte: since } } }),
            this.prisma.auditLog.count({ where: { tenantId } }),
        ]);
        return { totalEvents: total, eventsLast7d: last7d };
    }

    private async collectRecentAudit(tenantId: string) {
        return this.prisma.auditLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                eventType: true,
                eventDomain: true,
                entityType: true,
                entityId: true,
                actorType: true,
                actorId: true,
                actorRole: true,
                source: true,
                createdAt: true,
            },
        });
    }

    private async collectSecurityEvents(tenantId: string) {
        return this.prisma.securityEvent.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                id: true,
                eventType: true,
                userId: true,
                ip: true,
                createdAt: true,
            },
        });
    }

    // ─── support_notes (T3) ───────────────────────────────────────
    // Last 10 — для tenant 360 хватает; полный список через GET /notes endpoint.
    private async collectNotes(tenantId: string) {
        const items = await this.prisma.supportNote.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                note: true,
                createdAt: true,
                updatedAt: true,
                authorSupportUser: { select: { id: true, email: true, role: true } },
            },
        });
        return items.map((n) => ({
            id: n.id,
            note: n.note,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            author: {
                id: n.authorSupportUser.id,
                email: n.authorSupportUser.email,
                role: n.authorSupportUser.role,
            },
        }));
    }

    // ─── support_actions (T3) ─────────────────────────────────────
    // Recent 10 mutating actions — даёт оператору контекст недавних
    // вмешательств коллег (важно для handoff и инцидент-триажа).
    private async collectRecentSupportActions(tenantId: string) {
        return this.prisma.supportAction.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                actionType: true,
                resultStatus: true,
                errorCode: true,
                reason: true,
                payload: true,
                createdAt: true,
                actorSupportUser: { select: { id: true, email: true, role: true } },
            },
        });
    }
}
