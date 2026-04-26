import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { TeamService } from './team.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../auth/email.service';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        invitation: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        membership: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
        },
        teamEvent: { create: jest.fn() },
        user: { findUnique: jest.fn() },
        $transaction: jest.fn().mockImplementation((arg: any) =>
            typeof arg === 'function' ? arg(mock) : Promise.all(arg),
        ),
    };
    return mock;
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const OWNER_ID  = 'user-owner';
const ADMIN_ID  = 'user-admin';
const MANAGER_ID = 'user-manager';
const STAFF_ID  = 'user-staff';
const TARGET_ID = 'user-target';

const MEMBERSHIP = (role: string, userId = OWNER_ID) => ({ id: `mbr-${userId}`, userId, tenantId: TENANT_ID, role, status: 'ACTIVE' });

const PENDING_INV = {
    id: 'inv-1',
    tenantId: TENANT_ID,
    email: 'invitee@example.com',
    role: 'MANAGER',
    status: 'PENDING',
    tokenHash: 'hash-abc',
    expiresAt: new Date(Date.now() + 7 * 86400_000),
    acceptedAt: null,
    cancelledAt: null,
    invitedByUserId: OWNER_ID,
    invitedBy: { id: OWNER_ID, email: 'owner@example.com' },
    tenant: { accessState: 'TRIAL_ACTIVE' },
};

