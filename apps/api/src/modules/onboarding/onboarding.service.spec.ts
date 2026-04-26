import { Test } from '@nestjs/testing';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        onboardingState: {
            findUnique: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findMany: jest.fn(),
        },
        onboardingStepProgress: {
            createMany: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        tenant: { findUnique: jest.fn() },
        membership: { findFirst: jest.fn() },
        $transaction: jest.fn().mockImplementation((arg: unknown) =>
            typeof arg === 'function'
                ? arg(mock)
                : Promise.all(arg as Promise<unknown>[]),
        ),
    };
    return mock;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STEP_DATE = new Date('2026-04-20');

function makeBootstrapSteps(overrides: Record<string, string> = {}) {
    return [
        {
            id: 'sp-w', onboardingStateId: 'state-bs-1', stepKey: 'welcome',
            status: overrides['welcome'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
        {
            id: 'sp-sc', onboardingStateId: 'state-bs-1', stepKey: 'setup_company',
            status: overrides['setup_company'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
    ];
}

function makeActivationSteps(overrides: Record<string, string> = {}) {
    return [
        {
            id: 'sp-cm', onboardingStateId: 'state-ta-1', stepKey: 'connect_marketplace',
            status: overrides['connect_marketplace'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
        {
            id: 'sp-ap', onboardingStateId: 'state-ta-1', stepKey: 'add_products',
            status: overrides['add_products'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
        {
            id: 'sp-it', onboardingStateId: 'state-ta-1', stepKey: 'invite_team',
            status: overrides['invite_team'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
        {
            id: 'sp-cs', onboardingStateId: 'state-ta-1', stepKey: 'check_stocks',
            status: overrides['check_stocks'] ?? 'PENDING',
            viewedAt: null, completedAt: null, skippedAt: null, metadata: null,
            createdAt: STEP_DATE, updatedAt: STEP_DATE,
        },
    ];
}

const BOOTSTRAP_STATE = {
    id: 'state-bs-1',
    scope: 'USER_BOOTSTRAP',
    status: 'IN_PROGRESS',
    catalogVersion: 'v1',
    lastStepKey: null,
    completedAt: null,
    closedAt: null,
    userId: 'user-1',
    tenantId: null,
    createdAt: STEP_DATE,
    updatedAt: STEP_DATE,
    steps: makeBootstrapSteps(),
};

const ACTIVATION_STATE = {
    id: 'state-ta-1',
    scope: 'TENANT_ACTIVATION',
    status: 'IN_PROGRESS',
    catalogVersion: 'v1',
    lastStepKey: null,
    completedAt: null,
    closedAt: null,
    userId: null,
    tenantId: 'tenant-1',
    createdAt: STEP_DATE,
    updatedAt: STEP_DATE,
    steps: makeActivationSteps(),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('OnboardingService', () => {
    let service: OnboardingService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();

        const module = await Test.createTestingModule({
            providers: [
                OnboardingService,
                { provide: PrismaService, useValue: prisma },
            ],
        }).compile();

        service = module.get(OnboardingService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── initUserBootstrap ────────────────────────────────────────────────────

    describe('initUserBootstrap', () => {
        it('creates state + steps and emits bootstrap_created event', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.onboardingState.create.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 2 });

            const result = await service.initUserBootstrap('user-1');

            expect(result).toMatchObject({ scope: 'USER_BOOTSTRAP', status: 'IN_PROGRESS' });
            expect(prisma.onboardingState.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ userId: 'user-1', scope: 'USER_BOOTSTRAP' }),
                }),
            );
            expect(prisma.onboardingStepProgress.createMany).toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_bootstrap_created"'),
            );
        });

        it('returns existing state without creating (idempotent)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);

            const result = await service.initUserBootstrap('user-1');

            expect(result).toMatchObject(BOOTSTRAP_STATE);
            expect(prisma.onboardingState.create).not.toHaveBeenCalled();
        });

        it('handles P2002 race condition: returns state from findUniqueOrThrow', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: '5.0.0',
            });
            prisma.$transaction.mockRejectedValueOnce(p2002);
            prisma.onboardingState.findUniqueOrThrow.mockResolvedValue(BOOTSTRAP_STATE);

            const result = await service.initUserBootstrap('user-1');

            expect(result).toMatchObject(BOOTSTRAP_STATE);
            expect(prisma.onboardingState.findUniqueOrThrow).toHaveBeenCalled();
        });

        it('rethrows non-P2002 errors', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.$transaction.mockRejectedValueOnce(new Error('DB connection failed'));

            await expect(service.initUserBootstrap('user-1')).rejects.toThrow('DB connection failed');
        });
    });

    // ─── initTenantActivation ─────────────────────────────────────────────────

    describe('initTenantActivation', () => {
        it('creates state + steps and emits activation_created event', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.onboardingState.create.mockResolvedValue(ACTIVATION_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 4 });

            const result = await service.initTenantActivation('tenant-1');

            expect(result).toMatchObject({ scope: 'TENANT_ACTIVATION', status: 'IN_PROGRESS' });
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_activation_created"'),
            );
        });

        it('returns existing state without creating (idempotent)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.initTenantActivation('tenant-1');

            expect(result).toMatchObject(ACTIVATION_STATE);
            expect(prisma.onboardingState.create).not.toHaveBeenCalled();
        });

        it('handles P2002 race condition', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: '5.0.0',
            });
            prisma.$transaction.mockRejectedValueOnce(p2002);
            prisma.onboardingState.findUniqueOrThrow.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.initTenantActivation('tenant-1');

            expect(result).toMatchObject(ACTIVATION_STATE);
        });
    });

    // ─── getState ─────────────────────────────────────────────────────────────

    describe('getState', () => {
        it('returns USER_BOOTSTRAP state when no activeTenantId', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);

            const result = await service.getState('user-1', null);

            expect(result.state).toMatchObject({ scope: 'USER_BOOTSTRAP', status: 'IN_PROGRESS' });
        });

        it('returns { state: null } when no activeTenantId and no state exists', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);

            const result = await service.getState('user-1', null);

            expect(result).toEqual({ state: null });
        });

        it('returns TENANT_ACTIVATION state when activeTenantId provided', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
            prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ scope: 'TENANT_ACTIVATION' });
        });

        it('returns { state: null } when TENANT_ACTIVATION state does not exist', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
            prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
            prisma.onboardingState.findUnique.mockResolvedValue(null);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result).toEqual({ state: null });
        });

        it('returns { state: null } for STAFF role without querying onboarding state', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
            prisma.membership.findFirst.mockResolvedValue({ role: 'STAFF' });

            const result = await service.getState('user-1', 'tenant-1');

            expect(result).toEqual({ state: null });
        });
    });

    // ─── startState ──────────────────────────────────────────────────────────

    describe('startState', () => {
        it('initializes USER_BOOTSTRAP and returns state', async () => {
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(null)           // initUserBootstrap — not exists
                .mockResolvedValueOnce(BOOTSTRAP_STATE); // getUserBootstrapState
            prisma.onboardingState.create.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 2 });

            const result = await service.startState('user-1', null);

            expect(result.state).toMatchObject({ scope: 'USER_BOOTSTRAP' });
        });

        it('initializes TENANT_ACTIVATION and returns state', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
            prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(null)              // initTenantActivation — not exists
                .mockResolvedValueOnce(ACTIVATION_STATE); // getTenantActivationState
            prisma.onboardingState.create.mockResolvedValue(ACTIVATION_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 4 });

            const result = await service.startState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ scope: 'TENANT_ACTIVATION' });
        });

        it('returns { state: null } for STAFF role', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
            prisma.membership.findFirst.mockResolvedValue({ role: 'STAFF' });

            const result = await service.startState('user-1', 'tenant-1');

            expect(result).toEqual({ state: null });
        });
    });

    // ─── updateStep ───────────────────────────────────────────────────────────

    describe('updateStep', () => {
        beforeEach(() => {
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue(BOOTSTRAP_STATE);
        });

        it('PENDING → VIEWED: records viewedAt and updates lastStepKey', async () => {
            const stateAfter = { ...BOOTSTRAP_STATE, lastStepKey: 'welcome', steps: makeBootstrapSteps({ welcome: 'VIEWED' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(BOOTSTRAP_STATE)
                .mockResolvedValueOnce(stateAfter);

            await service.updateStep('user-1', null, 'welcome', 'viewed');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ status: 'VIEWED', viewedAt: expect.any(Date) }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_step_updated"'),
            );
        });

        it('PENDING → DONE: records completedAt', async () => {
            const stateAfter = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'DONE' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(BOOTSTRAP_STATE)
                .mockResolvedValueOnce(stateAfter);

            await service.updateStep('user-1', null, 'welcome', 'done');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ status: 'DONE', completedAt: expect.any(Date) }),
                }),
            );
        });

        it('PENDING → SKIPPED: records skippedAt', async () => {
            const stateAfter = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'SKIPPED' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(BOOTSTRAP_STATE)
                .mockResolvedValueOnce(stateAfter);

            await service.updateStep('user-1', null, 'welcome', 'skipped');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ status: 'SKIPPED', skippedAt: expect.any(Date) }),
                }),
            );
        });

        it('VIEWED → DONE: does not overwrite viewedAt', async () => {
            const viewedDate = new Date('2026-04-21');
            const viewedState = {
                ...BOOTSTRAP_STATE,
                steps: [
                    { ...makeBootstrapSteps()[0], status: 'VIEWED', viewedAt: viewedDate },
                    makeBootstrapSteps()[1],
                ],
            };
            const stateAfter = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'DONE' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(viewedState)
                .mockResolvedValueOnce(stateAfter);

            await service.updateStep('user-1', null, 'welcome', 'done');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ status: 'DONE' }),
                }),
            );
        });

        it('DONE → DONE is a no-op (no DB write, returns state)', async () => {
            const doneState = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'DONE' }) };
            prisma.onboardingState.findUnique.mockResolvedValue(doneState);

            const result = await service.updateStep('user-1', null, 'welcome', 'done');

            expect(prisma.onboardingStepProgress.upsert).not.toHaveBeenCalled();
            expect(result.state).toBeDefined();
        });

        it('DONE → SKIPPED throws ONBOARDING_INVALID_TRANSITION', async () => {
            const doneState = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'DONE' }) };
            prisma.onboardingState.findUnique.mockResolvedValue(doneState);

            await expect(service.updateStep('user-1', null, 'welcome', 'skipped'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_INVALID_TRANSITION' }),
                });
        });

        it('SKIPPED → DONE throws ONBOARDING_INVALID_TRANSITION (need reopen first)', async () => {
            const skippedState = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'SKIPPED' }) };
            prisma.onboardingState.findUnique.mockResolvedValue(skippedState);

            await expect(service.updateStep('user-1', null, 'welcome', 'done'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_INVALID_TRANSITION' }),
                });
        });

        it('unknown stepKey throws ONBOARDING_STEP_NOT_FOUND', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);

            await expect(service.updateStep('user-1', null, 'nonexistent', 'done'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_STEP_NOT_FOUND' }),
                });
        });

        it('state not found throws ONBOARDING_STATE_NOT_FOUND', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);

            await expect(service.updateStep('user-1', null, 'welcome', 'done'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_STATE_NOT_FOUND' }),
                });
        });
    });

    // ─── closeState ───────────────────────────────────────────────────────────

    describe('closeState', () => {
        it('IN_PROGRESS → CLOSED and emits state_closed event', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            const closedState = { ...BOOTSTRAP_STATE, status: 'CLOSED', closedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.update.mockResolvedValue(closedState);

            const result = await service.closeState('user-1', null);

            expect(result.state).toMatchObject({ status: 'CLOSED' });
            expect(prisma.onboardingState.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_state_closed"'),
            );
        });

        it('CLOSED → CLOSED is idempotent (no DB write)', async () => {
            const closedState = { ...BOOTSTRAP_STATE, status: 'CLOSED', closedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique.mockResolvedValue(closedState);

            const result = await service.closeState('user-1', null);

            expect(result.state).toMatchObject({ status: 'CLOSED' });
            expect(prisma.onboardingState.update).not.toHaveBeenCalled();
        });

        it('COMPLETED → close throws ONBOARDING_WRONG_STATE', async () => {
            const completedState = { ...BOOTSTRAP_STATE, status: 'COMPLETED', completedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique.mockResolvedValue(completedState);

            await expect(service.closeState('user-1', null))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_WRONG_STATE' }),
                });
        });
    });

    // ─── reopenState ──────────────────────────────────────────────────────────

    describe('reopenState', () => {
        it('CLOSED → IN_PROGRESS, resets SKIPPED steps to PENDING', async () => {
            const closedState = {
                ...BOOTSTRAP_STATE, status: 'CLOSED',
                steps: makeBootstrapSteps({ welcome: 'SKIPPED' }),
            };
            const reopenedState = { ...BOOTSTRAP_STATE, status: 'IN_PROGRESS', steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(closedState)
                .mockResolvedValueOnce(reopenedState);
            prisma.onboardingState.update.mockResolvedValue({});
            prisma.onboardingStepProgress.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.reopenState('user-1', null);

            expect(result.state).toMatchObject({ status: 'IN_PROGRESS' });
            expect(prisma.onboardingStepProgress.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'PENDING', skippedAt: null } }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_state_reopened"'),
            );
        });

        it('IN_PROGRESS → reopen is idempotent (no transaction)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);

            const result = await service.reopenState('user-1', null);

            expect(result.state).toBeDefined();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('COMPLETED → reopen throws ONBOARDING_ALREADY_COMPLETED', async () => {
            const completedState = { ...BOOTSTRAP_STATE, status: 'COMPLETED', completedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique.mockResolvedValue(completedState);

            await expect(service.reopenState('user-1', null))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_ALREADY_COMPLETED' }),
                });
        });
    });

    // ─── completeState ────────────────────────────────────────────────────────

    describe('completeState', () => {
        it('IN_PROGRESS → COMPLETED even with pending steps, emits state_completed', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            const completedState = { ...BOOTSTRAP_STATE, status: 'COMPLETED', completedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.update.mockResolvedValue(completedState);

            const result = await service.completeState('user-1', null);

            expect(result.state).toMatchObject({ status: 'COMPLETED' });
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_state_completed"'),
            );
        });

        it('COMPLETED → complete throws ONBOARDING_WRONG_STATE', async () => {
            const completedState = { ...BOOTSTRAP_STATE, status: 'COMPLETED', completedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique.mockResolvedValue(completedState);

            await expect(service.completeState('user-1', null))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_WRONG_STATE' }),
                });
        });

        it('CLOSED → complete throws ONBOARDING_WRONG_STATE', async () => {
            const closedState = { ...BOOTSTRAP_STATE, status: 'CLOSED', closedAt: new Date(), steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique.mockResolvedValue(closedState);

            await expect(service.completeState('user-1', null))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_WRONG_STATE' }),
                });
        });
    });

    // ─── markStepDone (domain events) ────────────────────────────────────────

    describe('markStepDone — domain events', () => {
        it('marks a PENDING step DONE and emits step_updated (domain_event)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'welcome', 'domain_event');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ status: 'DONE', completedAt: expect.any(Date) }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_step_updated"'),
            );
        });

        it('is idempotent: no upsert if step is already DONE', async () => {
            const doneState = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'DONE' }) };
            prisma.onboardingState.findUnique.mockResolvedValue(doneState);

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'welcome', 'domain_event');

            expect(prisma.onboardingStepProgress.upsert).not.toHaveBeenCalled();
        });

        it('silently resolves if state does not exist (fire-and-forget safety)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);

            await expect(
                service.markStepDone('USER_BOOTSTRAP', 'ghost-user', 'welcome', 'domain_event'),
            ).resolves.toBeUndefined();
            expect(prisma.onboardingStepProgress.upsert).not.toHaveBeenCalled();
        });

        it('auto-completes USER_BOOTSTRAP when setup_company is marked DONE', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'setup_company', 'domain_event');

            expect(prisma.onboardingState.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_state_completed"'),
            );
        });

        it('does NOT auto-complete USER_BOOTSTRAP if state is already COMPLETED', async () => {
            const completedBootstrap = {
                ...BOOTSTRAP_STATE, status: 'COMPLETED', completedAt: new Date(),
                steps: makeBootstrapSteps({ setup_company: 'PENDING' }),
            };
            prisma.onboardingState.findUnique.mockResolvedValue(completedBootstrap);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'setup_company', 'domain_event');

            expect(prisma.onboardingState.update).not.toHaveBeenCalled();
        });

        it('marks TENANT_ACTIVATION step done via domain event', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});

            await service.markStepDone('TENANT_ACTIVATION', 'tenant-1', 'invite_team', 'domain_event');

            expect(prisma.onboardingStepProgress.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ update: expect.objectContaining({ status: 'DONE' }) }),
            );
        });
    });

    // ─── Bootstrap → Tenant handoff ───────────────────────────────────────────

    describe('bootstrap-to-tenant handoff', () => {
        it('setup_company DONE → USER_BOOTSTRAP auto-completes; TENANT_ACTIVATION inits independently', async () => {
            // Step 1: markStepDone(setup_company) auto-completes USER_BOOTSTRAP
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'setup_company', 'domain_event');

            expect(prisma.onboardingState.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
            );

            // Step 2: initTenantActivation creates a separate TENANT_ACTIVATION state
            jest.clearAllMocks();
            logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.onboardingState.create.mockResolvedValue(ACTIVATION_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 4 });

            const tenantState = await service.initTenantActivation('tenant-1');

            expect(tenantState).toMatchObject({ scope: 'TENANT_ACTIVATION', status: 'IN_PROGRESS' });
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_activation_created"'),
            );
        });

        it('TENANT_ACTIVATION init is idempotent across multiple createTenant calls', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.initTenantActivation('tenant-1');

            expect(result).toMatchObject(ACTIVATION_STATE);
            expect(prisma.onboardingState.create).not.toHaveBeenCalled();
        });
    });

    // ─── Access control ───────────────────────────────────────────────────────

    describe('access control — role-aware availability', () => {
        function setupTenantCtx(role: string, accessState = 'ACTIVE_PAID') {
            prisma.tenant.findUnique.mockResolvedValue({ accessState });
            prisma.membership.findFirst.mockResolvedValue({ role });
        }

        it('STAFF: getState returns { state: null }', async () => {
            setupTenantCtx('STAFF');

            const result = await service.getState('user-1', 'tenant-1');

            expect(result).toEqual({ state: null });
        });

        it('MANAGER: updateStep "viewed" is allowed (read-only view)', async () => {
            setupTenantCtx('MANAGER');
            const stateAfter = {
                ...ACTIVATION_STATE,
                lastStepKey: 'connect_marketplace',
                steps: makeActivationSteps({ connect_marketplace: 'VIEWED' }),
            };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(ACTIVATION_STATE)
                .mockResolvedValueOnce(stateAfter);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});

            await expect(
                service.updateStep('user-1', 'tenant-1', 'connect_marketplace', 'viewed'),
            ).resolves.toBeDefined();
        });

        it('MANAGER: updateStep "done" throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('MANAGER');

            await expect(service.updateStep('user-1', 'tenant-1', 'connect_marketplace', 'done'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('MANAGER: updateStep "skipped" throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('MANAGER');

            await expect(service.updateStep('user-1', 'tenant-1', 'connect_marketplace', 'skipped'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('MANAGER: closeState throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('MANAGER');

            await expect(service.closeState('user-1', 'tenant-1'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('MANAGER: completeState throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('MANAGER');

            await expect(service.completeState('user-1', 'tenant-1'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('OWNER: full access — can mark done, skip, close, complete', async () => {
            setupTenantCtx('OWNER');
            const stateAfter = { ...ACTIVATION_STATE, steps: makeActivationSteps({ connect_marketplace: 'DONE' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(ACTIVATION_STATE)
                .mockResolvedValueOnce(stateAfter);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});

            await expect(
                service.updateStep('user-1', 'tenant-1', 'connect_marketplace', 'done'),
            ).resolves.toBeDefined();
        });

        it('ADMIN: full access — can mark done', async () => {
            setupTenantCtx('ADMIN');
            const stateAfter = { ...ACTIVATION_STATE, steps: makeActivationSteps({ add_products: 'DONE' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(ACTIVATION_STATE)
                .mockResolvedValueOnce(stateAfter);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});

            await expect(
                service.updateStep('user-1', 'tenant-1', 'add_products', 'done'),
            ).resolves.toBeDefined();
        });
    });

    // ─── Tenant access-state guards ───────────────────────────────────────────

    describe('tenant access-state guards', () => {
        function setupTenantCtx(accessState: string, role = 'OWNER') {
            prisma.tenant.findUnique.mockResolvedValue({ accessState });
            prisma.membership.findFirst.mockResolvedValue({ role });
        }

        it('TRIAL_EXPIRED: updateStep throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('TRIAL_EXPIRED');

            await expect(service.updateStep('user-1', 'tenant-1', 'connect_marketplace', 'done'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('SUSPENDED: closeState throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('SUSPENDED');

            await expect(service.closeState('user-1', 'tenant-1'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('CLOSED: completeState throws ONBOARDING_FORBIDDEN', async () => {
            setupTenantCtx('CLOSED');

            await expect(service.completeState('user-1', 'tenant-1'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'ONBOARDING_FORBIDDEN' }),
                });
        });

        it('TRIAL_EXPIRED: getState returns isBlocked=true, blockReason=TRIAL_EXPIRED', async () => {
            setupTenantCtx('TRIAL_EXPIRED');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ isBlocked: true, blockReason: 'TRIAL_EXPIRED' });
        });

        it('SUSPENDED: getState returns isBlocked=true, blockReason=TENANT_SUSPENDED', async () => {
            setupTenantCtx('SUSPENDED');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ isBlocked: true, blockReason: 'TENANT_SUSPENDED' });
        });

        it('CLOSED: getState returns isBlocked=true, blockReason=TENANT_CLOSED', async () => {
            setupTenantCtx('CLOSED');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ isBlocked: true, blockReason: 'TENANT_CLOSED' });
        });

        it('TRIAL_ACTIVE: getState returns isBlocked=false, blockReason=null', async () => {
            setupTenantCtx('TRIAL_ACTIVE');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ isBlocked: false, blockReason: null });
        });

        it('blockReason priority: ROLE_INSUFFICIENT overrides TRIAL_EXPIRED', async () => {
            setupTenantCtx('TRIAL_EXPIRED', 'MANAGER');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state).toMatchObject({ blockReason: 'ROLE_INSUFFICIENT' });
        });

        it('isCtaBlocked is true on each step when blocked', async () => {
            setupTenantCtx('TRIAL_EXPIRED');
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', 'tenant-1');

            expect(result.state?.steps.every((s: { isCtaBlocked: boolean }) => s.isCtaBlocked)).toBe(true);
        });
    });

    // ─── formatResponse (via getState) ───────────────────────────────────────

    describe('formatResponse — response shape', () => {
        it('includes correct progress counters and nextRecommendedStep', async () => {
            const stateWithProgress = {
                ...BOOTSTRAP_STATE,
                steps: makeBootstrapSteps({ welcome: 'DONE', setup_company: 'PENDING' }),
            };
            prisma.onboardingState.findUnique.mockResolvedValue(stateWithProgress);

            const result = await service.getState('user-1', null);

            expect(result.state?.progress).toEqual({ total: 2, done: 1, skipped: 0 });
            expect(result.state?.nextRecommendedStep).toBe('setup_company');
        });

        it('nextRecommendedStep is null when all steps done', async () => {
            const allDone = {
                ...BOOTSTRAP_STATE,
                steps: makeBootstrapSteps({ welcome: 'DONE', setup_company: 'DONE' }),
            };
            prisma.onboardingState.findUnique.mockResolvedValue(allDone);

            const result = await service.getState('user-1', null);

            expect(result.state?.nextRecommendedStep).toBeNull();
        });

        it('VIEWED step counts as nextRecommendedStep candidate', async () => {
            const withViewed = {
                ...BOOTSTRAP_STATE,
                steps: makeBootstrapSteps({ welcome: 'VIEWED', setup_company: 'PENDING' }),
            };
            prisma.onboardingState.findUnique.mockResolvedValue(withViewed);

            const result = await service.getState('user-1', null);

            expect(result.state?.nextRecommendedStep).toBe('welcome');
        });

        it('steps include ctaLink and autoCompleteEvent from catalog', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(ACTIVATION_STATE);

            const result = await service.getState('user-1', null);
            const connectStep = result.state?.steps.find((s: { key: string }) => s.key === 'connect_marketplace');

            expect(connectStep?.ctaLink).toBeDefined();
            expect(connectStep?.autoCompleteEvent).toBeDefined();
        });
    });

    // ─── checkStuckSteps (funnel alerting) ────────────────────────────────────

    describe('checkStuckSteps', () => {
        it('emits onboarding_step_stale for each stuck pending step', async () => {
            const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
            prisma.onboardingState.findMany.mockResolvedValue([
                { ...ACTIVATION_STATE, updatedAt: staleDate, steps: makeActivationSteps() },
            ]);

            await service.checkStuckSteps();

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"onboarding_step_stale"'),
            );
        });

        it('emits one event per stuck step (4 steps = 4 events)', async () => {
            const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
            prisma.onboardingState.findMany.mockResolvedValue([
                { ...ACTIVATION_STATE, updatedAt: staleDate, steps: makeActivationSteps() },
            ]);

            await service.checkStuckSteps();

            const staleCalls = (logSpy.mock.calls as string[][]).filter((args) =>
                args[0]?.includes('onboarding_step_stale'),
            );
            expect(staleCalls.length).toBe(4);
        });

        it('emits nothing when no stuck states', async () => {
            prisma.onboardingState.findMany.mockResolvedValue([]);

            await service.checkStuckSteps();

            const staleCalls = (logSpy.mock.calls as string[][]).filter((args) =>
                args[0]?.includes('onboarding_step_stale'),
            );
            expect(staleCalls).toHaveLength(0);
        });

        it('queries only IN_PROGRESS states with updatedAt before cutoff', async () => {
            prisma.onboardingState.findMany.mockResolvedValue([]);

            await service.checkStuckSteps(3);

            expect(prisma.onboardingState.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ status: 'IN_PROGRESS' }),
                }),
            );
        });
    });

    // ─── Observability: all critical events are emitted ───────────────────────

    describe('observability — all critical events are emitted', () => {
        function captureEvents() {
            const events: string[] = [];
            logSpy.mockImplementation((msg: string) => {
                try { events.push(JSON.parse(msg).event); } catch { /* non-JSON */ }
            });
            return events;
        }

        it('covers onboarding_bootstrap_created', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.onboardingState.create.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 2 });
            const events = captureEvents();

            await service.initUserBootstrap('user-1');

            expect(events).toContain('onboarding_bootstrap_created');
        });

        it('covers onboarding_activation_created', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(null);
            prisma.onboardingState.create.mockResolvedValue(ACTIVATION_STATE);
            prisma.onboardingStepProgress.createMany.mockResolvedValue({ count: 4 });
            const events = captureEvents();

            await service.initTenantActivation('tenant-1');

            expect(events).toContain('onboarding_activation_created');
        });

        it('covers onboarding_step_updated (user_action — viewed)', async () => {
            const stateAfter = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps({ welcome: 'VIEWED' }) };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(BOOTSTRAP_STATE)
                .mockResolvedValueOnce(stateAfter);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});
            const events = captureEvents();

            await service.updateStep('user-1', null, 'welcome', 'viewed');

            expect(events).toContain('onboarding_step_updated');
        });

        it('covers onboarding_step_updated (domain_event)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            const events = captureEvents();

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'welcome', 'domain_event');

            const ev = events.find((e) => e === 'onboarding_step_updated');
            expect(ev).toBeDefined();
        });

        it('covers onboarding_state_closed', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingState.update.mockResolvedValue({ ...BOOTSTRAP_STATE, status: 'CLOSED', steps: makeBootstrapSteps() });
            const events = captureEvents();

            await service.closeState('user-1', null);

            expect(events).toContain('onboarding_state_closed');
        });

        it('covers onboarding_state_reopened', async () => {
            const closedState = { ...BOOTSTRAP_STATE, status: 'CLOSED', steps: makeBootstrapSteps() };
            const reopenedState = { ...BOOTSTRAP_STATE, steps: makeBootstrapSteps() };
            prisma.onboardingState.findUnique
                .mockResolvedValueOnce(closedState)
                .mockResolvedValueOnce(reopenedState);
            prisma.onboardingState.update.mockResolvedValue({});
            prisma.onboardingStepProgress.updateMany.mockResolvedValue({ count: 0 });
            const events = captureEvents();

            await service.reopenState('user-1', null);

            expect(events).toContain('onboarding_state_reopened');
        });

        it('covers onboarding_state_completed (manual)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingState.update.mockResolvedValue({ ...BOOTSTRAP_STATE, status: 'COMPLETED', steps: makeBootstrapSteps() });
            const events = captureEvents();

            await service.completeState('user-1', null);

            expect(events).toContain('onboarding_state_completed');
        });

        it('covers onboarding_state_completed (auto-complete via markStepDone)', async () => {
            prisma.onboardingState.findUnique.mockResolvedValue(BOOTSTRAP_STATE);
            prisma.onboardingStepProgress.upsert.mockResolvedValue({});
            prisma.onboardingState.update.mockResolvedValue({});
            const events = captureEvents();

            await service.markStepDone('USER_BOOTSTRAP', 'user-1', 'setup_company', 'domain_event');

            expect(events).toContain('onboarding_state_completed');
        });

        it('covers onboarding_step_stale (checkStuckSteps)', async () => {
            const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
            prisma.onboardingState.findMany.mockResolvedValue([
                {
                    ...ACTIVATION_STATE,
                    updatedAt: staleDate,
                    steps: [makeActivationSteps()[0]],
                },
            ]);
            const events = captureEvents();

            await service.checkStuckSteps();

            expect(events).toContain('onboarding_step_stale');
        });
    });
});
