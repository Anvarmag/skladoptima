import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessStatePolicy } from './access-state.policy';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ReferralAttributionService } from '../referrals/referral-attribution.service';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        tenant: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        membership: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
        },
        userPreference: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        tenantAccessStateEvent: {
            create: jest.fn(),
        },
        tenantClosureJob: {
            upsert: jest.fn(),
            update: jest.fn(),
        },
        $transaction: jest.fn().mockImplementation((arg: any) =>
            typeof arg === 'function' ? arg(mock) : Promise.all(arg),
        ),
    };
    return mock;
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const USER_ID   = 'user-1';

const ACTIVE_TENANT = {
    id: TENANT_ID,
    name: 'ООО Ромашка',
    inn: '7701234567',
    status: 'ACTIVE',
    accessState: 'TRIAL_ACTIVE',
    primaryOwnerUserId: USER_ID,
    closedAt: null,
    createdAt: new Date('2026-01-01'),
    settings: {
        taxSystem: 'USN_6',
        country: 'RU',
        currency: 'RUB',
        timezone: 'Europe/Moscow',
        legalName: null,
    },
    closureJob: null,
};

const CLOSED_TENANT = {
    ...ACTIVE_TENANT,
    status: 'CLOSED',
    accessState: 'CLOSED',
    closedAt: new Date('2026-04-01'),
    closureJob: { scheduledFor: new Date(Date.now() + 90 * 86400_000) },
};

const ACTIVE_MEMBERSHIP = {
    role: 'OWNER',
    tenant: ACTIVE_TENANT,
};

