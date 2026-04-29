import { BadRequestException } from '@nestjs/common';
import { AccessState } from '@prisma/client';
import { AccessStatePolicy } from './access-state.policy';

/// TASK_ADMIN_5: фиксируем security инвариант — support-контекст НЕ имеет
/// права на billing override и любые «лишние» переходы вне явного narrow-set'а.
/// Эти тесты — регрессионная сетка, чтобы при будущем расширении
/// SUPPORT_ALLOWED_TRANSITIONS нельзя было случайно «протащить» переход в
/// ACTIVE_PAID/GRACE_PERIOD/EARLY_ACCESS под видом «обычной транзиции».
describe('AccessStatePolicy', () => {
    const policy = new AccessStatePolicy();

    describe('assertTransitionAllowed (tenant-context)', () => {
        it('разрешает стандартный переход TRIAL_ACTIVE → ACTIVE_PAID', () => {
            expect(() => policy.assertTransitionAllowed('TRIAL_ACTIVE', 'ACTIVE_PAID')).not.toThrow();
        });

        it('блокирует переход TRIAL_EXPIRED → TRIAL_ACTIVE в обычном контуре', () => {
            // Это и есть «extend-trial» — должно быть доступно ТОЛЬКО support'у.
            expect(() => policy.assertTransitionAllowed('TRIAL_EXPIRED', 'TRIAL_ACTIVE'))
                .toThrow(BadRequestException);
        });
    });

    describe('assertSupportTransitionAllowed', () => {
        it('разрешает TRIAL_EXPIRED → TRIAL_ACTIVE (extend-trial)', () => {
            expect(() => policy.assertSupportTransitionAllowed('TRIAL_EXPIRED', 'TRIAL_ACTIVE'))
                .not.toThrow();
        });

        it('разрешает CLOSED → SUSPENDED (restore-tenant)', () => {
            expect(() => policy.assertSupportTransitionAllowed('CLOSED', 'SUSPENDED'))
                .not.toThrow();
        });

        it('блокирует SUSPENDED → ACTIVE_PAID как BILLING_OVERRIDE_NOT_ALLOWED', () => {
            // Регрессия на старую реализацию assertSupportTransitionAllowed,
            // которая объединяла стандартные ALLOWED_TRANSITIONS с support-набором
            // и фактически давала SUPPORT_ADMIN произвольный billing override.
            expect(() => policy.assertSupportTransitionAllowed('SUSPENDED', 'ACTIVE_PAID'))
                .toMatchObject;
            try {
                policy.assertSupportTransitionAllowed('SUSPENDED', 'ACTIVE_PAID');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err).toBeInstanceOf(BadRequestException);
                expect(err.response).toMatchObject({ code: 'BILLING_OVERRIDE_NOT_ALLOWED' });
            }
        });

        it('блокирует TRIAL_ACTIVE → ACTIVE_PAID как BILLING_OVERRIDE_NOT_ALLOWED', () => {
            try {
                policy.assertSupportTransitionAllowed('TRIAL_ACTIVE', 'ACTIVE_PAID');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err.response).toMatchObject({ code: 'BILLING_OVERRIDE_NOT_ALLOWED' });
            }
        });

        it('блокирует GRACE_PERIOD → ACTIVE_PAID как BILLING_OVERRIDE_NOT_ALLOWED', () => {
            try {
                policy.assertSupportTransitionAllowed('GRACE_PERIOD', 'ACTIVE_PAID');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err.response).toMatchObject({ code: 'BILLING_OVERRIDE_NOT_ALLOWED' });
            }
        });

        it('блокирует CLOSED → ACTIVE_PAID как BILLING_OVERRIDE_NOT_ALLOWED', () => {
            try {
                policy.assertSupportTransitionAllowed('CLOSED', 'ACTIVE_PAID');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err.response).toMatchObject({ code: 'BILLING_OVERRIDE_NOT_ALLOWED' });
            }
        });

        it('блокирует переходы в GRACE_PERIOD и EARLY_ACCESS как billing override', () => {
            for (const target of ['GRACE_PERIOD', 'EARLY_ACCESS'] as AccessState[]) {
                try {
                    policy.assertSupportTransitionAllowed('SUSPENDED', target);
                    fail(`expected BadRequestException for SUSPENDED → ${target}`);
                } catch (err: any) {
                    expect(err.response).toMatchObject({ code: 'BILLING_OVERRIDE_NOT_ALLOWED' });
                }
            }
        });

        it('блокирует переход вне SUPPORT_ALLOWED_TRANSITIONS с TRANSITION_NOT_ALLOWED', () => {
            // CLOSED → TRIAL_ACTIVE: target не billing-override, но и не разрешён
            // для support — должна быть «обычная» ошибка не-billing.
            try {
                policy.assertSupportTransitionAllowed('CLOSED', 'TRIAL_ACTIVE');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err.response).toMatchObject({ code: 'TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED' });
            }
        });

        it('SUPPORT не может выполнять стандартный переход TRIAL_ACTIVE → SUSPENDED', () => {
            // ALLOWED_TRANSITIONS[TRIAL_ACTIVE] не содержит SUSPENDED, и SUPPORT_ALLOWED_TRANSITIONS
            // тоже не содержит — корректно блокируем без специального error-кода.
            try {
                policy.assertSupportTransitionAllowed('TRIAL_ACTIVE', 'SUSPENDED');
                fail('expected BadRequestException');
            } catch (err: any) {
                expect(err.response).toMatchObject({ code: 'TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED' });
            }
        });
    });

    describe('isWriteAllowed', () => {
        it('блокирует write для TRIAL_EXPIRED, SUSPENDED, CLOSED', () => {
            expect(policy.isWriteAllowed('TRIAL_EXPIRED')).toBe(false);
            expect(policy.isWriteAllowed('SUSPENDED')).toBe(false);
            expect(policy.isWriteAllowed('CLOSED')).toBe(false);
        });

        it('разрешает write для активных state', () => {
            expect(policy.isWriteAllowed('TRIAL_ACTIVE')).toBe(true);
            expect(policy.isWriteAllowed('ACTIVE_PAID')).toBe(true);
            expect(policy.isWriteAllowed('GRACE_PERIOD')).toBe(true);
            expect(policy.isWriteAllowed('EARLY_ACCESS')).toBe(true);
        });
    });
});
