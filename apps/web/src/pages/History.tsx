import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Shield, ChevronRight, X, AlertTriangle, Search, Filter, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auditApi, AuditLog, SecurityEvent, AuditLogFilters, SecurityEventFilters } from '../api/audit';

// ─── Constants ───────────────────────────────────────────────────────────────

const READ_ONLY_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

const DOMAIN_LABELS: Record<string, string> = {
    AUTH: 'Авторизация', SESSION: 'Сессия', PASSWORD: 'Пароль',
    TEAM: 'Команда', TENANT: 'Компания', CATALOG: 'Каталог',
    INVENTORY: 'Склад', MARKETPLACE: 'Маркетплейс', SYNC: 'Синхронизация',
    BILLING: 'Биллинг', SUPPORT: 'Поддержка', FINANCE: 'Финансы',
};

const DOMAIN_COLORS: Record<string, string> = {
    AUTH:        'bg-rose-100 text-rose-800',
    SESSION:     'bg-red-100 text-red-800',
    PASSWORD:    'bg-pink-100 text-pink-800',
    TEAM:        'bg-violet-100 text-violet-800',
    TENANT:      'bg-blue-100 text-blue-800',
    CATALOG:     'bg-cyan-100 text-cyan-800',
    INVENTORY:   'bg-emerald-100 text-emerald-800',
    MARKETPLACE: 'bg-orange-100 text-orange-800',
    SYNC:        'bg-amber-100 text-amber-800',
    BILLING:     'bg-yellow-100 text-yellow-800',
    SUPPORT:     'bg-slate-100 text-slate-700',
    FINANCE:     'bg-teal-100 text-teal-800',
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
    MARKETPLACE_MAPPING_CREATED: 'Маппинг добавлен', MARKETPLACE_MAPPING_DELETED: 'Маппинг удалён',
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
    // Legacy
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

function getDomainBadge(domain: string | null): JSX.Element | null {
    if (!domain) return null;
    const color = DOMAIN_COLORS[domain] ?? 'bg-slate-100 text-slate-600';
    return (
        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${color}`}>
            {DOMAIN_LABELS[domain] ?? domain}
        </span>
    );
}

// ─── Before/After Diff ───────────────────────────────────────────────────────

function DiffView({ before, after, changedFields }: {
    before: Record<string, unknown> | null;
    after:  Record<string, unknown> | null;
    changedFields: string[] | null;
}) {
    if (!before && !after) return <p className="text-xs text-slate-400 italic">Нет данных об изменениях</p>;

    const keys = changedFields?.length
        ? changedFields
        : [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

    if (keys.length === 0) return <p className="text-xs text-slate-400 italic">Изменений не зафиксировано</p>;

    return (
        <div className="space-y-1.5">
            {keys.map(key => {
                const bv = before?.[key];
                const av = after?.[key];
                const changed = JSON.stringify(bv) !== JSON.stringify(av);
                return (
                    <div key={key} className={`rounded-lg p-2 text-xs font-mono ${changed ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                        <span className="text-slate-500 font-sans font-medium">{key}: </span>
                        {before && bv !== undefined && (
                            <span className="line-through text-red-500 mr-1">{JSON.stringify(bv)}</span>
                        )}
                        {after && av !== undefined && (
                            <span className="text-emerald-700">{JSON.stringify(av)}</span>
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
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
                <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Детали события</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{getEventLabel(log)}</p>
                </div>
                <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-slate-600" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Meta */}
                <section>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Контекст</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {log.eventDomain && (
                            <>
                                <dt className="text-slate-500">Домен</dt>
                                <dd>{getDomainBadge(log.eventDomain)}</dd>
                            </>
                        )}
                        {log.entityType && (
                            <>
                                <dt className="text-slate-500">Тип сущности</dt>
                                <dd className="font-mono text-xs text-slate-800">{log.entityType}</dd>
                            </>
                        )}
                        {log.entityId && (
                            <>
                                <dt className="text-slate-500">ID сущности</dt>
                                <dd className="font-mono text-xs text-slate-600 truncate">{log.entityId}</dd>
                            </>
                        )}
                        <dt className="text-slate-500">Исполнитель</dt>
                        <dd className="text-slate-800">
                            {ACTOR_TYPE_LABELS[log.actorType ?? ''] ?? log.actorType ?? '—'}
                            {log.actorRole && <span className="text-slate-400 ml-1 text-xs">({log.actorRole})</span>}
                        </dd>
                        {log.source && (
                            <>
                                <dt className="text-slate-500">Источник</dt>
                                <dd className="text-slate-800">{SOURCE_LABELS[log.source] ?? log.source}</dd>
                            </>
                        )}
                        <dt className="text-slate-500">Время</dt>
                        <dd className="text-slate-800">{format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm:ss', { locale: ru })}</dd>
                    </dl>
                </section>

                {/* Correlation */}
                {(log.requestId || log.correlationId) && (
                    <section>
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Трассировка</h3>
                        <dl className="space-y-1.5 text-xs font-mono">
                            {log.requestId && (
                                <div>
                                    <span className="text-slate-500 font-sans">requestId: </span>
                                    <span className="text-slate-700">{log.requestId}</span>
                                </div>
                            )}
                            {log.correlationId && (
                                <div>
                                    <span className="text-slate-500 font-sans">correlationId: </span>
                                    <span className="text-slate-700">{log.correlationId}</span>
                                </div>
                            )}
                        </dl>
                    </section>
                )}

                {/* Changes */}
                <section>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Изменения</h3>
                    {isRedacted ? (
                        <p className="text-xs text-slate-400 italic flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5" /> Детали скрыты политикой редактирования
                        </p>
                    ) : (
                        <>
                            {log.changedFields && log.changedFields.length > 0 && (
                                <div className="mb-3">
                                    <p className="text-xs text-slate-500 mb-1.5">Изменённые поля:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {log.changedFields.map(f => (
                                            <span key={f} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-mono rounded">{f}</span>
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
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Изменения (устаревший формат)</h3>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                            {log.productSku && (<><dt className="text-slate-500">SKU</dt><dd className="font-medium">{log.productSku}</dd></>)}
                            {log.beforeTotal != null && (<><dt className="text-slate-500">Было</dt><dd>{log.beforeTotal}</dd></>)}
                            {log.afterTotal != null && (<><dt className="text-slate-500">Стало</dt><dd className="font-semibold">{log.afterTotal}</dd></>)}
                            {log.delta != null && (<><dt className="text-slate-500">Δ</dt><dd className={log.delta > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{log.delta > 0 ? '+' : ''}{log.delta}</dd></>)}
                            {log.note && (<><dt className="text-slate-500">Примечание</dt><dd className="text-slate-700">{log.note}</dd></>)}
                        </dl>
                    </section>
                )}

                {/* Metadata */}
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <section>
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Метаданные</h3>
                        <pre className="text-xs font-mono bg-slate-50 rounded-lg p-3 overflow-x-auto text-slate-700 whitespace-pre-wrap">
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

    const renderLogRow = (log: AuditLog) => (
        <tr
            key={log.id}
            className="hover:bg-blue-50/40 transition-colors cursor-pointer"
            onClick={() => setSelectedLog(log)}
        >
            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                {format(new Date(log.createdAt), 'dd MMM, HH:mm', { locale: ru })}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
                {getDomainBadge(log.eventDomain)}
            </td>
            <td className="px-4 py-3 text-xs font-medium text-slate-800 max-w-[180px] truncate">
                {getEventLabel(log)}
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-xs text-slate-500 max-w-[120px] truncate">
                {log.entityType
                    ? <span>{log.entityType}{log.entityId && <span className="text-slate-400 ml-1">#{log.entityId.slice(-6)}</span>}</span>
                    : log.productSku
                        ? <span className="font-mono">{log.productSku}</span>
                        : <span className="text-slate-300">—</span>
                }
            </td>
            <td className="hidden md:table-cell px-4 py-3 text-xs text-slate-500">
                {log.actorType ? (ACTOR_TYPE_LABELS[log.actorType] ?? log.actorType) : (log.actorEmail ?? '—')}
            </td>
            <td className="px-4 py-3 text-right">
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto" />
            </td>
        </tr>
    );

    const renderSecRow = (ev: SecurityEvent) => (
        <tr key={ev.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                {format(new Date(ev.createdAt), 'dd MMM, HH:mm', { locale: ru })}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                    ev.eventType === 'login_failed' ? 'bg-red-100 text-red-700' :
                    ev.eventType === 'login_success' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-slate-100 text-slate-600'
                }`}>
                    {SEC_EVENT_LABELS[ev.eventType] ?? ev.eventType}
                </span>
            </td>
            <td className="hidden sm:table-cell px-4 py-3 text-xs text-slate-500 font-mono">
                {ev.userId ? ev.userId.slice(-8) : '—'}
            </td>
            <td className="hidden md:table-cell px-4 py-3 text-xs text-slate-500 font-mono">
                {ev.ip ?? '—'}
            </td>
            <td className="hidden lg:table-cell px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">
                {ev.userAgent ?? '—'}
            </td>
        </tr>
    );

    // ── Layout ────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-5 animate-fade-in pb-12">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">История изменений</h1>
                {tab === 'logs' && logsMeta.retentionDays && (
                    <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5" /> Хранится {logsMeta.retentionDays} дней
                    </span>
                )}
            </div>

            {/* Read-only banner */}
            {isReadOnly && READ_ONLY_BANNER[accessState] && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{READ_ONLY_BANNER[accessState]}</span>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                {(['logs', 'security'] as Tab[]).map(t => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                            tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {t === 'logs' ? 'Журнал' : (
                            <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />Security</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Filters for logs tab */}
            {tab === 'logs' && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => setShowFilters(f => !f)}
                    >
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <Filter className="w-4 h-4 text-slate-400" />
                            Фильтры
                            {(domain || fromDate || toDate || entityType) && (
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-semibold">
                                    {[domain, fromDate, toDate, entityType].filter(Boolean).length}
                                </span>
                            )}
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${showFilters ? 'rotate-90' : ''}`} />
                    </div>

                    {showFilters && (
                        <div className="px-4 pb-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Домен</label>
                                <select
                                    value={domain}
                                    onChange={e => setDomain(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="">Все домены</option>
                                    {DOMAINS.map(d => (
                                        <option key={d} value={d}>{DOMAIN_LABELS[d] ?? d}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Тип сущности</label>
                                <input
                                    type="text"
                                    placeholder="PRODUCT, USER..."
                                    value={entityType}
                                    onChange={e => setEntityType(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">От</label>
                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={e => setFromDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">До</label>
                                <input
                                    type="date"
                                    value={toDate}
                                    onChange={e => setToDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            {(domain || fromDate || toDate || entityType) && (
                                <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                                    <button
                                        onClick={() => { setDomain(''); setFromDate(''); setToDate(''); setEntityType(''); }}
                                        className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                                    >
                                        <X className="w-3 h-3" /> Сбросить фильтры
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Security events filter */}
            {tab === 'security' && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
                    <div className="flex items-center gap-3">
                        <Search className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={secEventType}
                            onChange={e => setSecEventType(e.target.value)}
                            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">Все события</option>
                            {Object.entries(SEC_EVENT_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    {tab === 'logs' ? (
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Время</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Домен</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Событие</th>
                                    <th className="hidden sm:table-cell px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Сущность</th>
                                    <th className="hidden md:table-cell px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Исполнитель</th>
                                    <th className="px-4 py-3 w-8" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {logsLoading ? (
                                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">Загрузка...</td></tr>
                                ) : logs.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-sm">Записей не найдено</td></tr>
                                ) : (
                                    logs.map(renderLogRow)
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="min-w-full divide-y divide-slate-100">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Время</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Событие</th>
                                    <th className="hidden sm:table-cell px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Пользователь</th>
                                    <th className="hidden md:table-cell px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">IP</th>
                                    <th className="hidden lg:table-cell px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">User Agent</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {secLoading ? (
                                    <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">Загрузка...</td></tr>
                                ) : secEvents.length === 0 ? (
                                    <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">Событий не найдено</td></tr>
                                ) : (
                                    secEvents.map(renderSecRow)
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Pagination */}
                {(() => {
                    const meta   = tab === 'logs' ? logsMeta : secMeta;
                    const page   = tab === 'logs' ? logsPage : secPage;
                    const setPage = tab === 'logs' ? setLogsPage : setSecPage;
                    return (
                        <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                            <button
                                disabled={page === 1}
                                onClick={() => setPage(p => p - 1)}
                                className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Назад
                            </button>
                            <span className="text-sm text-slate-600">
                                Стр. <span className="font-semibold">{page}</span> / <span className="font-semibold">{meta.lastPage}</span>
                                <span className="ml-2 text-slate-400 text-xs">({meta.total} записей)</span>
                            </span>
                            <button
                                disabled={page >= meta.lastPage}
                                onClick={() => setPage(p => p + 1)}
                                className="px-4 py-2 border border-slate-300 text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Вперёд
                            </button>
                        </div>
                    );
                })()}
            </div>

            {/* Detail panel overlay */}
            {selectedLog && (
                <>
                    <div
                        className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
                        onClick={() => setSelectedLog(null)}
                    />
                    <DetailPanel log={selectedLog} onClose={() => setSelectedLog(null)} />
                </>
            )}
        </div>
    );
}
