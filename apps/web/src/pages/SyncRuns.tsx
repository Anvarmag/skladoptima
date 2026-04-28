import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    RefreshCw, AlertCircle, CheckCircle2, XCircle, PauseCircle,
    Clock, Loader2, ChevronRight, ArrowLeft, RotateCcw, AlertTriangle,
    Plus, Lock, FileText, ListTree,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────── types ───────────────────────────────

const EXTERNAL_API_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

type SyncRunStatus = 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
type TriggerType = 'MANUAL' | 'SCHEDULED' | 'RETRY';
type TriggerScope = 'ACCOUNT' | 'TENANT_FULL';

interface SyncRunRow {
    id: string;
    tenantId: string;
    accountId: string | null;
    triggerType: TriggerType;
    triggerScope: TriggerScope;
    syncTypes: string[];
    status: SyncRunStatus;
    originRunId: string | null;
    requestedBy: string | null;
    blockedReason: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    processedCount: number;
    errorCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    attemptNumber: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    createdAt: string;
    updatedAt: string;
}

interface SyncRunItemRow {
    id: string;
    itemType: 'STOCK' | 'ORDER' | 'PRODUCT' | 'WAREHOUSE';
    itemKey: string;
    stage: 'PREFLIGHT' | 'PULL' | 'TRANSFORM' | 'APPLY' | 'PUSH';
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CONFLICT' | 'BLOCKED';
    externalEventId: string | null;
    payload: any;
    error: any;
    createdAt: string;
}

interface SyncConflictRow {
    id: string;
    runId: string;
    entityType: string;
    entityId: string | null;
    conflictType: string;
    payload: any;
    resolvedAt: string | null;
    createdAt: string;
}

interface SyncRunDetail extends SyncRunRow {
    originRun: { id: string; status: SyncRunStatus; attemptNumber: number } | null;
    items: SyncRunItemRow[];
    conflicts: SyncConflictRow[];
}

interface AccountOption {
    id: string;
    label: string;
    marketplace: 'WB' | 'OZON';
    lifecycleStatus: 'ACTIVE' | 'INACTIVE';
}

// ─────────────────────────────── helpers ─────────────────────────────

const STATUS_LABEL: Record<SyncRunStatus, string> = {
    QUEUED: 'В очереди',
    IN_PROGRESS: 'Выполняется',
    SUCCESS: 'Успешно',
    PARTIAL_SUCCESS: 'Частично',
    FAILED: 'Ошибка',
    BLOCKED: 'Заблокирован',
    CANCELLED: 'Отменён',
};

const STATUS_TONE: Record<SyncRunStatus, string> = {
    QUEUED: 'bg-slate-100 text-slate-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-800',
    SUCCESS: 'bg-emerald-100 text-emerald-800',
    PARTIAL_SUCCESS: 'bg-amber-100 text-amber-800',
    FAILED: 'bg-red-100 text-red-800',
    BLOCKED: 'bg-violet-100 text-violet-800',
    CANCELLED: 'bg-slate-200 text-slate-700',
};

// ВАЖНО §10/§20: blocked ≠ failed. Иконка и тон — разные.
const STATUS_ICON: Record<SyncRunStatus, any> = {
    QUEUED: Clock,
    IN_PROGRESS: Loader2,
    SUCCESS: CheckCircle2,
    PARTIAL_SUCCESS: AlertTriangle,
    FAILED: XCircle,
    BLOCKED: PauseCircle,
    CANCELLED: PauseCircle,
};

const TRIGGER_LABEL: Record<TriggerType, string> = {
    MANUAL: 'Ручной',
    SCHEDULED: 'Авто',
    RETRY: 'Повтор',
};

