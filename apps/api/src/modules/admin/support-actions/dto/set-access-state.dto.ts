import { IsIn, IsString, MinLength, MaxLength } from 'class-validator';
import { AccessState } from '@prisma/client';

/// High-risk action — reason >= 10 символов (см. 19-admin §10).
///
/// `toState` сужен до whitelist'а support-allowed целевых состояний
/// (TASK_ADMIN_5 §15, §22): SUPPORT не имеет права переводить tenant в
/// `ACTIVE_PAID`/`GRACE_PERIOD`/`EARLY_ACCESS` — это и есть billing override,
/// прямо запрещённый product policy MVP. Whitelist дублирует
/// `SUPPORT_ALLOWED_TRANSITIONS` в `AccessStatePolicy` и срабатывает на DTO-стадии,
/// до доменного pre-check'а tenant'а — оператор получает ясный 400 ещё до того,
/// как support_actions/audit запишет blocked-event с server-side reason.
const SUPPORT_ALLOWED_TARGET_STATES = ['TRIAL_ACTIVE', 'SUSPENDED'] as const;
type SupportAllowedTargetState = (typeof SUPPORT_ALLOWED_TARGET_STATES)[number];

export class SetAccessStateDto {
    @IsIn(SUPPORT_ALLOWED_TARGET_STATES as readonly string[], {
        message: 'toState must be one of: TRIAL_ACTIVE, SUSPENDED (billing-override targets are forbidden for SUPPORT)',
    })
    toState: SupportAllowedTargetState & AccessState;

    @IsString()
    @MinLength(10, { message: 'reason must be at least 10 characters' })
    @MaxLength(2000)
    reason: string;
}
