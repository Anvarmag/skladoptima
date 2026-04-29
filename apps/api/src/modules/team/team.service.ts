import {
    Injectable,
    ForbiddenException,
    ConflictException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../auth/email.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';
import { Role } from '@prisma/client';
import * as crypto from 'crypto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ChangeRoleDto } from './dto/change-role.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TeamService {
    private readonly logger = new Logger(TeamService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
        private readonly onboardingService: OnboardingService,
        private readonly auditService: AuditService,
    ) {}

    // ─── Create Invitation ────────────────────────────────────────────────────────

    async createInvitation(actorUserId: string, tenantId: string, dto: CreateInvitationDto) {
        const email = dto.email.toLowerCase().trim();

        const actorMembership = await this.getActorMembership(actorUserId, tenantId);
        this.assertCanManageInvites(actorMembership.role);

        // Invite на роль OWNER запрещён на MVP
        if (dto.role === 'OWNER') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        // Self-invite
        const actor = await this.prisma.user.findUnique({
            where: { id: actorUserId },
            select: { email: true },
        });
        if (actor?.email === email) {
            throw new ConflictException({ code: 'INVITATION_SELF_INVITE' });
        }

        // Если пользователь с таким email уже ACTIVE-участник tenant
        const existingUser = await this.prisma.user.findUnique({
            where: { email },
            select: { id: true },
        });
        if (existingUser) {
            const activeMembership = await this.prisma.membership.findFirst({
                where: { userId: existingUser.id, tenantId, status: 'ACTIVE' },
            });
            if (activeMembership) {
                throw new ConflictException({ code: 'INVITATION_ALREADY_MEMBER' });
            }
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

        let invitation;
        try {
            invitation = await this.prisma.invitation.create({
                data: { email, role: dto.role, tokenHash, expiresAt, tenantId, invitedByUserId: actorUserId },
            });
        } catch (e: any) {
            // Частичный уникальный индекс: один pending-инвайт на (tenant, email)
            if (e.code === 'P2002') {
                throw new ConflictException({ code: 'INVITATION_ALREADY_PENDING' });
            }
            throw e;
        }

        await this.recordTeamEvent(tenantId, actorUserId, 'team_invitation_created', {
            invitationId: invitation.id,
            email,
            role: dto.role,
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.INVITE_CREATED,
            entityType: 'INVITATION',
            entityId: invitation.id,
            actorType: 'user',
            actorId: actorUserId,
            source: 'ui',
            metadata: { email, role: dto.role },
        });

        // Асинхронная отправка email — не блокируем ответ
        this.emailService.sendInviteEmail(email, rawToken).catch((err) => {
            this.logger.error(`Failed to send invite email to ${email}: ${err.message}`);
        });

        // T4-04: domain event — первый инвайт завершает шаг invite_team
        this.onboardingService.markStepDone('TENANT_ACTIVATION', tenantId, 'invite_team', 'domain_event').catch((err: unknown) =>
            this.logger.warn(JSON.stringify({ event: 'onboarding_step_update_failed', stepKey: 'invite_team', err: (err as any)?.message })),
        );

        return {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            createdAt: invitation.createdAt,
        };
    }

    // ─── List Invitations ─────────────────────────────────────────────────────────

    async listInvitations(actorUserId: string, tenantId: string) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);
        this.assertCanManageInvites(actorMembership.role);

        const invitations = await this.prisma.invitation.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            include: {
                invitedBy: { select: { id: true, email: true } },
            },
        });

        return invitations.map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role,
            status: inv.status,
            expiresAt: inv.expiresAt,
            acceptedAt: inv.acceptedAt,
            cancelledAt: inv.cancelledAt,
            invitedBy: inv.invitedBy,
            createdAt: inv.createdAt,
        }));
    }

    // ─── Resend Invitation ────────────────────────────────────────────────────────

    async resendInvitation(actorUserId: string, tenantId: string, invitationId: string) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);
        this.assertCanManageInvites(actorMembership.role);

        const invitation = await this.prisma.invitation.findFirst({
            where: { id: invitationId, tenantId },
        });

        if (!invitation) {
            throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
        }

        if (invitation.status !== 'PENDING') {
            throw new ConflictException({ code: 'INVITATION_NOT_PENDING', status: invitation.status });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

        await this.prisma.invitation.update({
            where: { id: invitationId },
            data: { tokenHash, expiresAt },
        });

        await this.recordTeamEvent(tenantId, actorUserId, 'team_invitation_resent', {
            invitationId,
            email: invitation.email,
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.INVITE_RESENT,
            entityType: 'INVITATION',
            entityId: invitationId,
            actorType: 'user',
            actorId: actorUserId,
            source: 'ui',
            metadata: { email: invitation.email },
        });

        this.emailService.sendInviteEmail(invitation.email, rawToken).catch((err) => {
            this.logger.error(`Failed to resend invite email to ${invitation.email}: ${err.message}`);
        });

        return { invitationId, status: 'PENDING' as const, expiresAt };
    }

    // ─── Accept Invitation ────────────────────────────────────────────────────────

    async acceptInvitation(rawToken: string, userId: string) {
        const tokenHash = this.hashToken(rawToken);

        const invitation = await this.prisma.invitation.findUnique({
            where: { tokenHash },
            include: { tenant: { select: { accessState: true } } },
        });

        if (!invitation) {
            throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
        }

        // Блокируем accept в TRIAL_EXPIRED / SUSPENDED / CLOSED
        const WRITE_BLOCKED = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);
        if (WRITE_BLOCKED.has(invitation.tenant.accessState)) {
            throw new ForbiddenException({
                code: 'TEAM_WRITE_BLOCKED_BY_TENANT_STATE',
                accessState: invitation.tenant.accessState,
            });
        }

        // Идемпотентность: уже принят
        if (invitation.status === 'ACCEPTED') {
            return { status: 'ALREADY_ACCEPTED' as const, tenantId: invitation.tenantId, role: invitation.role };
        }

        if (invitation.status === 'CANCELLED') {
            throw new ConflictException({ code: 'INVITATION_ALREADY_USED' });
        }

        const now = new Date();

        if (invitation.status === 'EXPIRED' || invitation.expiresAt < now) {
            if (invitation.status === 'PENDING') {
                await this.prisma.invitation.update({
                    where: { id: invitation.id },
                    data: { status: 'EXPIRED' },
                });
            }
            throw new ConflictException({ code: 'INVITATION_EXPIRED' });
        }

        // Проверяем верифицированный email пользователя
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, emailVerifiedAt: true },
        });

        if (!user || !user.emailVerifiedAt) {
            throw new ForbiddenException({ code: 'AUTH_EMAIL_NOT_VERIFIED' });
        }

        if (user.email !== invitation.email) {
            throw new ForbiddenException({ code: 'INVITATION_EMAIL_MISMATCH' });
        }

        // Идемпотентность: уже активный участник
        const existingMembership = await this.prisma.membership.findFirst({
            where: { userId, tenantId: invitation.tenantId, status: 'ACTIVE' },
            select: { role: true },
        });

        if (existingMembership) {
            await this.prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: userId },
            });
            return { status: 'ALREADY_MEMBER' as const, tenantId: invitation.tenantId, role: existingMembership.role };
        }

        await this.prisma.$transaction([
            this.prisma.membership.create({
                data: {
                    userId,
                    tenantId: invitation.tenantId,
                    role: invitation.role,
                    status: 'ACTIVE',
                    joinedAt: now,
                },
            }),
            this.prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: userId },
            }),
            this.prisma.user.update({
                where: { id: userId },
                data: { membershipVersion: { increment: 1 } },
            }),
        ]);

        await this.recordTeamEvent(invitation.tenantId, userId, 'team_invitation_accepted', {
            invitationId: invitation.id,
            email: user.email,
            via: 'token',
        });

        return { status: 'ACCEPTED' as const, tenantId: invitation.tenantId, role: invitation.role };
    }

    // ─── Cancel Invitation ────────────────────────────────────────────────────────

    async cancelInvitation(actorUserId: string, tenantId: string, invitationId: string) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);
        this.assertCanManageInvites(actorMembership.role);

        const invitation = await this.prisma.invitation.findFirst({
            where: { id: invitationId, tenantId },
        });

        if (!invitation) {
            throw new NotFoundException({ code: 'INVITATION_NOT_FOUND' });
        }

        if (invitation.status !== 'PENDING') {
            throw new ConflictException({ code: 'INVITATION_NOT_PENDING', status: invitation.status });
        }

        await this.prisma.invitation.update({
            where: { id: invitationId },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        await this.recordTeamEvent(tenantId, actorUserId, 'team_invitation_cancelled', {
            invitationId,
            email: invitation.email,
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.INVITE_CANCELLED,
            entityType: 'INVITATION',
            entityId: invitationId,
            actorType: 'user',
            actorId: actorUserId,
            source: 'ui',
            metadata: { email: invitation.email },
        });

        return { invitationId, status: 'CANCELLED' as const };
    }

    // ─── List Members ─────────────────────────────────────────────────────────────

    async listMembers(actorUserId: string, tenantId: string) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);
        // STAFF не имеет доступа к списку команды
        if (actorMembership.role === 'STAFF') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        const memberships = await this.prisma.membership.findMany({
            where: { tenantId, status: 'ACTIVE' },
            include: { user: { select: { id: true, email: true } } },
            orderBy: { joinedAt: 'asc' },
        });

        return memberships.map((m) => ({
            membershipId: m.id,
            userId: m.userId,
            email: m.user.email,
            role: m.role,
            joinedAt: m.joinedAt,
        }));
    }

    // ─── Change Role ──────────────────────────────────────────────────────────────

    async changeRole(actorUserId: string, tenantId: string, membershipId: string, dto: ChangeRoleDto) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);

        if (actorMembership.role !== 'OWNER') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        // Назначение роли OWNER через смену запрещено на MVP
        if (dto.role === 'OWNER') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        const target = await this.prisma.membership.findFirst({
            where: { id: membershipId, tenantId, status: 'ACTIVE' },
            select: { id: true, userId: true, role: true },
        });

        if (!target) {
            throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND' });
        }

        // Нельзя понизить последнего OWNER
        if (target.role === 'OWNER') {
            await this.assertNotLastOwner(tenantId, membershipId);
        }

        await this.prisma.$transaction([
            this.prisma.membership.update({
                where: { id: membershipId },
                data: { role: dto.role },
            }),
            this.prisma.user.update({
                where: { id: target.userId },
                data: { membershipVersion: { increment: 1 } },
            }),
        ]);

        await this.recordTeamEvent(tenantId, actorUserId, 'membership_role_changed', {
            membershipId,
            targetUserId: target.userId,
            fromRole: target.role,
            toRole: dto.role,
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.MEMBER_ROLE_CHANGED,
            entityType: 'MEMBERSHIP',
            entityId: membershipId,
            actorType: 'user',
            actorId: actorUserId,
            source: 'ui',
            before: { role: target.role },
            after: { role: dto.role },
            changedFields: ['role'],
            metadata: { targetUserId: target.userId },
        });

        return { membershipId, role: dto.role };
    }

    // ─── Remove Member ────────────────────────────────────────────────────────────

    async removeMember(actorUserId: string, tenantId: string, membershipId: string) {
        const actorMembership = await this.getActorMembership(actorUserId, tenantId);

        const target = await this.prisma.membership.findFirst({
            where: { id: membershipId, tenantId, status: 'ACTIVE' },
            select: { id: true, userId: true, role: true },
        });

        if (!target) {
            throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND' });
        }

        // Нельзя удалить себя через removeMember — для этого есть leaveTeam
        if (target.userId === actorUserId) {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        // Матрица прав:
        // OWNER — может удалять всех (кроме последнего OWNER)
        // ADMIN — только MANAGER/STAFF
        if (actorMembership.role === 'ADMIN') {
            if (target.role === 'OWNER' || target.role === 'ADMIN') {
                throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
            }
        } else if (actorMembership.role !== 'OWNER') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        // Last-owner guard
        if (target.role === 'OWNER') {
            await this.assertNotLastOwner(tenantId, membershipId);
        }

        const now = new Date();
        await this.prisma.$transaction([
            this.prisma.membership.update({
                where: { id: membershipId },
                data: { status: 'REVOKED', revokedAt: now },
            }),
            this.prisma.user.update({
                where: { id: target.userId },
                data: { membershipVersion: { increment: 1 } },
            }),
        ]);

        await this.recordTeamEvent(tenantId, actorUserId, 'membership_removed', {
            membershipId,
            targetUserId: target.userId,
            targetRole: target.role,
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.MEMBER_REMOVED,
            entityType: 'MEMBERSHIP',
            entityId: membershipId,
            actorType: 'user',
            actorId: actorUserId,
            source: 'ui',
            metadata: { targetUserId: target.userId, targetRole: target.role },
        });

        return { membershipId, status: 'REVOKED' as const };
    }

    // ─── Leave Team ───────────────────────────────────────────────────────────────

    async leaveTeam(actorUserId: string, tenantId: string, membershipId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { id: membershipId, tenantId, status: 'ACTIVE' },
            select: { id: true, userId: true, role: true },
        });

        if (!membership) {
            throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND' });
        }

        // Можно выйти только из своей membership
        if (membership.userId !== actorUserId) {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }

        // Last-owner guard: единственный OWNER не может выйти
        if (membership.role === 'OWNER') {
            await this.assertNotLastOwner(tenantId, membershipId);
        }

        const now = new Date();
        await this.prisma.$transaction([
            this.prisma.membership.update({
                where: { id: membershipId },
                data: { status: 'LEFT', leftAt: now },
            }),
            this.prisma.user.update({
                where: { id: actorUserId },
                data: { membershipVersion: { increment: 1 } },
            }),
        ]);

        await this.recordTeamEvent(tenantId, actorUserId, 'membership_left', {
            membershipId,
        });

        return { membershipId, status: 'LEFT' as const };
    }

    // ─── Private helpers ─────────────────────────────────────────────────────────

    private async getActorMembership(userId: string, tenantId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        return membership;
    }

    private assertCanManageInvites(actorRole: Role): void {
        if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
            throw new ForbiddenException({ code: 'ROLE_CHANGE_NOT_ALLOWED' });
        }
    }

    // Проверяет, что в tenant останется хотя бы один ACTIVE OWNER после операции над membershipId
    private async assertNotLastOwner(tenantId: string, membershipId: string): Promise<void> {
        const otherOwnerCount = await this.prisma.membership.count({
            where: { tenantId, role: 'OWNER', status: 'ACTIVE', id: { not: membershipId } },
        });
        if (otherOwnerCount === 0) {
            throw new ForbiddenException({ code: 'LAST_OWNER_GUARD' });
        }
    }

    private async recordTeamEvent(
        tenantId: string,
        actorUserId: string,
        eventType: string,
        payload: object,
    ): Promise<void> {
        await this.prisma.teamEvent.create({
            data: { tenantId, actorUserId, eventType, payload },
        });
    }

    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }
}
