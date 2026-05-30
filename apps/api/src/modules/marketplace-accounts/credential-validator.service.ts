import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { MarketplaceType } from '@prisma/client';

/**
 * Результат validation against external API.
 *
 *   - ok=true                       → валидно, credentialStatus=VALID
 *   - ok=false + errorCode=AUTH_*   → credentialStatus=INVALID (либо NEEDS_RECONNECT
 *                                     для temporary/expired token errors)
 *   - ok=false + errorCode=NET_*    → credentialStatus=UNKNOWN (сеть/таймаут — не
 *                                     уверены, что credentials битые)
 */
export type CredentialValidationResult = {
    ok: boolean;
    errorCode?: string;
    errorMessage?: string;
    /** Если true — переводим в NEEDS_RECONNECT, иначе INVALID. */
    needsReconnect?: boolean;
};

const TIMEOUT_MS = 8_000;

/**
 * Делает легковесный health-check credentials каждого marketplace.
 *
 * - WB: GET `/api/v3/warehouses` с Bearer-like header (через ключ как Authorization).
 * - Ozon: POST `/v1/warehouse/list` с Client-Id + Api-Key.
 *
 * Эти endpoint'ы выбраны за минимальный side-effect (read-only listing, без
 * write quota) и стабильную авторизацию. Если 401/403 — credentials явно
 * битые. Если timeout/5xx — UNKNOWN.
 */
@Injectable()
export class CredentialValidator {
    private readonly logger = new Logger(CredentialValidator.name);

    async validate(
        marketplace: MarketplaceType,
        credentials: Record<string, string>,
    ): Promise<CredentialValidationResult> {
        if (marketplace === 'WB') return this._validateWb(credentials);
        if (marketplace === 'OZON') return this._validateOzon(credentials);
        return {
            ok: false,
            errorCode: 'MARKETPLACE_NOT_SUPPORTED',
            errorMessage: `marketplace=${marketplace} is not supported`,
        };
    }

    private async _validateWb(c: Record<string, string>): Promise<CredentialValidationResult> {
        const token = c.apiToken;
        if (!token) {
            return { ok: false, errorCode: 'CREDENTIAL_MISSING_API_TOKEN' };
        }
        try {
            await axios.get('https://marketplace-api.wildberries.ru/api/v3/warehouses', {
                headers: { Authorization: token },
                timeout: TIMEOUT_MS,
            });
            return { ok: true };
        } catch (err) {
            return this._mapAxiosError(err as AxiosError);
        }
    }

    private async _validateOzon(c: Record<string, string>): Promise<CredentialValidationResult> {
        const clientId = c.clientId;
        const apiKey = c.apiKey;
        if (!clientId || !apiKey) {
            return { ok: false, errorCode: 'CREDENTIAL_MISSING_OZON_KEYS' };
        }
        try {
            await axios.post(
                'https://api-seller.ozon.ru/v1/warehouse/list',
                {},
                {
                    headers: { 'Client-Id': clientId, 'Api-Key': apiKey },
                    timeout: TIMEOUT_MS,
                },
            );
            return { ok: true };
        } catch (err) {
            const e = err as AxiosError;
            this.logger.error(`[Ozon validate] status=${e.response?.status} body=${JSON.stringify(e.response?.data)}`);
            return this._mapAxiosError(e);
        }
    }

    /**
     * Маппит axios-ошибку в наш credential-validation-результат.
     *
     *   - 401 → INVALID (auth-key неверный)
     *   - 403 → NEEDS_RECONNECT (token действителен, но прав не хватает или истёк)
     *   - 4xx прочие → INVALID
     *   - 5xx, timeout, ECONNRESET → UNKNOWN (сетевая проблема, credentials под вопросом)
     */
    private _mapAxiosError(err: AxiosError): CredentialValidationResult {
        const status = err.response?.status;
        const baseMessage = err.message ?? 'unknown error';

        if (status === 401) {
            return {
                ok: false,
                errorCode: 'AUTH_UNAUTHORIZED',
                errorMessage: `HTTP 401: ${baseMessage}`,
            };
        }
        if (status === 403) {
            return {
                ok: false,
                errorCode: 'AUTH_FORBIDDEN',
                errorMessage: `HTTP 403: ${baseMessage}`,
                needsReconnect: true,
            };
        }
        if (status && status >= 400 && status < 500) {
            return {
                ok: false,
                errorCode: `HTTP_${status}`,
                errorMessage: baseMessage,
            };
        }
        if (status && status >= 500) {
            return {
                ok: false,
                errorCode: `HTTP_${status}`,
                errorMessage: `Marketplace API HTTP ${status} — try again later`,
            };
        }
        // network/timeout
        return {
            ok: false,
            errorCode: err.code === 'ECONNABORTED' ? 'NET_TIMEOUT' : 'NET_ERROR',
            errorMessage: baseMessage,
        };
    }
}
