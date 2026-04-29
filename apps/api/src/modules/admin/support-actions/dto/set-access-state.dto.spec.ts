/**
 * TASK_ADMIN_7: regression suite для DTO-whitelist'а высокорискового перехода
 * (см. §15, §22, TASK_ADMIN_5).
 *
 * Инвариант: SUPPORT никогда не должен иметь возможность отправить любой
 * AccessState в качестве `toState`. DTO ВЫСТУПАЕТ ПЕРВОЙ ЛИНИЕЙ ОБОРОНЫ —
 * раньше, чем policy в TenantService. Если этот whitelist расширят —
 * тест должен упасть и форсировать ревью.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    AccessState: {
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
        EARLY_ACCESS: 'EARLY_ACCESS',
    },
}));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetAccessStateDto } from './set-access-state.dto';
import { ExtendTrialDto } from './extend-trial.dto';
import { RestoreTenantDto } from './restore-tenant.dto';
import { TriggerPasswordResetDto } from './password-reset.dto';

const VALID_REASON = 'Operator confirmed via support ticket #12345';

describe('SetAccessStateDto', () => {
    it('пропускает SUSPENDED + валидный reason', async () => {
        const dto = plainToInstance(SetAccessStateDto, {
            toState: 'SUSPENDED',
            reason: VALID_REASON,
        });
        const errors = await validate(dto);
        expect(errors).toEqual([]);
    });

    it('пропускает TRIAL_ACTIVE', async () => {
        const dto = plainToInstance(SetAccessStateDto, {
            toState: 'TRIAL_ACTIVE',
            reason: VALID_REASON,
        });
        const errors = await validate(dto);
        expect(errors).toEqual([]);
    });

    // Каждое из этих состояний — billing override и должно быть отклонено
    // на DTO-стадии ещё до policy и до записи support_action.
    const FORBIDDEN_TARGETS = [
        'ACTIVE_PAID',
        'GRACE_PERIOD',
        'EARLY_ACCESS',
        'CLOSED',
        'TRIAL_EXPIRED',
    ];
    it.each(FORBIDDEN_TARGETS)('блокирует toState=%s как billing-override', async (target) => {
        const dto = plainToInstance(SetAccessStateDto, {
            toState: target,
            reason: VALID_REASON,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].constraints).toMatchObject({
            isIn: expect.stringContaining('TRIAL_ACTIVE, SUSPENDED'),
        });
    });

    it('reason < 10 символов — блокирован MinLength', async () => {
        const dto = plainToInstance(SetAccessStateDto, {
            toState: 'SUSPENDED',
            reason: 'short',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        const reasonErr = errors.find((e) => e.property === 'reason');
        expect(reasonErr?.constraints).toMatchObject({
            minLength: expect.stringContaining('10'),
        });
    });
});

describe('ExtendTrialDto / RestoreTenantDto / TriggerPasswordResetDto', () => {
    it.each([
        ['ExtendTrialDto', ExtendTrialDto],
        ['RestoreTenantDto', RestoreTenantDto],
        ['TriggerPasswordResetDto', TriggerPasswordResetDto],
    ] as const)('%s принимает reason ≥ 10', async (_name, ctor) => {
        const dto = plainToInstance(ctor as any, { reason: VALID_REASON } as any);
        const errors = await validate(dto);
        expect(errors).toEqual([]);
    });

    it.each([
        ['ExtendTrialDto', ExtendTrialDto],
        ['RestoreTenantDto', RestoreTenantDto],
        ['TriggerPasswordResetDto', TriggerPasswordResetDto],
    ] as const)('%s блокирует reason < 10 (REASON_REQUIRED-equivalent)', async (_name, ctor) => {
        const dto = plainToInstance(ctor as any, { reason: 'too short' } as any);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].constraints).toMatchObject({
            minLength: expect.stringContaining('10'),
        });
    });

    it.each([
        ['ExtendTrialDto', ExtendTrialDto],
        ['RestoreTenantDto', RestoreTenantDto],
        ['TriggerPasswordResetDto', TriggerPasswordResetDto],
    ] as const)('%s блокирует пустой reason', async (_name, ctor) => {
        const dto = plainToInstance(ctor as any, { reason: '' } as any);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
    });
});
