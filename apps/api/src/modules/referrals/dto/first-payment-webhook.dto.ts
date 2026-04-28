import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Тело внутреннего webhook от billing-системы (TASK_REFERRALS_3).
 *
 * `eventId` — стабильный идентификатор billing-события для сквозной
 * трассировки (хранится в metadata BonusTransaction).
 *
 * Endpoint: POST /api/v1/referrals/webhook/first-payment
 * Auth: X-Internal-Secret header (см. INTERNAL_WEBHOOK_SECRET env)
 */
export class FirstPaymentWebhookDto {
    @IsUUID()
    referredTenantId: string;

    @IsString()
    @IsNotEmpty()
    planId: string;

    @IsNumber()
    @Min(0)
    amountPaid: number;

    @IsString()
    @IsOptional()
    currency?: string;

    @IsString()
    @IsNotEmpty()
    eventId: string;
}
