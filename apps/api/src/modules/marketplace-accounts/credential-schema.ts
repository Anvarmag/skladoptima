import { BadRequestException } from '@nestjs/common';
import { MarketplaceType } from '@prisma/client';

/**
 * Schemas обязательных полей credentials per marketplace.
 * §13 system-analytics:
 *   - WB: apiToken, optional statToken, warehouseId
 *   - Ozon: clientId, apiKey, warehouseId
 */
const SCHEMAS: Record<'WB' | 'OZON', { required: string[]; optional: string[] }> = {
    WB: {
        required: ['apiToken', 'warehouseId'],
        optional: ['statToken'],
    },
    OZON: {
        required: ['clientId', 'apiKey', 'warehouseId'],
        optional: [],
    },
};

const ALLOWED_KEYS_BY_MARKETPLACE: Record<'WB' | 'OZON', Set<string>> = {
    WB: new Set([...SCHEMAS.WB.required, ...SCHEMAS.WB.optional]),
    OZON: new Set([...SCHEMAS.OZON.required, ...SCHEMAS.OZON.optional]),
};

const MAX_VALUE_LEN = 1024;

/**
 * Валидирует payload credentials на CREATE: все required поля заполнены,
 * unknown ключи отсекаются, длина значений в пределах MAX_VALUE_LEN.
 *
 * Возвращает нормализованный payload (только allowed keys, trimmed string'и).
 */
export function validateCredentialsForCreate(
    marketplace: MarketplaceType,
    raw: Record<string, unknown>,
): Record<string, string> {
    if (marketplace === 'WB' || marketplace === 'OZON') {
        const schema = SCHEMAS[marketplace];
        const allowed = ALLOWED_KEYS_BY_MARKETPLACE[marketplace];
        return _validate(raw, schema, allowed, marketplace, /* partial */ false);
    }
    throw new BadRequestException({
        code: 'MARKETPLACE_NOT_SUPPORTED',
        message: `marketplace=${marketplace} is not supported in MVP`,
    });
}

/**
 * Валидирует partial update: required-проверки НЕ применяются, нужно лишь
 * чтобы переданные поля были allowed и значения были корректные строки.
 * Используется при PATCH `credentials` после merge с существующими.
 */
export function validateCredentialsForPartialUpdate(
    marketplace: MarketplaceType,
    raw: Record<string, unknown>,
): Record<string, string> {
    if (marketplace === 'WB' || marketplace === 'OZON') {
        const schema = SCHEMAS[marketplace];
        const allowed = ALLOWED_KEYS_BY_MARKETPLACE[marketplace];
        return _validate(raw, schema, allowed, marketplace, /* partial */ true);
    }
    throw new BadRequestException({
        code: 'MARKETPLACE_NOT_SUPPORTED',
    });
}

function _validate(
    raw: Record<string, unknown>,
    schema: { required: string[]; optional: string[] },
    allowed: Set<string>,
    marketplace: MarketplaceType,
    partial: boolean,
): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException({ code: 'CREDENTIALS_INVALID', message: 'credentials must be an object' });
    }

    // Запрет лишних ключей — атакер не сможет инъекциями записать что-то
    // нелегитимное в encryptedPayload.
    const incomingKeys = Object.keys(raw);
    const unknown = incomingKeys.filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
        throw new BadRequestException({
            code: 'CREDENTIALS_UNKNOWN_FIELDS',
            marketplace,
            unknown,
        });
    }

    // Required-проверка только для CREATE.
    if (!partial) {
        const missing = schema.required.filter((k) => {
            const v = (raw as any)[k];
            return v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0);
        });
        if (missing.length > 0) {
            throw new BadRequestException({
                code: 'CREDENTIALS_MISSING_FIELDS',
                marketplace,
                missing,
            });
        }
    }

    const out: Record<string, string> = {};
    for (const k of incomingKeys) {
        const v = (raw as any)[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string') {
            throw new BadRequestException({
                code: 'CREDENTIALS_FIELD_INVALID_TYPE',
                field: k,
                message: `${k} must be a string`,
            });
        }
        const trimmed = v.trim();
        if (trimmed.length === 0) {
            throw new BadRequestException({
                code: 'CREDENTIALS_FIELD_EMPTY',
                field: k,
            });
        }
        if (trimmed.length > MAX_VALUE_LEN) {
            throw new BadRequestException({
                code: 'CREDENTIALS_FIELD_TOO_LONG',
                field: k,
                max: MAX_VALUE_LEN,
            });
        }
        out[k] = trimmed;
    }
    return out;
}

/**
 * Список secret-полей per marketplace для построения maskedPreview.
 * `warehouseId` — НЕ секрет (его UI спокойно показывает целиком),
 * остальные значения маскируются.
 */
export const SECRET_FIELDS: Record<'WB' | 'OZON', Set<string>> = {
    WB: new Set(['apiToken', 'statToken']),
    OZON: new Set(['apiKey']),
};

export function isSupportedMarketplace(m: MarketplaceType): m is 'WB' | 'OZON' {
    return m === 'WB' || m === 'OZON';
}