// Машинные коды → человеческий текст. UX-критичный словарь:
// пользователь должен сразу понять, что произошло и что делать.
const BLOCKED_REASON_TEXT: Record<string, { title: string; hint: string }> = {
    TENANT_TRIAL_EXPIRED: {
        title: 'Пробный период истёк',
        hint: 'Оформите подписку — синхронизация возобновится автоматически.',
    },
    TENANT_SUSPENDED: {
        title: 'Доступ приостановлен',
        hint: 'Обратитесь в службу поддержки.',
    },
    TENANT_CLOSED: {
        title: 'Компания закрыта',
        hint: 'Доступ к синхронизации недоступен.',
    },
    ACCOUNT_INACTIVE: {
        title: 'Подключение отключено',
        hint: 'Активируйте подключение в разделе «Подключения».',
    },
    CREDENTIALS_INVALID: {
        title: 'Ключи недействительны',
        hint: 'Обновите API-ключи в разделе «Подключения».',
    },
    CREDENTIALS_NEEDS_RECONNECT: {
        title: 'Требуется переподключение',
        hint: 'Перевыпустите токен у маркетплейса и обновите его в подключении.',
    },
    CONCURRENCY_GUARD: {
        title: 'Уже выполняется другой sync',
        hint: 'Дождитесь завершения текущего запуска и попробуйте снова.',
    },
};

const ERROR_CODE_TEXT: Record<string, string> = {
    EXTERNAL_RATE_LIMIT: 'Маркетплейс ограничил частоту запросов. Повтор будет автоматически.',
    EXTERNAL_AUTH_FAILED: 'Маркетплейс отклонил ключи (401/403). Обновите API-ключи.',
    EXTERNAL_TIMEOUT: 'Таймаут запроса к маркетплейсу. Повтор будет автоматически.',
    EXTERNAL_5XX: 'Сервер маркетплейса временно недоступен (5xx). Повтор будет автоматически.',
    SYNC_STAGE_FAILED: 'Этап синхронизации завершился с ошибкой.',
    INTERNAL_ERROR: 'Внутренняя ошибка. Если повторяется — обратитесь в поддержку.',
};

const SYNC_TYPE_LABEL: Record<string, string> = {
    PULL_STOCKS: 'Получение остатков',
    PUSH_STOCKS: 'Отправка остатков',
    PULL_ORDERS: 'Получение заказов',
    PULL_METADATA: 'Карточки товаров',
    FULL_SYNC: 'Полная синхронизация',
};

const STAGE_LABEL: Record<string, string> = {
    PREFLIGHT: 'Проверка',
    PULL: 'Загрузка',
    TRANSFORM: 'Обработка',
    APPLY: 'Применение',
    PUSH: 'Отправка',
};

const ITEM_TYPE_LABEL: Record<string, string> = {
    STOCK: 'Остаток',
    ORDER: 'Заказ',
    PRODUCT: 'Товар',
    WAREHOUSE: 'Склад',
};

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
}

function formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms} мс`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} с`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m} мин ${sec} с`;
}

// ─────────────────────────────── component ───────────────────────────

export default function SyncRuns() {
    const { activeTenant } = useAuth();
    const accessState = activeTenant?.accessState;
    const externalBlocked = useMemo(
        () => (accessState ? EXTERNAL_API_BLOCKED_STATES.includes(accessState) : false),
        [accessState],
    );
    const role = activeTenant?.role;
    const canTriggerSync = role === 'OWNER' || role === 'ADMIN';

    // ─── runs list state
    const [runs, setRuns] = useState<SyncRunRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [filterStatus, setFilterStatus] = useState<SyncRunStatus | ''>('');
    const [filterAccount, setFilterAccount] = useState<string>('');
    const [page, setPage] = useState(1);
    const [meta, setMeta] = useState<{ total: number; page: number; limit: number; lastPage: number }>({
        total: 0, page: 1, limit: 20, lastPage: 1,
    });

    // ─── detail
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<SyncRunDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // ─── manual sync modal
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [createAccountId, setCreateAccountId] = useState<string>('');
    const [createTypes, setCreateTypes] = useState<string[]>(['PULL_STOCKS', 'PULL_ORDERS']);
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // ─── conflicts tab
    const [activeTab, setActiveTab] = useState<'runs' | 'conflicts'>('runs');
    const [conflicts, setConflicts] = useState<SyncConflictRow[]>([]);
    const [conflictsLoading, setConflictsLoading] = useState(false);
    const [conflictsFilter, setConflictsFilter] = useState<'open' | 'resolved' | 'all'>('open');
    const [topMessage, setTopMessage] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

    const loadRuns = useCallback(async () => {
        setLoading(true);
        try {
            const params: any = { page, limit: 20 };
            if (filterStatus) params.status = filterStatus;
            if (filterAccount) params.accountId = filterAccount;
            const res = await axios.get('/sync/runs', { params });
            setRuns(res.data.data ?? []);
            setMeta(res.data.meta ?? { total: 0, page: 1, limit: 20, lastPage: 1 });
        } catch {
            setTopMessage({ kind: 'err', text: 'Не удалось загрузить историю синхронизаций.' });
        } finally {
            setLoading(false);
        }
    }, [page, filterStatus, filterAccount]);

    const loadAccounts = useCallback(async () => {
        try {
            const res = await axios.get('/marketplace-accounts', {
                params: { lifecycleStatus: 'ACTIVE' },
            });
            setAccounts(res.data ?? []);
        } catch {
            // не критично
        }
    }, []);

    const loadConflicts = useCallback(async () => {
        setConflictsLoading(true);
        try {
            const res = await axios.get('/sync/conflicts', { params: { status: conflictsFilter, limit: 50 } });
            setConflicts(res.data.data ?? []);
        } catch {
            setTopMessage({ kind: 'err', text: 'Не удалось загрузить конфликты.' });
        } finally {
            setConflictsLoading(false);
        }
    }, [conflictsFilter]);

    useEffect(() => { loadRuns(); }, [loadRuns]);
    useEffect(() => { loadAccounts(); }, [loadAccounts]);
    useEffect(() => {
        if (activeTab === 'conflicts') loadConflicts();
    }, [activeTab, loadConflicts]);

    const openDetail = useCallback(async (id: string) => {
        setSelectedId(id);
        setDetail(null);
        setDetailLoading(true);
        try {
            const res = await axios.get(`/sync/runs/${id}`);
            setDetail(res.data);
        } catch {
            setTopMessage({ kind: 'err', text: 'Не удалось загрузить детали запуска.' });
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const submitCreateRun = useCallback(async () => {
        if (!createAccountId) {
            setCreateError('Выберите подключение.');
            return;
        }
        if (createTypes.length === 0) {
            setCreateError('Выберите хотя бы один тип синхронизации.');
            return;
        }
        setCreateError(null);
        setCreateSubmitting(true);
        try {
            const res = await axios.post('/sync/runs', {
                accountId: createAccountId,
                syncTypes: createTypes,
            });
            setShowCreate(false);
            setTopMessage({
                kind: res.data.status === 'BLOCKED' ? 'warn' : 'ok',
                text: res.data.status === 'BLOCKED'
                    ? `Запуск зафиксирован как заблокированный: ${BLOCKED_REASON_TEXT[res.data.blockedReason]?.title ?? res.data.blockedReason}`
                    : 'Синхронизация поставлена в очередь.',
            });
            await loadRuns();
            // Сразу открыть карточку нового run.
            await openDetail(res.data.id);
        } catch (e: any) {
            const code = e?.response?.data?.code;
            if (code === 'MARKETPLACE_ACCOUNT_NOT_FOUND') {
                setCreateError('Подключение не найдено.');
            } else {
                setCreateError(e?.response?.data?.message ?? 'Не удалось создать запуск.');
            }
        } finally {
            setCreateSubmitting(false);
        }
    }, [createAccountId, createTypes, loadRuns, openDetail]);

    const submitRetry = useCallback(async (id: string) => {
        try {
            const res = await axios.post(`/sync/runs/${id}/retry`);
            setTopMessage({ kind: 'ok', text: `Создан повторный запуск (попытка ${res.data.attemptNumber} из ${res.data.maxAttempts}).` });
            await loadRuns();
            await openDetail(res.data.id);
        } catch (e: any) {
            const code = e?.response?.data?.code;
            const map: Record<string, string> = {
                SYNC_RUN_RETRY_NOT_APPLICABLE: 'Этот запуск нельзя повторить — статус не допускает retry.',
                SYNC_RUN_RETRY_EXHAUSTED: 'Достигнут лимит попыток. Создайте новый запуск с актуальными настройками.',
                SYNC_RUN_NOT_TERMINAL: 'Запуск ещё активен. Дождитесь его завершения.',
                SYNC_RUN_CONCURRENCY_CONFLICT: 'По этому подключению уже идёт синхронизация.',
            };
            setTopMessage({ kind: 'err', text: map[code] ?? 'Не удалось повторить запуск.' });
        }
    }, [loadRuns, openDetail]);

    const submitResolveConflict = useCallback(async (id: string) => {
        try {
            await axios.post(`/sync/conflicts/${id}/resolve`);
            setTopMessage({ kind: 'ok', text: 'Конфликт закрыт.' });
            await loadConflicts();
        } catch {
            setTopMessage({ kind: 'err', text: 'Не удалось закрыть конфликт.' });
        }
    }, [loadConflicts]);

    const accountLabel = useCallback((id: string | null) => {
        if (!id) return '—';
        const acc = accounts.find((a) => a.id === id);
        return acc ? `${acc.label} (${acc.marketplace})` : id.slice(0, 8) + '…';
    }, [accounts]);

    // ───────────────────────── render: detail view ─────────────────────────

    if (selectedId) {
        return (
            <div className="space-y-4">
                <button
                    onClick={() => { setSelectedId(null); setDetail(null); }}
                    className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    К истории запусков
                </button>

                {detailLoading && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 flex items-center text-slate-500 text-sm">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка деталей…
                    </div>
                )}

                {detail && <RunDetailView
                    run={detail}
                    accountLabel={accountLabel}
                    onRetry={submitRetry}
                    canRetry={canTriggerSync && !externalBlocked}
                    externalBlocked={externalBlocked}
                />}
            </div>
        );
    }

    // ───────────────────────── render: list view ─────────────────────────

    return (
        <div className="space-y-4">
            {topMessage && (
                <div className={`rounded-md border px-4 py-3 text-sm ${
                    topMessage.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                    topMessage.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                    'bg-red-50 border-red-200 text-red-800'
                }`}>
                    <button onClick={() => setTopMessage(null)} className="float-right text-xs">×</button>
                    {topMessage.text}
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Синхронизация</h1>
                    <p className="text-sm text-slate-500 mt-1">История запусков, ошибки и конфликты по подключённым маркетплейсам.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadRuns}
                        className="inline-flex items-center px-3 py-2 text-sm border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
                    >
                        <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                        Обновить
                    </button>
                    {canTriggerSync && (
                        <button
                            onClick={() => { setShowCreate(true); setCreateError(null); }}
                            disabled={externalBlocked}
                            title={externalBlocked ? 'Запуск синхронизации недоступен в текущем тарифном статусе' : ''}
                            className="inline-flex items-center px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            {externalBlocked ? <Lock className="h-4 w-4 mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                            Запустить sync
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200">
                <nav className="flex gap-6 -mb-px">
                    <button
                        onClick={() => setActiveTab('runs')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 ${
                            activeTab === 'runs' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <ListTree className="h-4 w-4 inline mr-1.5" />
                        История запусков
                    </button>
                    <button
                        onClick={() => setActiveTab('conflicts')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 ${
                            activeTab === 'conflicts' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <AlertCircle className="h-4 w-4 inline mr-1.5" />
                        Конфликты
                    </button>
                </nav>
            </div>

            {activeTab === 'runs' && (
                <>
                    {/* Filters */}
                    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Статус</label>
                            <select
                                value={filterStatus}
                                onChange={(e) => { setFilterStatus(e.target.value as any); setPage(1); }}
                                className="text-sm border border-slate-300 rounded px-3 py-1.5"
                            >
                                <option value="">Все</option>
                                {(Object.keys(STATUS_LABEL) as SyncRunStatus[]).map((s) => (
                                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Подключение</label>
                            <select
                                value={filterAccount}
                                onChange={(e) => { setFilterAccount(e.target.value); setPage(1); }}
                                className="text-sm border border-slate-300 rounded px-3 py-1.5"
                            >
                                <option value="">Все</option>
                                {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>{a.label} ({a.marketplace})</option>
                                ))}
                            </select>
                        </div>
                        <div className="ml-auto text-xs text-slate-500">
                            Всего: {meta.total}
                        </div>
                    </div>

                    {/* List */}
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        {loading ? (
                            <div className="p-12 flex items-center justify-center text-slate-500 text-sm">
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка…
                            </div>
                        ) : runs.length === 0 ? (
                            <div className="p-12 text-center text-slate-500 text-sm">
                                История пуста. Запустите первую синхронизацию или дождитесь автоматического запуска.
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-200">
                                {runs.map((run) => (
                                    <RunListItem
                                        key={run.id}
                                        run={run}
                                        accountLabel={accountLabel(run.accountId)}
                                        onClick={() => openDetail(run.id)}
                                    />
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Pagination */}
                    {meta.lastPage > 1 && (
                        <div className="flex items-center justify-center gap-2 text-sm">
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage(page - 1)}
                                className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                            >
                                Назад
                            </button>
                            <span className="text-slate-600">Стр. {meta.page} из {meta.lastPage}</span>
                            <button
                                disabled={page >= meta.lastPage}
                                onClick={() => setPage(page + 1)}
                                className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                            >
                                Вперёд
                            </button>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'conflicts' && (
                <ConflictsTabView
                    conflicts={conflicts}
                    loading={conflictsLoading}
                    filter={conflictsFilter}
                    onFilterChange={setConflictsFilter}
                    onResolve={submitResolveConflict}
                    onOpenRun={openDetail}
                    accountLabel={accountLabel}
                    canResolve={canTriggerSync || role === 'MANAGER'}
                />
            )}

            {/* Create modal */}
            {showCreate && (
                <CreateRunModal
                    accounts={accounts.filter((a) => a.lifecycleStatus === 'ACTIVE')}
                    accountId={createAccountId}
                    setAccountId={setCreateAccountId}
                    types={createTypes}
                    setTypes={setCreateTypes}
                    error={createError}
                    submitting={createSubmitting}
                    onClose={() => setShowCreate(false)}
                    onSubmit={submitCreateRun}
                />
            )}
        </div>
    );
}

// ─────────────────────────────── subcomponents ─────────────────────────

function StatusBadge({ status }: { status: SyncRunStatus }) {
    const Icon = STATUS_ICON[status];
    const animated = status === 'IN_PROGRESS' ? 'animate-spin' : '';
    return (
        <span className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded ${STATUS_TONE[status]}`}>
            <Icon className={`h-3 w-3 mr-1 ${animated}`} />
            {STATUS_LABEL[status]}
        </span>
    );
}

