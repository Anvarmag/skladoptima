import { Injectable, BadRequestException } from '@nestjs/common';
import { AccessState } from '@prisma/client';

const ALLOWED_TRANSITIONS: Partial<Record<AccessState, AccessState[]>> = {
    EARLY_ACCESS:  ['TRIAL_ACTIVE', 'CLOSED'],
    TRIAL_ACTIVE:  ['ACTIVE_PAID', 'TRIAL_EXPIRED', 'CLOSED'],
    TRIAL_EXPIRED: ['ACTIVE_PAID', 'SUSPENDED'],
    ACTIVE_PAID:   ['GRACE_PERIOD', 'SUSPENDED', 'CLOSED'],
    GRACE_PERIOD:  ['ACTIVE_PAID', 'SUSPENDED'],
    SUSPENDED:     ['ACTIVE_PAID', 'CLOSED'],
};

const WRITE_BLOCKED: Set<AccessState> = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

export interface AccessWarning {
    code: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
}

@Injectable()
export class AccessStatePolicy {
    assertTransitionAllowed(from: AccessState, to: AccessState): void {
        const allowed = ALLOWED_TRANSITIONS[from] ?? [];
        if (!(allowed as AccessState[]).includes(to)) {
            throw new BadRequestException({
                code: 'TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED',
                from,
                to,
            });
        }
    }

    isWriteAllowed(state: AccessState): boolean {
        return !WRITE_BLOCKED.has(state);
    }

    getWarnings(state: AccessState): AccessWarning[] {
        switch (state) {
            case 'TRIAL_EXPIRED':
                return [{
                    code: 'TRIAL_EXPIRED',
                    severity: 'error',
                    message: 'Пробный период истёк. Компания переведена в режим только для чтения. Оформите подписку для продолжения работы.',
                }];
            case 'GRACE_PERIOD':
                return [{
                    code: 'GRACE_PERIOD',
                    severity: 'warning',
                    message: 'Платёж просрочен. Действует льготный период доступа. Обновите подписку, чтобы избежать блокировки.',
                }];
            case 'SUSPENDED':
                return [{
                    code: 'SUSPENDED',
                    severity: 'error',
                    message: 'Доступ приостановлен. Обратитесь в службу поддержки или обновите подписку.',
                }];
            case 'CLOSED':
                return [{
                    code: 'CLOSED',
                    severity: 'error',
                    message: 'Компания закрыта. Обратитесь в службу поддержки.',
                }];
            default:
                return [];
        }
    }
}
