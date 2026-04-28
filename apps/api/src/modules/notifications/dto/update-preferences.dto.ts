import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { NotificationChannel } from '@prisma/client';

/**
 * Каналы уведомлений (ключи совпадают с JSONB-ключами в notification_preferences).
 * Поле `in_app` — underscore, отражает хранимый ключ `in_app` в БД.
 *
 * Обязательное ограничение (§10): нельзя отключить все MVP-каналы одновременно —
 * проверяется в NotificationsPreferencesService.updatePreferences.
 */
export class ChannelPreferencesDto {
    @IsOptional() @IsBoolean() email?: boolean;
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    @IsOptional() @IsBoolean() in_app?: boolean;
    @IsOptional() @IsBoolean() telegram?: boolean;
    @IsOptional() @IsBoolean() max?: boolean;
}

/**
 * Категории уведомлений (ключи lowercase, совпадают с JSONB-ключами).
 * AUTH/BILLING/SYSTEM — mandatory: preference может выключить отображение,
 * но policy engine гарантирует доставку хотя бы в IN_APP.
 */
export class CategoryPreferencesDto {
    @IsOptional() @IsBoolean() auth?: boolean;
    @IsOptional() @IsBoolean() billing?: boolean;
    @IsOptional() @IsBoolean() sync?: boolean;
    @IsOptional() @IsBoolean() inventory?: boolean;
    @IsOptional() @IsBoolean() referral?: boolean;
    @IsOptional() @IsBoolean() system?: boolean;
}

export class UpdatePreferencesDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => ChannelPreferencesDto)
    channels?: ChannelPreferencesDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => CategoryPreferencesDto)
    categories?: CategoryPreferencesDto;

    @IsOptional()
    @IsEnum(NotificationChannel)
    primaryChannel?: NotificationChannel;
}
