import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Shield, ChevronRight, X, AlertTriangle, Filter, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auditApi, type AuditLog, type SecurityEvent, type AuditLogFilters, type SecurityEventFilters } from '../api/audit';
import { S, PageHeader, Badge, TH, FieldLabel, Btn, Input, HiSelect, Pagination, EmptyState, SkuTag, Spinner } from '../components/ui';

// ─── Constants ───────────────────────────────────────────────────────────────

const READ_ONLY_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

const DOMAIN_LABELS: Record<string, string> = {
    AUTH: 'Авторизация', SESSION: 'Сессия', PASSWORD: 'Пароль',
    TEAM: 'Команда', TENANT: 'Компания', CATALOG: 'Каталог',
    INVENTORY: 'Склад', MARKETPLACE: 'Маркетплейс', SYNC: 'Синхронизация',
    BILLING: 'Биллинг', SUPPORT: 'Поддержка', FINANCE: 'Финансы',
};

const DOMAIN_BADGE_COLORS: Record<string, { color: string; bg: string }> = {
    AUTH:        { color: '#be123c', bg: '#fff1f2' },
    SESSION:     { color: '#b91c1c', bg: '#fef2f2' },
    PASSWORD:    { color: '#9d174d', bg: '#fdf2f8' },
    TEAM:        { color: '#6d28d9', bg: '#f5f3ff' },
    TENANT:      { color: '#1d4ed8', bg: '#eff6ff' },
    CATALOG:     { color: '#0e7490', bg: '#ecfeff' },
    INVENTORY:   { color: '#065f46', bg: '#ecfdf5' },
    MARKETPLACE: { color: '#c2410c', bg: '#fff7ed' },
    SYNC:        { color: '#92400e', bg: '#fffbeb' },
    BILLING:     { color: '#854d0e', bg: '#fefce8' },
    SUPPORT:     { color: '#475569', bg: '#f1f5f9' },
    FINANCE:     { color: '#0f766e', bg: '#f0fdfa' },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
    LOGIN_SUCCESS: 'Вход', LOGIN_FAILED: 'Ошибка входа', LOGOUT_ALL: 'Выход везде',
    SESSION_REVOKED: 'Сессия отозвана', PASSWORD_RESET_REQUESTED: 'Сброс пароля запрошен',
    PASSWORD_RESET_COMPLETED: 'Пароль изменён', INVITE_CREATED: 'Приглашение отправлено',
    INVITE_RESENT: 'Приглашение повторно', INVITE_CANCELLED: 'Приглашение отменено',
    MEMBER_ROLE_CHANGED: 'Роль изменена', MEMBER_REMOVED: 'Участник удалён',
    TENANT_CREATED: 'Компания создана', TENANT_STATE_CHANGED: 'Статус изменён',
    TENANT_CLOSED: 'Компания закрыта', TENANT_RESTORED: 'Компания восстановлена',
    PRODUCT_CREATED: 'Товар создан', PRODUCT_UPDATED: 'Товар обновлён',
    PRODUCT_ARCHIVED: 'Товар архивирован', PRODUCT_RESTORED: 'Товар восстановлен',
    PRODUCT_DUPLICATE_MERGED: 'Дубликаты объединены', CATALOG_IMPORT_COMMITTED: 'Импорт применён',
    MARKETPLACE_MAPPING_CREATED: 'Привязка к МП добавлена', MARKETPLACE_MAPPING_DELETED: 'Привязка к МП удалена',
    STOCK_MANUALLY_ADJUSTED: 'Коррекция остатка', STOCK_CORRECTION_IMPORTED: 'Импорт остатков',
    STOCK_ORDER_DEDUCTED: 'Списание по заказу', STOCK_ORDER_RETURNED: 'Возврат остатка',
    MARKETPLACE_ACCOUNT_CONNECTED: 'Аккаунт подключён', MARKETPLACE_CREDENTIALS_UPDATED: 'Ключи обновлены',
    MARKETPLACE_CREDENTIALS_REVALIDATED: 'Ключи проверены', MARKETPLACE_ACCOUNT_DEACTIVATED: 'Аккаунт отключён',
    SYNC_MANUAL_REQUESTED: 'Синхронизация запущена', SYNC_RETRY_REQUESTED: 'Повтор синхронизации',
    SYNC_BLOCKED_BY_POLICY: 'Синхронизация заблокирована', SYNC_FAILED_TERMINALLY: 'Синхронизация упала',
    TRIAL_STARTED: 'Пробный период начат', TRIAL_EXPIRED: 'Пробный период истёк',
    SUBSCRIPTION_CHANGED: 'Подписка изменена', PAYMENT_STATUS_CHANGED: 'Статус оплаты изменён',
    SUSPENSION_ENTERED: 'Приостановка', GRACE_ENTERED: 'Льготный период',
    SUPPORT_ACCESS_GRANTED: 'Доступ поддержки', SUPPORT_TENANT_DATA_CHANGED: 'Данные изменены поддержкой',
    SUPPORT_TENANT_RESTORED: 'Восстановлено поддержкой', SUPPORT_TENANT_CLOSED: 'Закрыто поддержкой',
    PRODUCT_DELETED: 'Удаление товара', STOCK_ADJUSTED: 'Корректировка', ORDER_DEDUCTED: 'Списание заказа',
};

