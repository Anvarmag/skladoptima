import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Shield, X, AlertTriangle, Filter, Clock, ChevronRight, User, Cpu, Headphones } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auditApi, type AuditLog, type SecurityEvent, type AuditLogFilters, type SecurityEventFilters } from '../api/audit';
import { S, PageHeader, Card, FieldLabel, Btn, Input, HiSelect, Pagination, EmptyState, SkuTag, Spinner } from '../components/ui';

// ─── Constants ───────────────────────────────────────────────────────────────

const READ_ONLY_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

const DOMAIN_LABELS: Record<string, string> = {
    AUTH: 'Авторизация', SESSION: 'Сессия', PASSWORD: 'Пароль',
    TEAM: 'Команда', TENANT: 'Компания', CATALOG: 'Каталог',
    INVENTORY: 'Склад', MARKETPLACE: 'Маркетплейс', SYNC: 'Синхронизация',
    BILLING: 'Биллинг', SUPPORT: 'Поддержка', FINANCE: 'Финансы',
};

const ACTION_BADGE: Record<string, { label: string; color: string; bg: string }> = {
    STOCK_MANUALLY_ADJUSTED:   { label: 'Корректировка',   color: '#0e7490', bg: '#ecfeff' },
    STOCK_CORRECTION_IMPORTED: { label: 'Импорт остатков', color: '#0e7490', bg: '#ecfeff' },
    STOCK_ORDER_DEDUCTED:      { label: 'Списание заказа', color: '#be123c', bg: '#fff1f2' },
    STOCK_ORDER_RETURNED:      { label: 'Возврат',         color: '#065f46', bg: '#ecfdf5' },
    STOCK_ADJUSTED:            { label: 'Корректировка',   color: '#0e7490', bg: '#ecfeff' },
    ORDER_DEDUCTED:            { label: 'Списание заказа', color: '#be123c', bg: '#fff1f2' },
    PRODUCT_CREATED:           { label: 'Создание товара', color: '#065f46', bg: '#ecfdf5' },
    PRODUCT_UPDATED:           { label: 'Обновление',      color: '#1d4ed8', bg: '#eff6ff' },
    PRODUCT_ARCHIVED:          { label: 'Архивация',       color: '#92400e', bg: '#fffbeb' },
    PRODUCT_RESTORED:          { label: 'Восстановление',  color: '#065f46', bg: '#ecfdf5' },
    PRODUCT_DELETED:           { label: 'Удаление',        color: '#be123c', bg: '#fff1f2' },
    PRODUCT_DUPLICATE_MERGED:  { label: 'Объединение',     color: '#6d28d9', bg: '#f5f3ff' },
    CATALOG_IMPORT_COMMITTED:  { label: 'Импорт каталога', color: '#1d4ed8', bg: '#eff6ff' },
    MARKETPLACE_MAPPING_CREATED:     { label: 'Привязка к МП',   color: '#c2410c', bg: '#fff7ed' },
    MARKETPLACE_MAPPING_DELETED:     { label: 'Отвязка МП',      color: '#be123c', bg: '#fff1f2' },
    MARKETPLACE_ACCOUNT_CONNECTED:   { label: 'МП подключён',    color: '#065f46', bg: '#ecfdf5' },
    MARKETPLACE_CREDENTIALS_UPDATED: { label: 'Ключи МП',        color: '#92400e', bg: '#fffbeb' },
    MARKETPLACE_ACCOUNT_DEACTIVATED: { label: 'МП отключён',     color: '#be123c', bg: '#fff1f2' },
    SYNC_MANUAL_REQUESTED:     { label: 'Синхронизация',   color: '#92400e', bg: '#fffbeb' },
    SYNC_RETRY_REQUESTED:      { label: 'Повтор синхр.',   color: '#92400e', bg: '#fffbeb' },
    SYNC_FAILED_TERMINALLY:    { label: 'Ошибка синхр.',   color: '#be123c', bg: '#fff1f2' },
    INVITE_CREATED:            { label: 'Приглашение',     color: '#6d28d9', bg: '#f5f3ff' },
    MEMBER_ROLE_CHANGED:       { label: 'Роль изменена',   color: '#1d4ed8', bg: '#eff6ff' },
    MEMBER_REMOVED:            { label: 'Участник удалён', color: '#be123c', bg: '#fff1f2' },
    LOGIN_SUCCESS:             { label: 'Вход',            color: '#065f46', bg: '#ecfdf5' },
    LOGIN_FAILED:              { label: 'Ошибка входа',    color: '#be123c', bg: '#fff1f2' },
    PASSWORD_RESET_COMPLETED:  { label: 'Пароль изменён',  color: '#6d28d9', bg: '#f5f3ff' },
    TRIAL_STARTED:             { label: 'Пробный период',  color: '#0e7490', bg: '#ecfeff' },
    SUBSCRIPTION_CHANGED:      { label: 'Подписка',        color: '#854d0e', bg: '#fefce8' },
    PAYMENT_STATUS_CHANGED:    { label: 'Оплата',          color: '#854d0e', bg: '#fefce8' },
    SUSPENSION_ENTERED:        { label: 'Приостановка',    color: '#be123c', bg: '#fff1f2' },
    SUPPORT_TENANT_DATA_CHANGED:{ label: 'Поддержка',      color: '#475569', bg: '#f1f5f9' },
};

