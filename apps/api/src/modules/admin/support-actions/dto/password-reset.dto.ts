import { IsString, MinLength, MaxLength } from 'class-validator';

/// Trigger password reset на стороне support — НЕ high-risk по аналитике §13,
/// но всё равно требует reason для аудит-trail (security guardrail §15).
/// Длина >= 10 для единообразия operator-input'а — иначе reason-поля
/// получают одно-двухсловный мусор.
export class TriggerPasswordResetDto {
    @IsString()
    @MinLength(10, { message: 'reason must be at least 10 characters' })
    @MaxLength(2000)
    reason: string;
}