const ACTOR_TYPE_LABELS: Record<string, string> = {
    user: 'Пользователь', system: 'Система', support: 'Поддержка', marketplace: 'Маркетплейс',
};

const SOURCE_LABELS: Record<string, string> = {
    ui: 'Интерфейс', api: 'API', worker: 'Фоновый процесс', marketplace: 'Маркетплейс',
};

const SEC_EVENT_LABELS: Record<string, string> = {
    login_success: 'Вход выполнен', login_failed: 'Ошибка входа',
    password_reset_requested: 'Сброс пароля', password_changed: 'Пароль изменён',
    session_revoked: 'Сессия отозвана',
};

const READ_ONLY_BANNER: Record<string, string> = {
    TRIAL_EXPIRED: 'Пробный период истёк. История изменений доступна только для чтения.',
    SUSPENDED:     'Аккаунт приостановлен. История изменений доступна только для чтения.',
    CLOSED:        'Компания закрыта. История изменений доступна только для чтения.',
};

const DOMAINS = ['AUTH', 'SESSION', 'PASSWORD', 'TEAM', 'TENANT', 'CATALOG', 'INVENTORY', 'MARKETPLACE', 'SYNC', 'BILLING', 'SUPPORT'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEventLabel(log: AuditLog): string {
    if (log.eventType) return EVENT_TYPE_LABELS[log.eventType] ?? log.eventType;
    if (log.actionType) return EVENT_TYPE_LABELS[log.actionType] ?? log.actionType;
    return '—';
}

function getDomainBadge(domain: string | null): React.ReactElement | null {
    if (!domain) return null;
    const cfg = DOMAIN_BADGE_COLORS[domain] ?? { color: S.sub, bg: '#f1f5f9' };
    return <Badge label={DOMAIN_LABELS[domain] ?? domain} color={cfg.color} bg={cfg.bg} />;
}

function secEventBadge(eventType: string): React.ReactElement {
    const cfg =
        eventType === 'login_failed'  ? { color: S.red,   bg: 'rgba(239,68,68,0.08)' } :
        eventType === 'login_success' ? { color: S.green, bg: 'rgba(16,185,129,0.08)' } :
        { color: S.sub, bg: '#f1f5f9' };
    return <Badge label={SEC_EVENT_LABELS[eventType] ?? eventType} color={cfg.color} bg={cfg.bg} />;
}

// ─── Before/After Diff ───────────────────────────────────────────────────────

function DiffView({ before, after, changedFields }: {
    before: Record<string, unknown> | null;
    after:  Record<string, unknown> | null;
    changedFields: string[] | null;
}) {
    if (!before && !after) return (
        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>Нет данных об изменениях</p>
    );

    const keys = changedFields?.length
        ? changedFields
        : [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

    if (keys.length === 0) return (
        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>Изменений не зафиксировано</p>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {keys.map(key => {
                const bv = before?.[key];
                const av = after?.[key];
                const changed = JSON.stringify(bv) !== JSON.stringify(av);
                return (
                    <div key={key} style={{
                        borderRadius: 8, padding: '6px 10px', fontSize: 12,
                        fontFamily: "'JetBrains Mono', monospace",
                        background: changed ? 'rgba(245,158,11,0.06)' : '#f8fafc',
                        border: changed ? `1px solid rgba(245,158,11,0.25)` : `1px solid ${S.border}`,
                    }}>
                        <span style={{ fontFamily: 'Inter', color: S.sub, fontWeight: 500 }}>{key}: </span>
                        {before && bv !== undefined && (
                            <span style={{ textDecoration: 'line-through', color: S.red, marginRight: 6 }}>{JSON.stringify(bv)}</span>
                        )}
                        {after && av !== undefined && (
                            <span style={{ color: S.green }}>{JSON.stringify(av)}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

function DetailPanel({ log, onClose }: { log: AuditLog; onClose: () => void }) {
    const isRedacted = log.redactionLevel === 'strict';

    return (
        <div style={{
            position: 'fixed', insetBlock: 0, right: 0, zIndex: 40,
            width: '100%', maxWidth: 480,
            background: '#fff',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
            borderLeft: `1px solid ${S.border}`,
            display: 'flex', flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderBottom: `1px solid ${S.border}`, background: S.bg,
            }}>
                <div>
                    <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Детали события</p>
                    <p style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: S.ink, margin: '2px 0 0' }}>{getEventLabel(log)}</p>
                </div>
                <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: S.muted, fontSize: 20, lineHeight: 1, display: 'flex' }}>
                    <X size={16} />
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Meta */}
                <section>
                    <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Контекст</p>
                    <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 8, columnGap: 16, fontSize: 13 }}>
                        {log.eventDomain && (
                            <>
                                <dt style={{ color: S.sub, fontFamily: 'Inter' }}>Домен</dt>
                                <dd style={{ margin: 0 }}>{getDomainBadge(log.eventDomain)}</dd>
                            </>
                        )}
                        {log.entityType && (
                            <>
                                <dt style={{ color: S.sub, fontFamily: 'Inter' }}>Тип сущности</dt>
                                <dd style={{ margin: 0 }}><SkuTag>{log.entityType}</SkuTag></dd>
                            </>
                        )}
                        {log.entityId && (
                            <>
                                <dt style={{ color: S.sub, fontFamily: 'Inter' }}>ID сущности</dt>
                                <dd style={{ margin: 0 }}><SkuTag>{log.entityId}</SkuTag></dd>
                            </>
                        )}
                        <dt style={{ color: S.sub, fontFamily: 'Inter' }}>Исполнитель</dt>
                        <dd style={{ margin: 0, fontFamily: 'Inter', fontSize: 13, color: S.ink }}>
                            {ACTOR_TYPE_LABELS[log.actorType ?? ''] ?? log.actorType ?? '—'}
                            {log.actorRole && <span style={{ color: S.muted, marginLeft: 4, fontSize: 11 }}>({log.actorRole})</span>}
                        </dd>
                        {log.source && (
                            <>
                                <dt style={{ color: S.sub, fontFamily: 'Inter' }}>Источник</dt>
                                <dd style={{ margin: 0, fontFamily: 'Inter', fontSize: 13, color: S.ink }}>{SOURCE_LABELS[log.source] ?? log.source}</dd>
                            </>
                        )}
                        <dt style={{ color: S.sub, fontFamily: 'Inter' }}>Время</dt>
                        <dd style={{ margin: 0, fontFamily: 'Inter', fontSize: 13, color: S.ink }}>{format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm:ss', { locale: ru })}</dd>
                    </dl>
                </section>

                {/* Correlation */}
                {(log.requestId || log.correlationId) && (
                    <section>
                        <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Трассировка</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                            {log.requestId && (
                                <div>
                                    <span style={{ fontFamily: 'Inter', color: S.sub }}>requestId: </span>
                                    <span style={{ color: S.ink }}>{log.requestId}</span>
                                </div>
                            )}
                            {log.correlationId && (
                                <div>
                                    <span style={{ fontFamily: 'Inter', color: S.sub }}>correlationId: </span>
                                    <span style={{ color: S.ink }}>{log.correlationId}</span>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* Changes */}
                <section>
                    <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Изменения</p>
                    {isRedacted ? (
                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Shield size={14} /> Детали скрыты политикой редактирования
                        </p>
                    ) : (
                        <>
                            {log.changedFields && log.changedFields.length > 0 && (
                                <div style={{ marginBottom: 12 }}>
                                    <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginBottom: 6 }}>Изменённые поля:</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {log.changedFields.map(f => (
                                            <SkuTag key={f}>{f}</SkuTag>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <DiffView before={log.before} after={log.after} changedFields={log.changedFields} />
                        </>
                    )}
                </section>

                {/* Legacy changes for old records */}
                {!log.eventType && log.actionType && (
                    <section>
                        <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Изменения (устаревший формат)</p>
                        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 6, columnGap: 16, fontSize: 13 }}>
                            {log.productSku && (<><dt style={{ color: S.sub, fontFamily: 'Inter' }}>SKU</dt><dd style={{ margin: 0, fontWeight: 600 }}>{log.productSku}</dd></>)}
                            {log.beforeTotal != null && (<><dt style={{ color: S.sub, fontFamily: 'Inter' }}>Было</dt><dd style={{ margin: 0 }}>{log.beforeTotal}</dd></>)}
                            {log.afterTotal != null && (<><dt style={{ color: S.sub, fontFamily: 'Inter' }}>Стало</dt><dd style={{ margin: 0, fontWeight: 600 }}>{log.afterTotal}</dd></>)}
                            {log.delta != null && (<><dt style={{ color: S.sub, fontFamily: 'Inter' }}>Δ</dt><dd style={{ margin: 0, color: log.delta > 0 ? S.green : S.red, fontWeight: 600 }}>{log.delta > 0 ? '+' : ''}{log.delta}</dd></>)}
                            {log.note && (<><dt style={{ color: S.sub, fontFamily: 'Inter' }}>Примечание</dt><dd style={{ margin: 0, color: S.ink }}>{log.note}</dd></>)}
                        </dl>
                    </section>
                )}

                {/* Metadata */}
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <section>
                        <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Метаданные</p>
                        <pre style={{
                            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                            background: S.bg, borderRadius: 8, padding: 12,
                            overflowX: 'auto', color: S.ink, whiteSpace: 'pre-wrap',
                            border: `1px solid ${S.border}`, margin: 0,
                        }}>
                            {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                    </section>
                )}
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = 'logs' | 'security';

export default function History() {
    const { activeTenant } = useAuth();
    const tenantId = activeTenant?.id;
    const accessState = activeTenant?.accessState ?? '';
    const isReadOnly = READ_ONLY_STATES.has(accessState);

    const [tab, setTab] = useState<Tab>('logs');

    // Audit logs state
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [logsMeta, setLogsMeta] = useState({ total: 0, page: 1, lastPage: 1, retentionDays: 180 });
    const [logsPage, setLogsPage] = useState(1);
    const [logsLoading, setLogsLoading] = useState(false);

    // Audit log filters
    const [domain, setDomain] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [entityType, setEntityType] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Security events state
    const [secEvents, setSecEvents] = useState<SecurityEvent[]>([]);
    const [secMeta, setSecMeta] = useState({ total: 0, page: 1, lastPage: 1 });
    const [secPage, setSecPage] = useState(1);
    const [secLoading, setSecLoading] = useState(false);
    const [secEventType, setSecEventType] = useState('');

    // Drill-down
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

    // ── Fetch audit logs ──────────────────────────────────────────────────────

    const fetchLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            const filters: AuditLogFilters = { page: logsPage, limit: 20 };
            if (domain)     filters.eventDomain = domain;
            if (fromDate)   filters.from        = new Date(fromDate).toISOString();
            if (toDate)     filters.to          = new Date(toDate + 'T23:59:59').toISOString();
            if (entityType) filters.entityType  = entityType;

            const res = await auditApi.getLogs(tenantId, filters);
            setLogs(res.data);
            setLogsMeta(res.meta as any);
        } catch {
            setLogs([]);
        } finally {
            setLogsLoading(false);
        }
    }, [tenantId, logsPage, domain, fromDate, toDate, entityType]);

    // ── Fetch security events ─────────────────────────────────────────────────

    const fetchSecEvents = useCallback(async () => {
        setSecLoading(true);
        try {
            const filters: SecurityEventFilters = { page: secPage, limit: 20 };
            if (secEventType) filters.eventType = secEventType;

            const res = await auditApi.getSecurityEvents(tenantId, filters);
            setSecEvents(res.data);
            setSecMeta(res.meta);
        } catch {
            setSecEvents([]);
        } finally {
            setSecLoading(false);
        }
    }, [tenantId, secPage, secEventType]);

    useEffect(() => {
        if (tab === 'logs') {
            const t = setTimeout(fetchLogs, 200);
            return () => clearTimeout(t);
        }
    }, [tab, fetchLogs]);

    useEffect(() => {
        if (tab === 'security') {
            const t = setTimeout(fetchSecEvents, 200);
            return () => clearTimeout(t);
        }
    }, [tab, fetchSecEvents]);

    // Reset page when filters change
    useEffect(() => { setLogsPage(1); }, [domain, fromDate, toDate, entityType]);
    useEffect(() => { setSecPage(1); }, [secEventType]);

    // ── Render helpers ────────────────────────────────────────────────────────

    const ROW: React.CSSProperties = {
        display: 'flex', alignItems: 'center', minHeight: 52,
        borderBottom: `1px solid ${S.border}`, cursor: 'pointer', transition: 'background 0.1s',
        padding: '0 4px',
    };

    const renderLogRow = (log: AuditLog) => (
        <div
            key={log.id}
            style={ROW}
            onClick={() => setSelectedLog(log)}
            onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
        >
            <div style={{ flex: 1.2, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, color: S.sub, whiteSpace: 'nowrap' }}>
                {format(new Date(log.createdAt), 'dd MMM, HH:mm', { locale: ru })}
            </div>
            <div style={{ flex: 1.5, padding: '0 12px' }}>
                {getDomainBadge(log.eventDomain)}
            </div>
            <div style={{ flex: 2, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, fontWeight: 500, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getEventLabel(log)}
            </div>
            <div style={{ flex: 2, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {log.entityType
                    ? <span>{log.entityType}{log.entityId && <span style={{ color: S.muted, marginLeft: 4 }}>#{log.entityId.slice(-6)}</span>}</span>
                    : log.productSku
                        ? <SkuTag>{log.productSku}</SkuTag>
                        : <span style={{ color: S.muted }}>—</span>
                }
            </div>
            <div style={{ flex: 1.5, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {log.actorType ? (ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType) : (log.actorEmail ?? '—')}
            </div>
            <div style={{ width: 32, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                <ChevronRight size={14} color={S.muted} />
            </div>
        </div>
    );

    const renderSecRow = (ev: SecurityEvent) => (
        <div
            key={ev.id}
            style={{ ...ROW, cursor: 'default' }}
            onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
        >
            <div style={{ flex: 1.5, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, color: S.sub, whiteSpace: 'nowrap' }}>
                {format(new Date(ev.createdAt), 'dd MMM, HH:mm', { locale: ru })}
            </div>
            <div style={{ flex: 2, padding: '0 12px' }}>
                {secEventBadge(ev.eventType)}
            </div>
            <div style={{ flex: 1.5, padding: '0 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.sub }}>
                {ev.userId ? ev.userId.slice(-8) : '—'}
            </div>
            <div style={{ flex: 1.5, padding: '0 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.sub }}>
                {ev.ip ?? '—'}
            </div>
            <div style={{ flex: 3, padding: '0 12px', fontFamily: 'Inter', fontSize: 12, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.userAgent ?? '—'}
            </div>
        </div>
    );

    // ── Layout ────────────────────────────────────────────────────────────────

    const activeFilterCount = [domain, fromDate, toDate, entityType].filter(Boolean).length;

    return (
        <div style={{ paddingBottom: 48 }}>
            {/* Header */}
            <PageHeader
                title="История изменений"
                subtitle={tab === 'logs' && logsMeta.retentionDays ? `Хранится ${logsMeta.retentionDays} дней` : undefined}
            />

            {/* Read-only banner */}
            {isReadOnly && READ_ONLY_BANNER[accessState] && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.3)`,
                    borderRadius: 12, padding: '12px 16px', marginBottom: 20,
                    fontFamily: 'Inter', fontSize: 13, color: '#92400e',
                }}>
                    <AlertTriangle size={16} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{READ_ONLY_BANNER[accessState]}</span>
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 4, borderRadius: 12, width: 'fit-content', marginBottom: 20 }}>
                {(['logs', 'security'] as Tab[]).map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{
                            padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            fontFamily: 'Inter', fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                            background: tab === t ? '#fff' : 'transparent',
                            color: tab === t ? S.ink : S.sub,
                            boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                    >
                        {t === 'logs' ? 'Журнал' : (<><Shield size={14} />Security</>)}
                    </button>
                ))}
            </div>

            {/* Filters for logs tab */}
            {tab === 'logs' && (
                <div style={{ background: '#fff', border: `1px solid ${S.border}`, borderRadius: 16, overflow: 'hidden', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer' }}
                        onClick={() => setShowFilters(f => !f)}
                        onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: S.ink }}>
                            <Filter size={15} color={S.muted} />
                            Фильтры
                            {activeFilterCount > 0 && (
                                <Badge label={String(activeFilterCount)} color={S.blue} bg='rgba(59,130,246,0.1)' />
                            )}
                        </div>
                        <ChevronRight size={15} color={S.muted} style={{ transform: showFilters ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                    </div>

                    {showFilters && (
                        <div style={{ padding: '16px', borderTop: `1px solid ${S.border}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                            <div>
                                <FieldLabel>Домен</FieldLabel>
                                <HiSelect
                                    value={domain}
                                    onChange={setDomain}
                                    options={[{ value: '', label: 'Все домены' }, ...DOMAINS.map(d => ({ value: d, label: DOMAIN_LABELS[d] ?? d }))]}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <FieldLabel>Тип сущности</FieldLabel>
                                <Input
                                    value={entityType}
                                    onChange={e => setEntityType(e.target.value)}
                                    placeholder="PRODUCT, USER..."
                                />
                            </div>
                            <div>
                                <FieldLabel>От</FieldLabel>
                                <Input
                                    type="date"
                                    value={fromDate}
                                    onChange={e => setFromDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <FieldLabel>До</FieldLabel>
                                <Input
                                    type="date"
                                    value={toDate}
                                    onChange={e => setToDate(e.target.value)}
                                />
                            </div>
                            {activeFilterCount > 0 && (
                                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                    <Btn
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setDomain(''); setFromDate(''); setToDate(''); setEntityType(''); }}
                                    >
                                        <X size={12} /> Сбросить
                                    </Btn>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Security events filter */}
            {tab === 'security' && (
                <div style={{ background: '#fff', border: `1px solid ${S.border}`, borderRadius: 16, padding: '12px 16px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <FieldLabel>Тип события</FieldLabel>
                        <HiSelect
                            value={secEventType}
                            onChange={setSecEventType}
                            options={[{ value: '', label: 'Все события' }, ...Object.entries(SEC_EVENT_LABELS).map(([k, v]) => ({ value: k, label: v }))]}
                        />
                    </div>
                </div>
            )}

            {/* Table */}
            <div style={{ background: '#fff', border: `1px solid ${S.border}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {/* Table header */}
                {tab === 'logs' ? (
                    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 4px', background: S.bg, borderBottom: `1px solid ${S.border}` }}>
                        <TH flex={1.2}>Время</TH>
                        <TH flex={1.5}>Домен</TH>
                        <TH flex={2}>Событие</TH>
                        <TH flex={2}>Сущность</TH>
                        <TH flex={1.5}>Исполнитель</TH>
                        <div style={{ width: 32 }} />
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 4px', background: S.bg, borderBottom: `1px solid ${S.border}` }}>
                        <TH flex={1.5}>Время</TH>
                        <TH flex={2}>Событие</TH>
                        <TH flex={1.5}>Пользователь</TH>
                        <TH flex={1.5}>IP</TH>
                        <TH flex={3}>User Agent</TH>
                    </div>
                )}

                {/* Table body */}
                {tab === 'logs' ? (
                    logsLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            <Spinner /> Загрузка...
                        </div>
                    ) : logs.length === 0 ? (
                        <EmptyState icon={Clock} title="Записей не найдено" subtitle="Попробуйте изменить фильтры" />
                    ) : (
                        logs.map(renderLogRow)
                    )
                ) : (
                    secLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            <Spinner /> Загрузка...
                        </div>
                    ) : secEvents.length === 0 ? (
                        <EmptyState icon={Shield} title="Событий не найдено" />
                    ) : (
                        secEvents.map(renderSecRow)
                    )
                )}

                {/* Pagination */}
                {(() => {
                    const meta   = tab === 'logs' ? logsMeta : secMeta;
                    const page   = tab === 'logs' ? logsPage : secPage;
                    const setPage = tab === 'logs' ? setLogsPage : setSecPage;
                    return (
                        <Pagination
                            page={page}
                            totalPages={meta.lastPage}
                            onPage={setPage}
                            total={meta.total}
                        />
                    );
                })()}
            </div>

            {/* Detail panel overlay */}
            {selectedLog && (
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(2px)' }}
                        onClick={() => setSelectedLog(null)}
                    />
                    <DetailPanel log={selectedLog} onClose={() => setSelectedLog(null)} />
                </>
            )}
        </div>
    );
}
