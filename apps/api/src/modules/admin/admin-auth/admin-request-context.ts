import type { Request } from 'express';

/// Хелперы для извлечения transport-уровневого контекста support-запроса.
/// Назначение: единая точка чтения correlation_id, ip и user-agent для всех
/// admin-controllers — чтобы admin-журнал и общий audit trail получали
/// одинаковый correlation_id и можно было сводить трассы через границу
/// admin-плоскости.
///
/// Поддерживаемые заголовки correlation:
///   • `x-correlation-id` — основной (используется и в tenant-facing API);
///   • `x-request-id`     — fallback (стандарт reverse-proxy).
const CORRELATION_HEADERS = ['x-correlation-id', 'x-request-id'] as const;

/// Безопасный парсер заголовка: принимает только короткие
/// печатаемые строки (≤128 символов, [-_.A-Za-z0-9]). Любая попытка
/// прокинуть мусор или мульти-значение даёт null.
const VALID_CORRELATION_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function extractCorrelationId(req: Request): string | null {
    for (const header of CORRELATION_HEADERS) {
        const raw = req.headers[header];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (!VALID_CORRELATION_RE.test(trimmed)) continue;
        return trimmed;
    }
    return null;
}

export function extractIp(req: Request): string | null {
    return (req.ip as string) ?? null;
}

export function extractUserAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
}

export interface SupportRequestContext {
    ip: string | null;
    userAgent: string | null;
    correlationId: string | null;
}

export function buildSupportRequestContext(req: Request): SupportRequestContext {
    return {
        ip: extractIp(req),
        userAgent: extractUserAgent(req),
        correlationId: extractCorrelationId(req),
    };
}