const VERIFIED_USER = {
    id: 'user-invitee',
    email: 'invitee@example.com',
    emailVerifiedAt: new Date('2026-01-01'),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('TeamService', () => {
    let service: TeamService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let emailService: jest.Mocked<Pick<EmailService, 'sendInviteEmail'>>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        emailService = { sendInviteEmail: jest.fn().mockResolvedValue(undefined) };

        const module = await Test.createTestingModule({
            providers: [
                TeamService,
                { provide: PrismaService, useValue: prisma },
                { provide: EmailService, useValue: emailService },
            ],
        }).compile();

        service = module.get(TeamService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── createInvitation ─────────────────────────────────────────────────────

    describe('createInvitation', () => {
        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('OWNER'));
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' }) // actor
                .mockResolvedValueOnce(null); // invitee not in system
            prisma.invitation.create.mockResolvedValue({ ...PENDING_INV, id: 'inv-new' });
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('OWNER: создаёт инвайт и отправляет email', async () => {
            const result = await service.createInvitation(OWNER_ID, TENANT_ID, { email: 'invitee@example.com', role: 'MANAGER' as any });

            expect(result.status).toBe('PENDING');
            expect(prisma.invitation.create).toHaveBeenCalled();
            expect(emailService.sendInviteEmail).toHaveBeenCalledWith('invitee@example.com', expect.any(String));
        });

        it('ADMIN: может создавать инвайты', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('ADMIN', ADMIN_ID));
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: ADMIN_ID, email: 'admin@example.com' })
                .mockResolvedValueOnce(null);
            prisma.invitation.create.mockResolvedValue({ ...PENDING_INV });

            const result = await service.createInvitation(ADMIN_ID, TENANT_ID, { email: 'new@example.com', role: 'STAFF' as any });
            expect(result.status).toBe('PENDING');
        });

        it('MANAGER: не может создавать инвайты → ROLE_CHANGE_NOT_ALLOWED', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('MANAGER', MANAGER_ID));
            await expect(service.createInvitation(MANAGER_ID, TENANT_ID, { email: 'x@x.com', role: 'STAFF' as any }))
                .rejects.toThrow(ForbiddenException);
        });

        it('STAFF: не может создавать инвайты', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('STAFF', STAFF_ID));
            await expect(service.createInvitation(STAFF_ID, TENANT_ID, { email: 'x@x.com', role: 'STAFF' as any }))
                .rejects.toThrow(ForbiddenException);
        });

        it('запрещает инвайт на роль OWNER', async () => {
            await expect(service.createInvitation(OWNER_ID, TENANT_ID, { email: 'x@x.com', role: 'OWNER' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROLE_CHANGE_NOT_ALLOWED' }) });
        });

        it('запрещает self-invite', async () => {
            prisma.user.findUnique.mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' });
            await expect(service.createInvitation(OWNER_ID, TENANT_ID, { email: 'owner@example.com', role: 'MANAGER' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_SELF_INVITE' }) });
        });

        it('запрещает инвайт уже активного участника → INVITATION_ALREADY_MEMBER', async () => {
            // Reset and re-configure mocks for this scenario
            prisma.membership.findFirst.mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))               // actor lookup
                .mockResolvedValueOnce(MEMBERSHIP('MANAGER', TARGET_ID)); // invitee already active
            prisma.user.findUnique.mockReset()
                .mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' }) // actor email
                .mockResolvedValueOnce({ id: TARGET_ID });                            // invitee found

            await expect(service.createInvitation(OWNER_ID, TENANT_ID, { email: 'target@x.com', role: 'STAFF' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_ALREADY_MEMBER' }) });
        });

        it('P2002 от индекса → INVITATION_ALREADY_PENDING', async () => {
            prisma.invitation.create.mockRejectedValue({ code: 'P2002' });
            await expect(service.createInvitation(OWNER_ID, TENANT_ID, { email: 'invitee@example.com', role: 'MANAGER' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_ALREADY_PENDING' }) });
        });

        it('записывает TeamEvent team_invitation_created', async () => {
            await service.createInvitation(OWNER_ID, TENANT_ID, { email: 'invitee@example.com', role: 'MANAGER' as any });
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'team_invitation_created' }) }),
            );
        });
    });

    // ─── resendInvitation ─────────────────────────────────────────────────────

    describe('resendInvitation', () => {
        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('OWNER'));
            prisma.invitation.findFirst.mockResolvedValue(PENDING_INV);
            prisma.invitation.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('обновляет токен/TTL и переотправляет email', async () => {
            const result = await service.resendInvitation(OWNER_ID, TENANT_ID, 'inv-1');
            expect(result.status).toBe('PENDING');
            expect(prisma.invitation.update).toHaveBeenCalled();
            expect(emailService.sendInviteEmail).toHaveBeenCalled();
        });

        it('INVITATION_NOT_FOUND если инвайт не найден', async () => {
            prisma.invitation.findFirst.mockResolvedValue(null);
            await expect(service.resendInvitation(OWNER_ID, TENANT_ID, 'inv-bad'))
                .rejects.toThrow(NotFoundException);
        });

        it('INVITATION_NOT_PENDING если статус не PENDING', async () => {
            prisma.invitation.findFirst.mockResolvedValue({ ...PENDING_INV, status: 'ACCEPTED' });
            await expect(service.resendInvitation(OWNER_ID, TENANT_ID, 'inv-1'))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_NOT_PENDING' }) });
        });

        it('записывает TeamEvent team_invitation_resent', async () => {
            await service.resendInvitation(OWNER_ID, TENANT_ID, 'inv-1');
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'team_invitation_resent' }) }),
            );
        });
    });

    // ─── cancelInvitation ─────────────────────────────────────────────────────

    describe('cancelInvitation', () => {
        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('OWNER'));
            prisma.invitation.findFirst.mockResolvedValue(PENDING_INV);
            prisma.invitation.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('отменяет PENDING инвайт', async () => {
            const result = await service.cancelInvitation(OWNER_ID, TENANT_ID, 'inv-1');
            expect(result.status).toBe('CANCELLED');
        });

        it('INVITATION_NOT_PENDING для не-PENDING статуса', async () => {
            prisma.invitation.findFirst.mockResolvedValue({ ...PENDING_INV, status: 'EXPIRED' });
            await expect(service.cancelInvitation(OWNER_ID, TENANT_ID, 'inv-1'))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_NOT_PENDING' }) });
        });

        it('записывает TeamEvent team_invitation_cancelled', async () => {
            await service.cancelInvitation(OWNER_ID, TENANT_ID, 'inv-1');
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'team_invitation_cancelled' }) }),
            );
        });
    });

    // ─── acceptInvitation ─────────────────────────────────────────────────────

    describe('acceptInvitation', () => {
        const RAW_TOKEN = 'raw-token-64hex';

        beforeEach(() => {
            prisma.invitation.findUnique.mockResolvedValue(PENDING_INV);
            prisma.user.findUnique.mockResolvedValue(VERIFIED_USER);
            prisma.membership.findFirst.mockResolvedValue(null); // not yet member
            prisma.membership.create.mockResolvedValue({});
            prisma.invitation.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('существующий пользователь: создаёт membership и помечает инвайт ACCEPTED', async () => {
            const result = await service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id);
            expect(result.status).toBe('ACCEPTED');
            expect(result.tenantId).toBe(TENANT_ID);
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'team_invitation_accepted' }) }),
            );
        });

        it('идемпотентность: уже ACCEPTED → возвращает ALREADY_ACCEPTED без ошибки', async () => {
            prisma.invitation.findUnique.mockResolvedValue({ ...PENDING_INV, status: 'ACCEPTED' });
            const result = await service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id);
            expect(result.status).toBe('ALREADY_ACCEPTED');
        });

        it('идемпотентность: уже участник → ALREADY_MEMBER, помечает инвайт ACCEPTED', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('MANAGER', VERIFIED_USER.id));
            const result = await service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id);
            expect(result.status).toBe('ALREADY_MEMBER');
        });

        it('INVITATION_EXPIRED для истёкшего TTL', async () => {
            prisma.invitation.findUnique.mockResolvedValue({
                ...PENDING_INV,
                expiresAt: new Date(Date.now() - 1000),
            });
            prisma.invitation.update.mockResolvedValue({});
            await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_EXPIRED' }) });
        });

        it('INVITATION_EXPIRED для статуса EXPIRED', async () => {
            prisma.invitation.findUnique.mockResolvedValue({ ...PENDING_INV, status: 'EXPIRED' });
            await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_EXPIRED' }) });
        });

        it('INVITATION_ALREADY_USED для CANCELLED инвайта', async () => {
            prisma.invitation.findUnique.mockResolvedValue({ ...PENDING_INV, status: 'CANCELLED' });
            await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_ALREADY_USED' }) });
        });

        it('INVITATION_EMAIL_MISMATCH: email пользователя не совпадает с инвайтом', async () => {
            prisma.user.findUnique.mockResolvedValue({ ...VERIFIED_USER, email: 'other@example.com' });
            await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVITATION_EMAIL_MISMATCH' }) });
        });

        it('AUTH_EMAIL_NOT_VERIFIED: email пользователя не подтверждён', async () => {
            prisma.user.findUnique.mockResolvedValue({ ...VERIFIED_USER, emailVerifiedAt: null });
            await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'AUTH_EMAIL_NOT_VERIFIED' }) });
        });

        it('INVITATION_NOT_FOUND для неизвестного токена', async () => {
            prisma.invitation.findUnique.mockResolvedValue(null);
            await expect(service.acceptInvitation('bad-token', VERIFIED_USER.id))
                .rejects.toThrow(NotFoundException);
        });

        // ─── Tenant state guards ──────────────────────────────────────────────

        it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
            'TEAM_WRITE_BLOCKED_BY_TENANT_STATE при accessState=%s',
            async (accessState) => {
                prisma.invitation.findUnique.mockResolvedValue({
                    ...PENDING_INV,
                    tenant: { accessState },
                });
                await expect(service.acceptInvitation(RAW_TOKEN, VERIFIED_USER.id))
                    .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TEAM_WRITE_BLOCKED_BY_TENANT_STATE' }) });
            },
        );
    });

    // ─── listMembers ──────────────────────────────────────────────────────────

    describe('listMembers', () => {
        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('OWNER'));
            prisma.membership.findMany.mockResolvedValue([
                { id: 'mbr-1', userId: OWNER_ID, tenantId: TENANT_ID, role: 'OWNER', joinedAt: new Date(), user: { id: OWNER_ID, email: 'owner@example.com' } },
                { id: 'mbr-2', userId: MANAGER_ID, tenantId: TENANT_ID, role: 'MANAGER', joinedAt: new Date(), user: { id: MANAGER_ID, email: 'manager@example.com' } },
            ]);
        });

        it('OWNER: возвращает список ACTIVE участников', async () => {
            const result = await service.listMembers(OWNER_ID, TENANT_ID);
            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('OWNER');
        });

        it('MANAGER: может видеть список (read-only)', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('MANAGER', MANAGER_ID));
            const result = await service.listMembers(MANAGER_ID, TENANT_ID);
            expect(result).toHaveLength(2);
        });

        it('STAFF: ROLE_CHANGE_NOT_ALLOWED — нет доступа к списку', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('STAFF', STAFF_ID));
            await expect(service.listMembers(STAFF_ID, TENANT_ID))
                .rejects.toThrow(ForbiddenException);
        });
    });

    // ─── changeRole ───────────────────────────────────────────────────────────

    describe('changeRole', () => {
        beforeEach(() => {
            prisma.membership.findFirst
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))       // actor
                .mockResolvedValueOnce({ ...MEMBERSHIP('MANAGER', TARGET_ID), id: 'mbr-target' }); // target
            prisma.membership.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('OWNER: меняет роль MANAGER → STAFF', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ id: 'mbr-target', userId: TARGET_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' });

            const result = await service.changeRole(OWNER_ID, TENANT_ID, 'mbr-target', { role: 'STAFF' as any });
            expect(result.role).toBe('STAFF');
            expect(prisma.membership.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ role: 'STAFF' }) }),
            );
        });

        it('ADMIN: не может менять роли → ROLE_CHANGE_NOT_ALLOWED', async () => {
            prisma.membership.findFirst.mockReset().mockResolvedValueOnce(MEMBERSHIP('ADMIN', ADMIN_ID));
            await expect(service.changeRole(ADMIN_ID, TENANT_ID, 'mbr-target', { role: 'STAFF' as any }))
                .rejects.toThrow(ForbiddenException);
        });

        it('запрещает назначение роли OWNER', async () => {
            prisma.membership.findFirst.mockReset().mockResolvedValueOnce(MEMBERSHIP('OWNER'));
            await expect(service.changeRole(OWNER_ID, TENANT_ID, 'mbr-target', { role: 'OWNER' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROLE_CHANGE_NOT_ALLOWED' }) });
        });

        it('LAST_OWNER_GUARD: нельзя понизить последнего OWNER', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ id: 'mbr-owner2', userId: TARGET_ID, tenantId: TENANT_ID, role: 'OWNER', status: 'ACTIVE' });
            prisma.membership.count.mockResolvedValue(0); // no other owners

            await expect(service.changeRole(OWNER_ID, TENANT_ID, 'mbr-owner2', { role: 'ADMIN' as any }))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'LAST_OWNER_GUARD' }) });
        });

        it('MEMBERSHIP_NOT_FOUND если участник не найден', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce(null);

            await expect(service.changeRole(OWNER_ID, TENANT_ID, 'mbr-ghost', { role: 'STAFF' as any }))
                .rejects.toThrow(NotFoundException);
        });

        it('записывает TeamEvent membership_role_changed', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ id: 'mbr-target', userId: TARGET_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' });

            await service.changeRole(OWNER_ID, TENANT_ID, 'mbr-target', { role: 'STAFF' as any });
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'membership_role_changed' }) }),
            );
        });
    });

    // ─── removeMember ─────────────────────────────────────────────────────────

    describe('removeMember', () => {
        const TARGET_MBR = { id: 'mbr-target', userId: TARGET_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' };

        beforeEach(() => {
            prisma.membership.findFirst
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce(TARGET_MBR);
            prisma.membership.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('OWNER: удаляет MANAGER → статус REVOKED', async () => {
            const result = await service.removeMember(OWNER_ID, TENANT_ID, 'mbr-target');
            expect(result.status).toBe('REVOKED');
            expect(prisma.membership.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }),
            );
        });

        it('ADMIN: может удалить MANAGER', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('ADMIN', ADMIN_ID))
                .mockResolvedValueOnce(TARGET_MBR);

            const result = await service.removeMember(ADMIN_ID, TENANT_ID, 'mbr-target');
            expect(result.status).toBe('REVOKED');
        });

        it('ADMIN: не может удалить OWNER → ROLE_CHANGE_NOT_ALLOWED', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('ADMIN', ADMIN_ID))
                .mockResolvedValueOnce({ ...TARGET_MBR, role: 'OWNER' });

            await expect(service.removeMember(ADMIN_ID, TENANT_ID, 'mbr-target'))
                .rejects.toThrow(ForbiddenException);
        });

        it('ADMIN: не может удалить другого ADMIN', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('ADMIN', ADMIN_ID))
                .mockResolvedValueOnce({ ...TARGET_MBR, role: 'ADMIN' });

            await expect(service.removeMember(ADMIN_ID, TENANT_ID, 'mbr-target'))
                .rejects.toThrow(ForbiddenException);
        });

        it('нельзя удалить себя через removeMember', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ ...TARGET_MBR, userId: OWNER_ID }); // self

            await expect(service.removeMember(OWNER_ID, TENANT_ID, 'mbr-target'))
                .rejects.toThrow(ForbiddenException);
        });

        it('LAST_OWNER_GUARD при удалении последнего OWNER', async () => {
            prisma.membership.findFirst
                .mockReset()
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ ...TARGET_MBR, role: 'OWNER' });
            prisma.membership.count.mockResolvedValue(0);

            await expect(service.removeMember(OWNER_ID, TENANT_ID, 'mbr-target'))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'LAST_OWNER_GUARD' }) });
        });

        it('записывает TeamEvent membership_removed', async () => {
            await service.removeMember(OWNER_ID, TENANT_ID, 'mbr-target');
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'membership_removed' }) }),
            );
        });
    });

    // ─── leaveTeam ────────────────────────────────────────────────────────────

    describe('leaveTeam', () => {
        const MY_MBR = { id: 'mbr-me', userId: MANAGER_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' };

        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue(MY_MBR);
            prisma.membership.update.mockResolvedValue({});
            prisma.teamEvent.create.mockResolvedValue({});
        });

        it('MANAGER: может покинуть команду → статус LEFT', async () => {
            const result = await service.leaveTeam(MANAGER_ID, TENANT_ID, 'mbr-me');
            expect(result.status).toBe('LEFT');
            expect(prisma.membership.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'LEFT' }) }),
            );
        });

        it('нельзя покинуть чужую membership → ROLE_CHANGE_NOT_ALLOWED', async () => {
            await expect(service.leaveTeam('other-user', TENANT_ID, 'mbr-me'))
                .rejects.toThrow(ForbiddenException);
        });

        it('LAST_OWNER_GUARD: единственный OWNER не может покинуть команду', async () => {
            prisma.membership.findFirst.mockResolvedValue({ ...MY_MBR, userId: OWNER_ID, role: 'OWNER' });
            prisma.membership.count.mockResolvedValue(0);

            await expect(service.leaveTeam(OWNER_ID, TENANT_ID, 'mbr-me'))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'LAST_OWNER_GUARD' }) });
        });

        it('OWNER с другим OWNER может покинуть команду', async () => {
            prisma.membership.findFirst.mockResolvedValue({ ...MY_MBR, userId: OWNER_ID, role: 'OWNER' });
            prisma.membership.count.mockResolvedValue(1); // there is another owner

            const result = await service.leaveTeam(OWNER_ID, TENANT_ID, 'mbr-me');
            expect(result.status).toBe('LEFT');
        });

        it('MEMBERSHIP_NOT_FOUND если membership не найдена', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.leaveTeam(MANAGER_ID, TENANT_ID, 'mbr-ghost'))
                .rejects.toThrow(NotFoundException);
        });

        it('записывает TeamEvent membership_left', async () => {
            await service.leaveTeam(MANAGER_ID, TENANT_ID, 'mbr-me');
            expect(prisma.teamEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ eventType: 'membership_left' }) }),
            );
        });
    });

    // ─── Tenant state guards на write-actions ─────────────────────────────────

    describe('tenant state guards: write-actions заблокированы (через TenantWriteGuard)', () => {
        it('acceptInvitation: TRIAL_EXPIRED → TEAM_WRITE_BLOCKED_BY_TENANT_STATE', async () => {
            prisma.invitation.findUnique.mockResolvedValue({
                ...PENDING_INV,
                tenant: { accessState: 'TRIAL_EXPIRED' },
            });
            await expect(service.acceptInvitation('raw-token', VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TEAM_WRITE_BLOCKED_BY_TENANT_STATE' }) });
        });

        it('acceptInvitation: CLOSED → TEAM_WRITE_BLOCKED_BY_TENANT_STATE', async () => {
            prisma.invitation.findUnique.mockResolvedValue({
                ...PENDING_INV,
                tenant: { accessState: 'CLOSED' },
            });
            await expect(service.acceptInvitation('raw-token', VERIFIED_USER.id))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TEAM_WRITE_BLOCKED_BY_TENANT_STATE' }) });
        });
    });

    // ─── Data isolation: cross-tenant ─────────────────────────────────────────

    describe('data isolation: cross-tenant защита', () => {
        it('нет membership → TENANT_ACCESS_DENIED для любого team action', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.listMembers('attacker', TENANT_ID)).rejects.toThrow(ForbiddenException);
            await expect(service.createInvitation('attacker', TENANT_ID, { email: 'x@x.com', role: 'STAFF' as any }))
                .rejects.toThrow(ForbiddenException);
        });
    });

    // ─── Observability: все TeamEvent эмитируются ─────────────────────────────

    describe('observability: TeamEvent покрывают все операции', () => {
        const captureEventTypes = () => {
            const types: string[] = [];
            prisma.teamEvent.create.mockImplementation((args: any) => {
                types.push(args.data.eventType);
                return Promise.resolve({});
            });
            return types;
        };

        it('team_invitation_created при создании инвайта', async () => {
            prisma.membership.findFirst.mockResolvedValue(MEMBERSHIP('OWNER'));
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: OWNER_ID, email: 'owner@example.com' })
                .mockResolvedValueOnce(null);
            prisma.invitation.create.mockResolvedValue({ ...PENDING_INV });
            const types = captureEventTypes();
            await service.createInvitation(OWNER_ID, TENANT_ID, { email: 'invitee@example.com', role: 'MANAGER' as any });
            expect(types).toContain('team_invitation_created');
        });

        it('team_invitation_accepted при успешном accept', async () => {
            prisma.invitation.findUnique.mockResolvedValue(PENDING_INV);
            prisma.user.findUnique.mockResolvedValue(VERIFIED_USER);
            prisma.membership.findFirst.mockResolvedValue(null);
            prisma.membership.create.mockResolvedValue({});
            prisma.invitation.update.mockResolvedValue({});
            const types = captureEventTypes();
            await service.acceptInvitation('raw-token', VERIFIED_USER.id);
            expect(types).toContain('team_invitation_accepted');
        });

        it('membership_role_changed при смене роли', async () => {
            prisma.membership.findFirst
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ id: 'mbr-t', userId: TARGET_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' });
            prisma.membership.update.mockResolvedValue({});
            const types = captureEventTypes();
            await service.changeRole(OWNER_ID, TENANT_ID, 'mbr-t', { role: 'STAFF' as any });
            expect(types).toContain('membership_role_changed');
        });

        it('membership_removed при удалении участника', async () => {
            prisma.membership.findFirst
                .mockResolvedValueOnce(MEMBERSHIP('OWNER'))
                .mockResolvedValueOnce({ id: 'mbr-t', userId: TARGET_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' });
            prisma.membership.update.mockResolvedValue({});
            const types = captureEventTypes();
            await service.removeMember(OWNER_ID, TENANT_ID, 'mbr-t');
            expect(types).toContain('membership_removed');
        });

        it('membership_left при самостоятельном выходе', async () => {
            prisma.membership.findFirst.mockResolvedValue({ id: 'mbr-me', userId: MANAGER_ID, tenantId: TENANT_ID, role: 'MANAGER', status: 'ACTIVE' });
            prisma.membership.update.mockResolvedValue({});
            const types = captureEventTypes();
            await service.leaveTeam(MANAGER_ID, TENANT_ID, 'mbr-me');
            expect(types).toContain('membership_left');
        });
    });
});