const CREATE_DTO = {
    name: 'ООО Ромашка',
    inn: '7701234567',
    taxSystem: 'USN_6' as const,
    country: 'RU',
    currency: 'RUB',
    timezone: 'Europe/Moscow',
    legalName: undefined,
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('TenantService', () => {
    let service: TenantService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();

        const module = await Test.createTestingModule({
            providers: [
                TenantService,
                AccessStatePolicy,
                { provide: PrismaService, useValue: prisma },
                {
                    provide: OnboardingService,
                    useValue: {
                        markStepDone: jest.fn().mockResolvedValue(undefined),
                        initTenantActivation: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    // TASK_REFERRALS_1: stub — fire-and-forget, не должен
                    // ронять tenant.create.
                    provide: ReferralAttributionService,
                    useValue: {
                        lockOnTenantCreation: jest.fn().mockResolvedValue({
                            locked: false, attributionId: null,
                            status: 'ATTRIBUTED', rejectionReason: null, skipped: true,
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get(TenantService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── createTenant ─────────────────────────────────────────────────────────

    describe('createTenant', () => {
        beforeEach(() => {
            prisma.tenant.findFirst.mockResolvedValue(null);
            prisma.tenant.create.mockResolvedValue(ACTIVE_TENANT);
            prisma.userPreference.upsert.mockResolvedValue({});
        });

        it('создаёт tenant и возвращает правильную форму ответа', async () => {
            const result = await service.createTenant(USER_ID, CREATE_DTO);

            expect(result.tenantId).toBe(TENANT_ID);
            expect(result.accessState).toBe('TRIAL_ACTIVE');
            expect(result.activeTenantSelected).toBe(true);
            expect(prisma.tenant.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ accessState: 'TRIAL_ACTIVE', primaryOwnerUserId: USER_ID }),
                }),
            );
        });

        it('обновляет lastUsedTenantId в preferences', async () => {
            await service.createTenant(USER_ID, CREATE_DTO);
            expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: { lastUsedTenantId: TENANT_ID },
                }),
            );
        });

        it('бросает TENANT_INN_ALREADY_EXISTS при дубликате ИНН среди ACTIVE tenant', async () => {
            prisma.tenant.findFirst.mockResolvedValue(ACTIVE_TENANT);
            await expect(service.createTenant(USER_ID, CREATE_DTO)).rejects.toThrow(ConflictException);
        });

        it('эмитирует audit event tenant_created', async () => {
            await service.createTenant(USER_ID, CREATE_DTO);
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"tenant_created"'),
            );
        });
    });

    // ─── listTenants ──────────────────────────────────────────────────────────

    describe('listTenants', () => {
        it('возвращает список компаний пользователя', async () => {
            prisma.membership.findMany.mockResolvedValue([
                { role: 'OWNER', tenant: ACTIVE_TENANT },
                { role: 'MEMBER', tenant: { ...ACTIVE_TENANT, id: 'tenant-2', name: 'ИП Иванов' } },
            ]);

            const result = await service.listTenants(USER_ID);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(TENANT_ID);
            expect(result[0].role).toBe('OWNER');
            expect(result[1].name).toBe('ИП Иванов');
        });

        it('возвращает пустой массив если нет компаний', async () => {
            prisma.membership.findMany.mockResolvedValue([]);
            const result = await service.listTenants(USER_ID);
            expect(result).toEqual([]);
        });
    });

    // ─── getCurrentTenant ─────────────────────────────────────────────────────

    describe('getCurrentTenant', () => {
        it('возвращает null если нет preferences', async () => {
            prisma.userPreference.findUnique.mockResolvedValue(null);
            const result = await service.getCurrentTenant(USER_ID);
            expect(result).toBeNull();
        });

        it('возвращает null если lastUsedTenantId не задан', async () => {
            prisma.userPreference.findUnique.mockResolvedValue({ lastUsedTenantId: null });
            const result = await service.getCurrentTenant(USER_ID);
            expect(result).toBeNull();
        });

        it('возвращает current tenant по lastUsedTenantId', async () => {
            prisma.userPreference.findUnique.mockResolvedValue({ lastUsedTenantId: TENANT_ID });
            prisma.membership.findFirst.mockResolvedValue(ACTIVE_MEMBERSHIP);

            const result = await service.getCurrentTenant(USER_ID);

            expect(result).not.toBeNull();
            expect(result!.id).toBe(TENANT_ID);
        });

        it('возвращает null если membership не найден', async () => {
            prisma.userPreference.findUnique.mockResolvedValue({ lastUsedTenantId: TENANT_ID });
            prisma.membership.findFirst.mockResolvedValue(null);

            const result = await service.getCurrentTenant(USER_ID);
            expect(result).toBeNull();
        });
    });

    // ─── getTenant ────────────────────────────────────────────────────────────

    describe('getTenant', () => {
        it('возвращает tenant при наличии membership', async () => {
            prisma.membership.findFirst.mockResolvedValue(ACTIVE_MEMBERSHIP);
            const result = await service.getTenant(USER_ID, TENANT_ID);
            expect(result.id).toBe(TENANT_ID);
            expect(result.inn).toBe('7701234567');
        });

        it('бросает TENANT_NOT_FOUND если нет membership', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.getTenant(USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
        });
    });

    // ─── switchTenant ─────────────────────────────────────────────────────────

    describe('switchTenant', () => {
        it('переключает активный tenant и эмитирует audit event', async () => {
            prisma.membership.findFirst.mockResolvedValue({
                tenant: { status: 'ACTIVE', accessState: 'TRIAL_ACTIVE' },
            });
            prisma.userPreference.upsert.mockResolvedValue({});

            const result = await service.switchTenant(USER_ID, TENANT_ID);

            expect(result.tenantId).toBe(TENANT_ID);
            expect(result.activeTenant).toBe(true);
            expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ update: { lastUsedTenantId: TENANT_ID } }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"tenant_selected_as_active"'),
            );
        });

        it('бросает TENANT_ACCESS_DENIED если нет membership', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.switchTenant(USER_ID, TENANT_ID)).rejects.toThrow(ForbiddenException);
        });

        it('бросает TENANT_CLOSED при status=CLOSED', async () => {
            prisma.membership.findFirst.mockResolvedValue({
                tenant: { status: 'CLOSED', accessState: 'CLOSED' },
            });
            await expect(service.switchTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_CLOSED' }),
            });
        });

        it('бросает TENANT_CLOSED при accessState=CLOSED (status ещё не обновлён)', async () => {
            prisma.membership.findFirst.mockResolvedValue({
                tenant: { status: 'ACTIVE', accessState: 'CLOSED' },
            });
            await expect(service.switchTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_CLOSED' }),
            });
        });
    });

    // ─── getAccessWarnings ────────────────────────────────────────────────────

    describe('getAccessWarnings', () => {
        const mockMembership = (state: string) =>
            prisma.membership.findFirst.mockResolvedValue({ tenant: { accessState: state } });

        it('TRIAL_EXPIRED: возвращает предупреждение с severity=error', async () => {
            mockMembership('TRIAL_EXPIRED');
            const result = await service.getAccessWarnings(USER_ID, TENANT_ID);
            expect(result.isWriteAllowed).toBe(false);
            expect(result.warnings[0].severity).toBe('error');
            expect(result.warnings[0].code).toBe('TRIAL_EXPIRED');
        });

        it('GRACE_PERIOD: возвращает предупреждение с severity=warning', async () => {
            mockMembership('GRACE_PERIOD');
            const result = await service.getAccessWarnings(USER_ID, TENANT_ID);
            expect(result.isWriteAllowed).toBe(true);
            expect(result.warnings[0].severity).toBe('warning');
        });

        it('SUSPENDED: возвращает предупреждение с severity=error, write заблокирован', async () => {
            mockMembership('SUSPENDED');
            const result = await service.getAccessWarnings(USER_ID, TENANT_ID);
            expect(result.isWriteAllowed).toBe(false);
            expect(result.warnings[0].code).toBe('SUSPENDED');
        });

        it('ACTIVE_PAID: нет предупреждений, write разрешён', async () => {
            mockMembership('ACTIVE_PAID');
            const result = await service.getAccessWarnings(USER_ID, TENANT_ID);
            expect(result.isWriteAllowed).toBe(true);
            expect(result.warnings).toHaveLength(0);
        });

        it('бросает TENANT_NOT_FOUND если нет membership', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.getAccessWarnings(USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
        });
    });

    // ─── transitionAccessState ────────────────────────────────────────────────

    describe('transitionAccessState', () => {
        const BASE_DTO = {
            toState: 'TRIAL_EXPIRED' as any,
            reasonCode: 'BILLING_TRIAL_END',
            actorType: 'SYSTEM' as any,
        };

        it('разрешённый переход TRIAL_ACTIVE → TRIAL_EXPIRED выполняется успешно', async () => {
            prisma.tenant.findUnique.mockResolvedValue({
                id: TENANT_ID,
                accessState: 'TRIAL_ACTIVE',
                status: 'ACTIVE',
            });
            prisma.tenant.update.mockResolvedValue({ ...ACTIVE_TENANT, accessState: 'TRIAL_EXPIRED' });
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});

            const result = await service.transitionAccessState(TENANT_ID, BASE_DTO);

            expect(result.previousState).toBe('TRIAL_ACTIVE');
            expect(result.currentState).toBe('TRIAL_EXPIRED');
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"tenant_access_state_changed"'),
            );
        });

        it('запрещённый переход бросает BadRequestException', async () => {
            prisma.tenant.findUnique.mockResolvedValue({
                id: TENANT_ID,
                accessState: 'TRIAL_EXPIRED',
                status: 'ACTIVE',
            });

            await expect(
                service.transitionAccessState(TENANT_ID, { ...BASE_DTO, toState: 'TRIAL_ACTIVE' as any }),
            ).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED' }),
            });
        });

        it('переход в CLOSED обновляет status и closedAt', async () => {
            prisma.tenant.findUnique.mockResolvedValue({
                id: TENANT_ID,
                accessState: 'SUSPENDED',
                status: 'ACTIVE',
            });
            prisma.tenant.update.mockResolvedValue({ ...ACTIVE_TENANT, status: 'CLOSED', accessState: 'CLOSED' });
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});

            await service.transitionAccessState(TENANT_ID, { ...BASE_DTO, toState: 'CLOSED' as any, reasonCode: 'SUPPORT_CLOSE' });

            expect(prisma.tenant.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }),
                }),
            );
        });

        it('бросает TENANT_NOT_FOUND если tenant не существует', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(service.transitionAccessState(TENANT_ID, BASE_DTO)).rejects.toThrow(NotFoundException);
        });
    });

    // ─── closeTenant ──────────────────────────────────────────────────────────

    describe('closeTenant', () => {
        beforeEach(() => {
            prisma.tenant.findUnique.mockResolvedValue(ACTIVE_TENANT);
            prisma.tenant.update.mockResolvedValue({});
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});
            prisma.tenantClosureJob.upsert.mockResolvedValue({});
        });

        it('закрывает tenant и создаёт closure job', async () => {
            const result = await service.closeTenant(USER_ID, TENANT_ID);

            expect(result.status).toBe('CLOSED');
            expect(result.retentionUntil).toBeInstanceOf(Date);
            expect(prisma.tenantClosureJob.upsert).toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"tenant_closed"'),
            );
        });

        it('планирует retention через 90 дней', async () => {
            const before = new Date();
            const result = await service.closeTenant(USER_ID, TENANT_ID);
            const expected = new Date(before.getTime() + 90 * 86400_000);

            expect(result.retentionUntil.getTime()).toBeGreaterThanOrEqual(expected.getTime() - 1000);
        });

        it('бросает TENANT_NOT_FOUND если tenant не существует', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(service.closeTenant(USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
        });

        it('бросает TENANT_ALREADY_CLOSED при повторном закрытии', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ ...ACTIVE_TENANT, status: 'CLOSED' });
            await expect(service.closeTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_ALREADY_CLOSED' }),
            });
        });

        it('бросает TENANT_CLOSE_OWNER_ONLY если не владелец', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ ...ACTIVE_TENANT, primaryOwnerUserId: 'other-user' });
            await expect(service.closeTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_CLOSE_OWNER_ONLY' }),
            });
        });
    });

    // ─── restoreTenant ────────────────────────────────────────────────────────

    describe('restoreTenant', () => {
        const RESTORABLE_TENANT = {
            ...CLOSED_TENANT,
            closureJob: { scheduledFor: new Date(Date.now() + 30 * 86400_000), status: 'PENDING' },
        };

        beforeEach(() => {
            prisma.tenant.findUnique.mockResolvedValue(RESTORABLE_TENANT);
            prisma.tenant.update.mockResolvedValue({});
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});
            prisma.tenantClosureJob.update.mockResolvedValue({});
        });

        it('восстанавливает закрытый tenant в SUSPENDED и эмитирует audit', async () => {
            const result = await service.restoreTenant(USER_ID, TENANT_ID);

            expect(result.status).toBe('ACTIVE');
            expect(result.accessState).toBe('SUSPENDED');
            expect(prisma.tenantClosureJob.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'ARCHIVED' }) }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"tenant_restored"'),
            );
        });

        it('бросает TENANT_NOT_CLOSED если tenant не закрыт', async () => {
            prisma.tenant.findUnique.mockResolvedValue(ACTIVE_TENANT);
            await expect(service.restoreTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_NOT_CLOSED' }),
            });
        });

        it('бросает TENANT_RETENTION_WINDOW_EXPIRED если retention истёк', async () => {
            prisma.tenant.findUnique.mockResolvedValue({
                ...CLOSED_TENANT,
                closureJob: { scheduledFor: new Date(Date.now() - 1000), status: 'PENDING' },
            });
            await expect(service.restoreTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_RETENTION_WINDOW_EXPIRED' }),
            });
        });

        it('бросает TENANT_RETENTION_WINDOW_EXPIRED если нет closure job', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ ...CLOSED_TENANT, closureJob: null });
            await expect(service.restoreTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_RETENTION_WINDOW_EXPIRED' }),
            });
        });

        it('бросает TENANT_RESTORE_OWNER_ONLY если не владелец', async () => {
            prisma.tenant.findUnique.mockResolvedValue({
                ...RESTORABLE_TENANT,
                primaryOwnerUserId: 'other-user',
            });
            await expect(service.restoreTenant(USER_ID, TENANT_ID)).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'TENANT_RESTORE_OWNER_ONLY' }),
            });
        });

        it('бросает TENANT_NOT_FOUND если tenant не существует', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(service.restoreTenant(USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
        });
    });

    // ─── Isolation: cross-tenant access ──────────────────────────────────────

    describe('data isolation: getTenant и switchTenant блокируют чужой tenant', () => {
        it('getTenant: нет membership → NotFoundException (cross-tenant isolation)', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.getTenant('attacker-user', TENANT_ID)).rejects.toThrow(NotFoundException);
        });

        it('switchTenant: нет membership → ForbiddenException (cross-tenant isolation)', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.switchTenant('attacker-user', TENANT_ID)).rejects.toThrow(ForbiddenException);
        });

        it('getAccessWarnings: нет membership → NotFoundException (cross-tenant isolation)', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(service.getAccessWarnings('attacker-user', TENANT_ID)).rejects.toThrow(NotFoundException);
        });
    });

    // ─── Observability: audit event coverage ─────────────────────────────────

    describe('observability: все критические события логируются', () => {
        const captureEvents = () => {
            const events: string[] = [];
            logSpy.mockImplementation((msg: string) => {
                try { events.push(JSON.parse(msg).event); } catch { /* not JSON */ }
            });
            return events;
        };

        it('tenant_created при создании компании', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            prisma.tenant.create.mockResolvedValue(ACTIVE_TENANT);
            prisma.userPreference.upsert.mockResolvedValue({});
            const events = captureEvents();
            await service.createTenant(USER_ID, CREATE_DTO);
            expect(events).toContain('tenant_created');
        });

        it('tenant_selected_as_active при switchTenant', async () => {
            prisma.membership.findFirst.mockResolvedValue({ tenant: { status: 'ACTIVE', accessState: 'ACTIVE_PAID' } });
            prisma.userPreference.upsert.mockResolvedValue({});
            const events = captureEvents();
            await service.switchTenant(USER_ID, TENANT_ID);
            expect(events).toContain('tenant_selected_as_active');
        });

        it('tenant_closed при закрытии компании', async () => {
            prisma.tenant.findUnique.mockResolvedValue(ACTIVE_TENANT);
            prisma.tenant.update.mockResolvedValue({});
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});
            prisma.tenantClosureJob.upsert.mockResolvedValue({});
            const events = captureEvents();
            await service.closeTenant(USER_ID, TENANT_ID);
            expect(events).toContain('tenant_closed');
        });

        it('tenant_restored при восстановлении компании', async () => {
            const tenant = {
                ...CLOSED_TENANT,
                closureJob: { scheduledFor: new Date(Date.now() + 30 * 86400_000), status: 'PENDING' },
            };
            prisma.tenant.findUnique.mockResolvedValue(tenant);
            prisma.tenant.update.mockResolvedValue({});
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});
            prisma.tenantClosureJob.update.mockResolvedValue({});
            const events = captureEvents();
            await service.restoreTenant(USER_ID, TENANT_ID);
            expect(events).toContain('tenant_restored');
        });

        it('tenant_access_state_changed при переходе состояния', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, accessState: 'TRIAL_ACTIVE', status: 'ACTIVE' });
            prisma.tenant.update.mockResolvedValue({ ...ACTIVE_TENANT, accessState: 'TRIAL_EXPIRED' });
            prisma.tenantAccessStateEvent.create.mockResolvedValue({});
            const events = captureEvents();
            await service.transitionAccessState(TENANT_ID, {
                toState: 'TRIAL_EXPIRED' as any,
                reasonCode: 'BILLING_TRIAL_END',
                actorType: 'SYSTEM' as any,
            });
            expect(events).toContain('tenant_access_state_changed');
        });
    });
});