const MP_COLORS: Record<string, { label: string; color: string; bg: string }> = {
    WB:   { label: 'Wildberries',    color: '#7c3aed', bg: '#f5f3ff' },
    OZON: { label: 'Ozon',           color: '#1d4ed8', bg: '#eff6ff' },
    OZ:   { label: 'Ozon',           color: '#1d4ed8', bg: '#eff6ff' },
    YM:   { label: 'Яндекс Маркет',  color: '#b45309', bg: '#fffbeb' },
};

const ACTOR_ICONS: Record<string, React.ReactNode> = {
    user:    <User size={13} />,
    system:  <Cpu size={13} />,
    support: <Headphones size={13} />,
};

const ACTOR_LABELS: Record<string, string> = {
    user: 'Пользователь', system: 'Система', support: 'Поддержка',
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

const thSt: React.CSSProperties = {
    fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.muted,
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '10px 16px', textAlign: 'left', verticalAlign: 'middle',
    whiteSpace: 'nowrap', background: '#fafbfc',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActionKey(log: AuditLog): string {
    return log.eventType ?? log.actionType ?? '';
}

function getActionBadge(log: AuditLog): React.ReactElement {
    const key = getActionKey(log);
    const cfg = ACTION_BADGE[key];
    const label = cfg?.label || key || '—';
    const color = cfg?.color ?? S.sub;
    const bg    = cfg?.bg    ?? '#f1f5f9';
    return (
        <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 999,
            fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
            background: bg, color, whiteSpace: 'nowrap',
        }}>
            {label}
        </span>
    );
}

function getActorCell(log: AuditLog): React.ReactElement {
    const type = log.actorType ?? '';

    if (type === 'marketplace') {
        const mpKey = (log.metadata?.marketplace as string | undefined)?.toUpperCase() ?? '';
        const mp = MP_COLORS[mpKey];
        const label = (mp?.label ?? mpKey) || 'Маркетплейс';
        const color = mp?.color ?? S.sub;
        const bg    = mp?.bg    ?? '#f1f5f9';
        return (
            <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                background: bg, color, whiteSpace: 'nowrap',
            }}>
                {label}
            </span>
        );
    }

    const icon  = ACTOR_ICONS[type] ?? <User size={13} />;
    const label = (log.actorEmail ?? ACTOR_LABELS[type] ?? type) || '—';
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'Inter', fontSize: 13, color: S.ink }}>
            <span style={{ color: S.muted, flexShrink: 0, display: 'flex' }}>{icon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </span>
    );
}