function RunListItem({ run, accountLabel, onClick }: {
    run: SyncRunRow;
    accountLabel: string;
    onClick: () => void;
}) {
    return (
        <li>
            <button
                onClick={onClick}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex items-center gap-4"
            >
                <div className="flex-shrink-0">
                    <StatusBadge status={run.status} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-slate-900 truncate">{accountLabel}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600">{TRIGGER_LABEL[run.triggerType]}</span>
                        {run.attemptNumber > 1 && (
                            <span className="text-xs text-slate-500">(попытка {run.attemptNumber}/{run.maxAttempts})</span>
                        )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {run.syncTypes.map((t) => SYNC_TYPE_LABEL[t] ?? t).join(', ') || '—'}
                    </div>
                    {run.status === 'BLOCKED' && run.blockedReason && (
                        <div className="text-xs text-violet-700 mt-1">
                            <Lock className="h-3 w-3 inline mr-1" />
                            {BLOCKED_REASON_TEXT[run.blockedReason]?.title ?? run.blockedReason}
                        </div>
                    )}
                    {run.status === 'FAILED' && run.errorCode && (
                        <div className="text-xs text-red-700 mt-1">
                            <AlertCircle className="h-3 w-3 inline mr-1" />
                            {ERROR_CODE_TEXT[run.errorCode] ?? run.errorCode}
                        </div>
                    )}
                    {run.status === 'PARTIAL_SUCCESS' && (
                        <div className="text-xs text-amber-700 mt-1">
                            Обработано {run.processedCount}, ошибок {run.errorCount}
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-slate-500">{formatDateTime(run.createdAt)}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{formatDuration(run.durationMs)}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
            </button>
        </li>
    );
}

function RunDetailView({ run, accountLabel, onRetry, canRetry, externalBlocked }: {
    run: SyncRunDetail;
    accountLabel: (id: string | null) => string;
    onRetry: (id: string) => void;
    canRetry: boolean;
    externalBlocked: boolean;
}) {
    const isRetryEligible = (run.status === 'FAILED' || run.status === 'PARTIAL_SUCCESS') && run.attemptNumber < run.maxAttempts;
    const blockedHint = run.blockedReason ? BLOCKED_REASON_TEXT[run.blockedReason] : null;
    const errorHint = run.errorCode ? ERROR_CODE_TEXT[run.errorCode] : null;

    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                            <StatusBadge status={run.status} />
                            <span className="text-xs text-slate-500">{TRIGGER_LABEL[run.triggerType]}</span>
                            {run.originRunId && (
                                <span className="text-xs text-slate-500">
                                    · попытка {run.attemptNumber} из {run.maxAttempts}
                                </span>
                            )}
                        </div>
                        <h2 className="text-lg font-semibold text-slate-900 truncate">
                            {accountLabel(run.accountId)}
                        </h2>
                        <div className="text-sm text-slate-500 mt-1">
                            {run.syncTypes.map((t) => SYNC_TYPE_LABEL[t] ?? t).join(', ') || '—'}
                        </div>
                    </div>
                    <div className="flex-shrink-0">
                        {isRetryEligible && (
                            <button
                                onClick={() => onRetry(run.id)}
                                disabled={!canRetry}
                                title={!canRetry ? (externalBlocked ? 'Повтор недоступен в текущем тарифном статусе' : 'Недостаточно прав') : ''}
                                className="inline-flex items-center px-3 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                            >
                                {!canRetry ? <Lock className="h-4 w-4 mr-1.5" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
                                Повторить
                            </button>
                        )}
                    </div>
                </div>

                {/* BLOCKED block — UX-критично: явно отделено от FAILED */}
                {run.status === 'BLOCKED' && blockedHint && (
                    <div className="mt-4 bg-violet-50 border border-violet-200 rounded-md p-4">
                        <div className="flex items-start gap-2">
                            <PauseCircle className="h-4 w-4 text-violet-700 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-sm font-medium text-violet-900">{blockedHint.title}</div>
                                <div className="text-xs text-violet-700 mt-1">{blockedHint.hint}</div>
                                <div className="text-xs text-violet-600 mt-2 font-mono">{run.blockedReason}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* FAILED block */}
                {run.status === 'FAILED' && (
                    <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-4">
                        <div className="flex items-start gap-2">
                            <XCircle className="h-4 w-4 text-red-700 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-sm font-medium text-red-900">Запуск завершился с ошибкой</div>
                                {errorHint && <div className="text-xs text-red-700 mt-1">{errorHint}</div>}
                                {run.errorCode && <div className="text-xs text-red-600 mt-2 font-mono">{run.errorCode}</div>}
                                {run.errorMessage && (
                                    <div className="text-xs text-red-600 mt-1 font-mono break-all">{run.errorMessage}</div>
                                )}
                                {run.nextAttemptAt && (
                                    <div className="text-xs text-red-700 mt-2">
                                        <Clock className="h-3 w-3 inline mr-1" />
                                        Автоповтор: {formatDateTime(run.nextAttemptAt)}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* PARTIAL_SUCCESS */}
                {run.status === 'PARTIAL_SUCCESS' && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-4">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 flex-shrink-0" />
                            <div className="text-sm text-amber-900">
                                Часть элементов не была обработана. Подробности — в списке ниже.
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard label="Создан" value={formatDateTime(run.createdAt)} />
                <SummaryCard label="Длительность" value={formatDuration(run.durationMs)} />
                <SummaryCard label="Обработано" value={String(run.processedCount)} />
                <SummaryCard label="Ошибок" value={String(run.errorCount)} tone={run.errorCount > 0 ? 'warn' : undefined} />
            </div>

            {run.originRun && (
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-600">
                    Этот запуск — повтор run <span className="font-mono">{run.originRun.id.slice(0, 8)}</span> (статус: {STATUS_LABEL[run.originRun.status]}).
                </div>
            )}

            {/* Items */}
            {run.items.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
                        Проблемные элементы ({run.items.length})
                    </div>
                    <ul className="divide-y divide-slate-200">
                        {run.items.map((item) => (
                            <li key={item.id} className="px-4 py-3 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                        item.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                                        item.status === 'CONFLICT' ? 'bg-amber-100 text-amber-800' :
                                        'bg-violet-100 text-violet-800'
                                    }`}>{item.status}</span>
                                    <span className="text-xs text-slate-500">{STAGE_LABEL[item.stage]}</span>
                                    <span className="text-xs text-slate-400">·</span>
                                    <span className="text-xs text-slate-600">{ITEM_TYPE_LABEL[item.itemType]}</span>
                                </div>
                                <div className="font-mono text-xs text-slate-700 mt-1 break-all">{item.itemKey}</div>
                                {item.error && (
                                    <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">
{JSON.stringify(item.error, null, 2)}
                                    </pre>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Conflicts */}
            {run.conflicts.length > 0 && (
                <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-amber-200 bg-amber-50 text-sm font-medium text-amber-900">
                        Конфликты ({run.conflicts.length})
                    </div>
                    <ul className="divide-y divide-amber-200">
                        {run.conflicts.map((c) => (
                            <li key={c.id} className="px-4 py-3 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-amber-800">{c.conflictType}</span>
                                    {c.resolvedAt && (
                                        <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">Закрыт</span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-600 mt-1">
                                    {c.entityType}: <span className="font-mono">{c.entityId ?? '—'}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {run.items.length === 0 && run.conflicts.length === 0 && run.status === 'SUCCESS' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 text-sm text-emerald-800">
                    Все элементы обработаны успешно. Подробной построчной истории нет — это нормально для штатного запуска.
                </div>
            )}
        </div>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
    return (
        <div className={`border rounded-md p-3 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`text-sm font-medium mt-1 ${tone === 'warn' ? 'text-amber-900' : 'text-slate-900'}`}>{value}</div>
        </div>
    );
}

function ConflictsTabView({ conflicts, loading, filter, onFilterChange, onResolve, onOpenRun, accountLabel, canResolve }: {
    conflicts: SyncConflictRow[];
    loading: boolean;
    filter: 'open' | 'resolved' | 'all';
    onFilterChange: (f: 'open' | 'resolved' | 'all') => void;
    onResolve: (id: string) => void;
    onOpenRun: (runId: string) => void;
    accountLabel: (id: string | null) => string;
    canResolve: boolean;
}) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {(['open', 'resolved', 'all'] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => onFilterChange(f)}
                        className={`px-3 py-1.5 text-xs rounded ${
                            filter === f ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        {f === 'open' ? 'Открытые' : f === 'resolved' ? 'Закрытые' : 'Все'}
                    </button>
                ))}
            </div>
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {loading ? (
                    <div className="p-12 flex items-center justify-center text-slate-500 text-sm">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Загрузка…
                    </div>
                ) : conflicts.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 text-sm">
                        {filter === 'open' ? 'Открытых конфликтов нет.' : 'Список пуст.'}
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-200">
                        {conflicts.map((c) => (
                            <li key={c.id} className="px-4 py-3 text-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                                c.resolvedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                            }`}>{c.resolvedAt ? 'Закрыт' : 'Открыт'}</span>
                                            <span className="text-xs font-medium text-slate-700">{c.conflictType}</span>
                                        </div>
                                        <div className="text-xs text-slate-600">
                                            {c.entityType}: <span className="font-mono">{c.entityId ?? '—'}</span>
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            <button onClick={() => onOpenRun(c.runId)} className="underline hover:text-blue-700">
                                                Запуск {c.runId.slice(0, 8)}…
                                            </button>
                                            <span className="mx-1">·</span>
                                            {formatDateTime(c.createdAt)}
                                        </div>
                                    </div>
                                    {!c.resolvedAt && canResolve && (
                                        <button
                                            onClick={() => onResolve(c.id)}
                                            className="px-2.5 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50"
                                        >
                                            Закрыть
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function CreateRunModal({ accounts, accountId, setAccountId, types, setTypes, error, submitting, onClose, onSubmit }: {
    accounts: AccountOption[];
    accountId: string;
    setAccountId: (v: string) => void;
    types: string[];
    setTypes: (v: string[]) => void;
    error: string | null;
    submitting: boolean;
    onClose: () => void;
    onSubmit: () => void;
}) {
    // §10/§13/§17: tenant full sync НЕ выводится в UI как MVP-функция.
    const AVAILABLE_TYPES = ['PULL_STOCKS', 'PULL_ORDERS', 'PULL_METADATA', 'PUSH_STOCKS'];

    const toggleType = (t: string) => {
        if (types.includes(t)) setTypes(types.filter((x) => x !== t));
        else setTypes([...types, t]);
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-md w-full">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">Запустить синхронизацию</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Подключение</label>
                        <select
                            value={accountId}
                            onChange={(e) => setAccountId(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded px-3 py-2"
                        >
                            <option value="">— выберите —</option>
                            {accounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.label} ({a.marketplace})</option>
                            ))}
                        </select>
                        {accounts.length === 0 && (
                            <div className="text-xs text-slate-500 mt-1">Активных подключений нет. Перейдите в раздел «Подключения», чтобы добавить.</div>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Что синхронизировать</label>
                        <div className="space-y-1.5">
                            {AVAILABLE_TYPES.map((t) => (
                                <label key={t} className="flex items-center text-sm">
                                    <input
                                        type="checkbox"
                                        checked={types.includes(t)}
                                        onChange={() => toggleType(t)}
                                        className="mr-2"
                                    />
                                    {SYNC_TYPE_LABEL[t]}
                                </label>
                            ))}
                        </div>
                    </div>
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
                    )}
                </div>
                <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-2 text-sm border border-slate-300 rounded text-slate-700 hover:bg-slate-50">Отмена</button>
                    <button
                        onClick={onSubmit}
                        disabled={submitting || !accountId || types.length === 0}
                        className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin inline" />}
                        Запустить
                    </button>
                </div>
            </div>
        </div>
    );
}
