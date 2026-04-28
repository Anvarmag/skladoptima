import { ForbiddenException, Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_CHANNEL_PREFERENCES, DEFAULT_CATEGORY_PREFERENCES } from './notification.contract';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/** MVP-каналы, хранимые как lowercase JSON-ключи в notification_preferences.channels. */
const MVP_CHANNEL_KEYS = ['email', 'in_app'] as const;

@Injectable()
export class NotificationsPreferencesService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Вернуть текущие preferences tenant'а.
     * Если записи нет — вернуть defaults (isDefault: true).
     */
    async getPreferences(tenantId: string) {
        const prefs = await this.prisma.notificationPreferences.findUnique({
            where: { tenantId },
        });

        if (!prefs) {
            return {
                tenantId,
                channels: DEFAULT_CHANNEL_PREFERENCES,
                categories: DEFAULT_CATEGORY_PREFERENCES,
                primaryChannel: NotificationChannel.IN_APP,
                digestTime: null,
                timezone: null,
                updatedAt: null,
                isDefault: true,
            };
        }

        return { ...prefs, isDefault: false };
    }

    /**
     * Обновить preferences (partial merge).
     *
     * Validation rule (§10):
     *   После слияния хотя бы один MVP-канал (email или in_app) должен
     *   оставаться включённым. Иначе → FORBIDDEN: MANDATORY_NOTIFICATION_CHANNEL_REQUIRED.
     *   Причина: policy engine принудительно добавляет IN_APP для mandatory events, но
     *   явно запрещать настройку «все каналы выключены» — правильная UX-защита.
     */
    async updatePreferences(tenantId: string, dto: UpdatePreferencesDto) {
        const existing = await this.prisma.notificationPreferences.findUnique({
            where: { tenantId },
        });

        const currentChannels = this._parseJson<Record<string, boolean>>(
            existing?.channels,
            DEFAULT_CHANNEL_PREFERENCES,
        );
        const currentCategories = this._parseJson<Record<string, boolean>>(
            existing?.categories,
            DEFAULT_CATEGORY_PREFERENCES,
        );

        // Partial merge: undefined fields остаются из existing.
        const newChannels: Record<string, boolean> = {
            ...currentChannels,
            ...(dto.channels ? this._stripUndefined(dto.channels as Record<string, unknown>) : {}),
        };
        const newCategories: Record<string, boolean> = {
            ...currentCategories,
            ...(dto.categories ? this._stripUndefined(dto.categories as Record<string, unknown>) : {}),
        };

        // Mandatory protection: хотя бы один MVP-канал должен оставаться включённым.
        const anyMvpEnabled = MVP_CHANNEL_KEYS.some((ch) => newChannels[ch] === true);
        if (!anyMvpEnabled) {
            throw new ForbiddenException({ code: 'MANDATORY_NOTIFICATION_CHANNEL_REQUIRED' });
        }

        const updated = await this.prisma.notificationPreferences.upsert({
            where: { tenantId },
            create: {
                tenantId,
                channels: newChannels,
                categories: newCategories,
                primaryChannel: dto.primaryChannel ?? NotificationChannel.IN_APP,
            },
            update: {
                channels: newChannels,
                categories: newCategories,
                ...(dto.primaryChannel ? { primaryChannel: dto.primaryChannel } : {}),
            },
        });

        return { ...updated, updated: true };
    }

    private _parseJson<T extends object>(value: unknown, fallback: T): T {
        if (!value) return fallback;
        if (typeof value === 'object') return value as T;
        try {
            return JSON.parse(value as string) as T;
        } catch {
            return fallback;
        }
    }

    private _stripUndefined(obj: Record<string, unknown>): Record<string, boolean> {
        return Object.fromEntries(
            Object.entries(obj).filter(([, v]) => v !== undefined),
        ) as Record<string, boolean>;
    }
}