function getChangeSummary(log: AuditLog): React.ReactElement | null {
    if (log.beforeTotal != null || log.afterTotal != null) {
        const before = log.beforeTotal ?? '?';
        const after  = log.afterTotal  ?? '?';
        const delta  = log.delta;
        const deltaColor = delta == null ? S.sub : delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : S.muted;
        return (
            <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.ink }}>
                <span style={{ color: S.muted }}>{String(before)}</span>
                <span style={{ color: S.muted, margin: '0 4px' }}>→</span>
                <span style={{ fontWeight: 600 }}>{String(after)}</span>
                {delta != null && (
                    <span style={{ marginLeft: 6, color: deltaColor, fontWeight: 600 }}>
                        ({delta > 0 ? '+' : ''}{delta})
                    </span>
                )}
                {log.note && (
                    <span style={{ display: 'block', color: S.muted, fontSize: 11, marginTop: 2 }}>{log.note}</span>
                )}
            </span>
        );
    }
    const keys = log.changedFields?.length
        ? log.changedFields
        : [...new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})])];
    if (keys.length === 0) return null;
    const shown = keys.slice(0, 3);
    const more  = keys.length - 3;
    return (
        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
            {shown.join(', ')}{more > 0 ? ` +${more}` : ''}
        </span>
    );
}

function getProductCell(log: AuditLog): React.ReactElement | null {
    if (log.productSku) return <SkuTag>{log.productSku}</SkuTag>;
    if ((log.entityType === 'PRODUCT' || log.entityType === 'STOCK') && log.entityId) {
        return <SkuTag>…{log.entityId.slice(-6)}</SkuTag>;
    }
    return null;
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DiffRow({ label, before, after }: { label: string; before: unknown; after: unknown }) {
    const fmt = (v: unknown) =>
        v === undefined || v === null
            ? <span style={{ color: S.muted, fontStyle: 'italic' }}>—</span>
            : <span>{JSON.stringify(v)}</span>;
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    return (
        <div style={{
            borderRadius: 8, padding: '8px 12px',
            background: changed ? 'rgba(245,158,11,0.05)' : '#f8fafc',
            border: `1px solid ${changed ? 'rgba(245,158,11,0.25)' : S.border}`,
            fontSize: 12,
        }}>
            <div style={{ fontFamily: 'Inter', color: S.muted, fontWeight: 600, marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{fmt(before)}</span>
                <span style={{ color: S.muted }}>→</span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{fmt(after)}</span>
            </div>
        </div>
    );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ borderRadius: 8, padding: '10px 12px', background: S.bg, border: `1px solid ${S.border}` }}>
            <div style={{ fontSize: 11, fontFamily: 'Inter', color: S.muted, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            {children}
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, marginTop: 0 }}>
            {children}
        </p>
    );
}

