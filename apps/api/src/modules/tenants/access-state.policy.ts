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

// Дополнительные переходы, разрешённые только из support-контекста (см. 19-admin §13).
// extend-trial: TRIAL_EXPIRED → TRIAL_ACTIVE (повторная активация триала).
// restore-tenant: CLOSED → SUSPENDED (через TenantService.restoreTenant'у есть свой
// guard на retention window — мы не дублируем его в policy).
// SUPPORT не получает универсальный обход: набор переходов конечен и review-able.
//
// TASK_ADMIN_5: набор является ЕДИНСТВЕННЫМ источником правды для support-контекста.
// До TASK_ADMIN_5 `assertSupportTransitionAllowed` объединял стандартные ALLOWED_TRANSITIONS
// с этим списком — это позволяло SUPPORT_ADMIN выполнять переходы вроде SUSPENDED→ACTIVE_PAID
// или GRACE_PERIOD→ACTIVE_PAID, что фактически было billing override без фиксации в
// биллинговом контуре (запрещено §15 «SUPPORT_ADMIN не может выдавать hidden billing
// overrides» и §22 «special access / billing override не входят в MVP»).
const SUPPORT_ALLOWED_TRANSITIONS: Partial<Record<AccessState, AccessState[]>> = {
    TRIAL_EXPIRED: ['TRIAL_ACTIVE'],
    CLOSED:        ['SUSPENDED'],
};

// Целевые состояния, переход в которые ЯВЛЯЕТСЯ billing override и должен быть
// технически закрыт для support-контура (TASK_ADMIN_5 §15). Если support-actor
// пытается перевести tenant в одно из этих состояний — отвечаем отдельным
// error-кодом BILLING_OVERRIDE_NOT_ALLOWED, чтобы аудит-trail сразу отличал
// «попытка обхода биллинга» от «обычная неподдерживаемая транзиция».
const SUPPORT_BILLING_OVERRIDE_TARGETS: ReadonlySet<AccessState> = new Set([
    'ACTIVE_PAID',
    'GRACE_PERIOD',
    'EARLY_ACCESS',
]);

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

    /// Проверяет переход в support-контексте. Использует ИСКЛЮЧИТЕЛЬНО narrow-set
    /// SUPPORT_ALLOWED_TRANSITIONS — стандартные tenant-переходы намеренно НЕ
    /// объединяются с support-набором (см. TASK_ADMIN_5 §15: запрет hidden billing
    /// override). Используется только из SupportActionsService.
    ///
    /// Для попыток billing override (target ∈ {ACTIVE_PAID, GRACE_PERIOD, EARLY_ACCESS})
    /// возвращаем отдельный error-код, чтобы forensic-аудит мгновенно отличал такие
    /// попытки от обычной неподдерживаемой транзиции.
    assertSupportTransitionAllowed(from: AccessState, to: AccessState): void {
        if (SUPPORT_BILLING_OVERRIDE_TARGETS.has(to)) {
            throw new BadRequestException({
                code: 'BILLING_OVERRIDE_NOT_ALLOWED',
                from,
                to,
            });
        }
        const allowed = (SUPPORT_ALLOWED_TRANSITIONS[from] ?? []) as AccessState[];
        if (!allowed.includes(to)) {
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