function DetailPanel({ log, onClose }: { log: AuditLog; onClose: () => void }) {
    const isRedacted = log.redactionLevel === 'strict';
    const key = getActionKey(log);
    const cfg = ACTION_BADGE[key];
    const actionLabel = cfg?.label || key || '—';
    const actionColor = cfg?.color ?? S.sub;
    const actionBg    = cfg?.bg    ?? '#f1f5f9';

    const diffKeys = log.changedFields?.length
        ? log.changedFields
        : [...new Set([...Object.keys(log.before ?? {}), ...Object.keys(log.after ?? {})])];

    const hasLegacyStock = log.beforeTotal != null || log.afterTotal != null;

    return (
        <div style={{
            position: 'fixed', insetBlock: 0, right: 0, zIndex: 40,
            width: '100%', maxWidth: 500,
            background: '#fff', boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
            borderLeft: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${S.border}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Детали события</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontFamily: 'Inter', fontSize: 12, fontWeight: 600, background: actionBg, color: actionColor, whiteSpace: 'nowrap' }}>
                            {actionLabel}
                        </span>
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                            {format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm:ss', { locale: ru })}
                        </span>
                    </div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 8, color: S.muted, display: 'flex' }}>
                    <X size={16} />
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <section>
                    <SectionTitle>Кто и что</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <InfoCard label="Автор">
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: S.ink }}>
                                <span style={{ color: S.muted, display: 'flex' }}>{ACTOR_ICONS[log.actorType ?? ''] ?? <User size={13} />}</span>
                                {log.actorEmail ?? ACTOR_LABELS[log.actorType ?? ''] ?? log.actorType ?? '—'}
                            </div>
                            {log.actorRole && <div style={{ fontSize: 11, color: S.muted, marginTop: 2 }}>{log.actorRole}</div>}
                        </InfoCard>
                        <InfoCard label="Источник">
                            <span style={{ fontSize: 13, color: S.ink }}>{SOURCE_LABELS[log.source ?? ''] ?? log.source ?? '—'}</span>
                        </InfoCard>
                        {log.entityType && (
                            <InfoCard label="Тип объекта"><SkuTag>{log.entityType}</SkuTag></InfoCard>
                        )}
                        {(log.productSku || (log.entityType === 'PRODUCT' && log.entityId)) && (
                            <InfoCard label="Артикул / ID"><SkuTag>{log.productSku ?? log.entityId}</SkuTag></InfoCard>
                        )}
                    </div>
                </section>

                {hasLegacyStock && (
                    <section>
                        <SectionTitle>Изменение остатка</SectionTitle>
                        <div style={{ borderRadius: 10, padding: '14px 16px', background: 'rgba(14,116,144,0.05)', border: '1px solid rgba(14,116,144,0.2)', display: 'flex', alignItems: 'center', gap: 20 }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 11, color: S.muted, marginBottom: 2 }}>Было</div>
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: '#dc2626', fontWeight: 700 }}>{log.beforeTotal ?? '?'}</div>
                            </div>
                            <div style={{ fontSize: 18, color: S.muted }}>→</div>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 11, color: S.muted, marginBottom: 2 }}>Стало</div>
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: '#16a34a', fontWeight: 700 }}>{log.afterTotal ?? '?'}</div>
                            </div>
                            {log.delta != null && (
                                <div style={{ textAlign: 'center', marginLeft: 8 }}>
                                    <div style={{ fontSize: 11, color: S.muted, marginBottom: 2 }}>Изменение</div>
                                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700, color: log.delta > 0 ? '#16a34a' : log.delta < 0 ? '#dc2626' : S.muted }}>
                                        {log.delta > 0 ? '+' : ''}{log.delta}
                                    </div>
                                </div>
                            )}
                        </div>
                        {log.note && (
                            <div style={{ marginTop: 8, borderRadius: 8, padding: '10px 14px', background: '#f8fafc', border: `1px solid ${S.border}`, fontSize: 13, fontFamily: 'Inter', color: S.ink }}>
                                <span style={{ fontWeight: 600, color: S.sub, marginRight: 6 }}>Примечание:</span>{log.note}
                            </div>
                        )}
                    </section>
                )}

                {!isRedacted && diffKeys.length > 0 && (
                    <section>
                        <SectionTitle>Изменения полей</SectionTitle>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {diffKeys.map(k => (
                                <DiffRow key={k} label={k} before={log.before?.[k]} after={log.after?.[k]} />
                            ))}
                        </div>
                    </section>
                )}

                {isRedacted && (
                    <section>
                        <SectionTitle>Изменения</SectionTitle>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#f8fafc', border: `1px solid ${S.border}`, fontSize: 13, color: S.muted }}>
                            <Shield size={14} /> Детали скрыты политикой редактирования
                        </div>
                    </section>
                )}

                {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <section>
                        <SectionTitle>Метаданные</SectionTitle>
                        <pre style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: S.bg, borderRadius: 8, padding: 12, overflowX: 'auto', color: S.ink, whiteSpace: 'pre-wrap', border: `1px solid ${S.border}`, margin: 0 }}>
                            {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                    </section>
                )}

                {(log.requestId || log.correlationId) && (
                    <section>
                        <SectionTitle>Трассировка</SectionTitle>
                        <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: S.sub, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {log.requestId    && <div><span style={{ fontFamily: 'Inter', color: S.muted }}>requestId: </span>{log.requestId}</div>}
                            {log.correlationId && <div><span style={{ fontFamily: 'Inter', color: S.muted }}>correlationId: </span>{log.correlationId}</div>}
                        </div>
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
    const tenantId   = activeTenant?.id;
    const accessState = activeTenant?.accessState ?? '';
    const isReadOnly  = READ_ONLY_STATES.has(accessState);

    const [tab, setTab] = useState<Tab>('logs');

    const [logs, setLogs]         = useState<AuditLog[]>([]);
    const [logsMeta, setLogsMeta] = useState({ total: 0, page: 1, lastPage: 1, retentionDays: 180 });
    const [logsPage, setLogsPage] = useState(1);
    const [logsLoading, setLogsLoading] = useState(false);

    const [domain, setDomain]         = useState('');
    const [fromDate, setFromDate]     = useState('');
    const [toDate, setToDate]         = useState('');
    const [entityType, setEntityType] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    const [secEvents, setSecEvents]   = useState<SecurityEvent[]>([]);
    const [secMeta, setSecMeta]       = useState({ total: 0, page: 1, lastPage: 1 });
    const [secPage, setSecPage]       = useState(1);
    const [secLoading, setSecLoading] = useState(false);
    const [secEventType, setSecEventType] = useState('');

    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

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
        if (tab === 'logs') { const t = setTimeout(fetchLogs, 200); return () => clearTimeout(t); }
    }, [tab, fetchLogs]);

    useEffect(() => {
        if (tab === 'security') { const t = setTimeout(fetchSecEvents, 200); return () => clearTimeout(t); }
    }, [tab, fetchSecEvents]);

    useEffect(() => { setLogsPage(1); }, [domain, fromDate, toDate, entityType]);
    useEffect(() => { setSecPage(1); }, [secEventType]);

    const activeFilterCount = [domain, fromDate, toDate, entityType].filter(Boolean).length;

    return (
        <div style={{ paddingBottom: 48 }}>
            <PageHeader
                title="История изменений"
                subtitle={tab === 'logs' && logsMeta.retentionDays ? `Хранится ${logsMeta.retentionDays} дней` : undefined}
            />

            {isReadOnly && READ_ONLY_BANNER[accessState] && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontFamily: 'Inter', fontSize: 13, color: '#92400e' }}>
                    <AlertTriangle size={16} style={{ marginTop: 1, flexShrink: 0 }} />
                    <span>{READ_ONLY_BANNER[accessState]}</span>
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 4, borderRadius: 12, width: 'fit-content', marginBottom: 20 }}>
                {(['logs', 'security'] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontFamily: 'Inter', fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                        background: tab === t ? '#fff' : 'transparent',
                        color: tab === t ? S.ink : S.sub,
                        boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        {t === 'logs' ? 'Журнал' : <><Shield size={14} />Безопасность</>}
                    </button>
                ))}
            </div>

            <Card noPad>
                {/* Toolbar / Filters */}
                <div style={{ padding: '12px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {tab === 'logs' && (
                        <>
                            <button
                                onClick={() => setShowFilters(f => !f)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${S.border}`, background: showFilters ? '#eff6ff' : '#fff', cursor: 'pointer', fontFamily: 'Inter', fontSize: 13, color: showFilters ? S.blue : S.sub, transition: 'all 0.15s' }}
                            >
                                <Filter size={14} />
                                Фильтры
                                {activeFilterCount > 0 && (
                                    <span style={{ background: S.blue, color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 6px' }}>{activeFilterCount}</span>
                                )}
                            </button>
                            {showFilters && (
                                <>
                                    <HiSelect
                                        value={domain}
                                        onChange={setDomain}
                                        options={[{ value: '', label: 'Все домены' }, ...DOMAINS.map(d => ({ value: d, label: DOMAIN_LABELS[d] ?? d }))]}
                                    />
                                    <Input value={entityType} onChange={e => setEntityType(e.target.value)} placeholder="Тип: PRODUCT, USER…" style={{ width: 180 }} />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <FieldLabel>От</FieldLabel>
                                        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: 150 }} />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <FieldLabel>До</FieldLabel>
                                        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: 150 }} />
                                    </div>
                                    {activeFilterCount > 0 && (
                                        <Btn variant="ghost" size="sm" onClick={() => { setDomain(''); setFromDate(''); setToDate(''); setEntityType(''); }}>
                                            <X size={12} /> Сбросить
                                        </Btn>
                                    )}
                                </>
                            )}
                        </>
                    )}
                    {tab === 'security' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FieldLabel>Тип события</FieldLabel>
                            <HiSelect
                                value={secEventType}
                                onChange={setSecEventType}
                                options={[{ value: '', label: 'Все события' }, ...Object.entries(SEC_EVENT_LABELS).map(([k, v]) => ({ value: k, label: v }))]}
                            />
                        </div>
                    )}
                </div>

                {/* Table */}
                {tab === 'logs' ? (
                    logsLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            <Spinner /> Загрузка...
                        </div>
                    ) : logs.length === 0 ? (
                        <EmptyState icon={Clock} title="Записей не найдено" subtitle="Попробуйте изменить фильтры" />
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                                <col style={{ width: 120 }} />
                                <col style={{ width: '20%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '12%' }} />
                                <col />
                                <col style={{ width: 40 }} />
                            </colgroup>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                                    <th style={thSt}>Дата и время</th>
                                    <th style={thSt}>Автор</th>
                                    <th style={thSt}>Действие</th>
                                    <th style={thSt}>Товар</th>
                                    <th style={thSt}>Изменения</th>
                                    <th style={thSt} />
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr
                                        key={log.id}
                                        style={{ borderBottom: `1px solid ${S.border}`, cursor: 'pointer', transition: 'background 0.12s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        onClick={() => setSelectedLog(log)}
                                    >
                                        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                                            <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: S.ink }}>
                                                {format(new Date(log.createdAt), 'dd MMM', { locale: ru })}
                                            </div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                                                {format(new Date(log.createdAt), 'HH:mm:ss')}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                            {getActorCell(log)}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                            {getActionBadge(log)}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                            {getProductCell(log) ?? <span style={{ color: S.muted, fontSize: 13 }}>—</span>}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle', overflow: 'hidden' }}>
                                            {getChangeSummary(log) ?? <span style={{ color: S.muted, fontSize: 13 }}>—</span>}
                                        </td>
                                        <td style={{ padding: '0 12px', verticalAlign: 'middle', textAlign: 'center' }}>
                                            <ChevronRight size={15} color={S.muted} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    secLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            <Spinner /> Загрузка...
                        </div>
                    ) : secEvents.length === 0 ? (
                        <EmptyState icon={Shield} title="Событий не найдено" />
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                                <col style={{ width: 120 }} />
                                <col style={{ width: '22%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '14%' }} />
                                <col />
                            </colgroup>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                                    <th style={thSt}>Дата и время</th>
                                    <th style={thSt}>Событие</th>
                                    <th style={thSt}>Пользователь</th>
                                    <th style={thSt}>IP</th>
                                    <th style={thSt}>Браузер</th>
                                </tr>
                            </thead>
                            <tbody>
                                {secEvents.map(ev => (
                                    <tr
                                        key={ev.id}
                                        style={{ borderBottom: `1px solid ${S.border}`, transition: 'background 0.12s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                                            <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: S.ink }}>
                                                {format(new Date(ev.createdAt), 'dd MMM', { locale: ru })}
                                            </div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                                                {format(new Date(ev.createdAt), 'HH:mm:ss')}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                            {secEventBadge(ev.eventType)}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.sub }}>
                                            {ev.userId ? ev.userId.slice(-8) : '—'}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.sub }}>
                                            {ev.ip ?? '—'}
                                        </td>
                                        <td style={{ padding: '0 16px', verticalAlign: 'middle', fontFamily: 'Inter', fontSize: 12, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {ev.userAgent ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                )}

                {/* Pagination */}
                {(() => {
                    const meta    = tab === 'logs' ? logsMeta : secMeta;
                    const page    = tab === 'logs' ? logsPage : secPage;
                    const setPage = tab === 'logs' ? setLogsPage : setSecPage;
                    return <Pagination page={page} totalPages={meta.lastPage} onPage={setPage} total={meta.total} />;
                })()}
            </Card>

            {selectedLog && (
                <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(2px)' }} onClick={() => setSelectedLog(null)} />
                    <DetailPanel log={selectedLog} onClose={() => setSelectedLog(null)} />
                </>
            )}
        </div>
    );
}

function secEventBadge(eventType: string): React.ReactElement {
    const cfg =
        eventType === 'login_failed'  ? { color: '#dc2626', bg: 'rgba(239,68,68,0.08)' } :
        eventType === 'login_success' ? { color: '#16a34a', bg: 'rgba(16,185,129,0.08)' } :
        { color: S.sub, bg: '#f1f5f9' };
    return (
        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontFamily: 'Inter', fontSize: 12, fontWeight: 600, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
            {SEC_EVENT_LABELS[eventType] ?? eventType}
        </span>
    );
}
