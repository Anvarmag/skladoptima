import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    RefreshCw, AlertCircle, CheckCircle2, XCircle, PauseCircle,
    Clock, Loader2, ArrowLeft, RotateCcw, AlertTriangle,
    Lock, ListTree,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
    S, PageHeader, Card, Badge, Btn, TH, FieldLabel, HiSelect,
    Pagination, EmptyState, SkuTag, Spinner, Modal,
} from '../components/ui';

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

const MARKETPLACE_LABEL: Record<string, string> = { WB: 'Wildberries', OZON: 'Ozon' };

const STATUS_LABEL: Record<SyncRunStatus, string> = {
    QUEUED: 'В очереди',
    IN_PROGRESS: 'Выполняется',
    SUCCESS: 'Успешно',
    PARTIAL_SUCCESS: 'Частично',
    FAILED: 'Ошибка',
    BLOCKED: 'Заблокирован',
    CANCELLED: 'Отменён',
};

const STATUS_BADGE: Record<SyncRunStatus, { color: string; bg: string }> = {
    QUEUED:         { color: S.sub,   bg: '#f1f5f9' },
    IN_PROGRESS:    { color: S.blue,  bg: 'rgba(59,130,246,0.08)' },
    SUCCESS:        { color: S.green, bg: 'rgba(16,185,129,0.08)' },
    PARTIAL_SUCCESS:{ color: S.amber, bg: 'rgba(245,158,11,0.08)' },
    FAILED:         { color: S.red,   bg: 'rgba(239,68,68,0.08)' },
    BLOCKED:        { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    CANCELLED:      { color: S.muted, bg: '#f1f5f9' },
};

// ВАЖНО §10/§20: blocked ≠ failed.
const STATUS_ICON: Record<SyncRunStatus, React.ComponentType<any>> = {
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

const BLOCKED_REASON_TEXT: Record<string, { title: string; hint: string }> = {
    TENANT_TRIAL_EXPIRED: { title: 'Пробный период истёк', hint: 'Оформите подписку — синхронизация возобновится автоматически.' },
    TENANT_SUSPENDED: { title: 'Доступ приостановлен', hint: 'Обратитесь в службу поддержки.' },
    TENANT_CLOSED: { title: 'Компания закрыта', hint: 'Доступ к синхронизации недоступен.' },
    ACCOUNT_INACTIVE: { title: 'Подключение отключено', hint: 'Активируйте подключение в разделе «Подключения».' },
    CREDENTIALS_INVALID: { title: 'Ключи недействительны', hint: 'Обновите API-ключи в разделе «Подключения».' },
    CREDENTIALS_NEEDS_RECONNECT: { title: 'Требуется переподключение', hint: 'Перевыпустите токен у маркетплейса и обновите его в подключении.' },
    CONCURRENCY_GUARD: { title: 'Уже выполняется другой sync', hint: 'Дождитесь завершения текущего запуска и попробуйте снова.' },
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
    PULL_FINANCES_WB: 'Финансы WB (комиссия, логистика)',
};

const STAGE_LABEL: Record<string, string> = {
    PREFLIGHT: 'Проверка', PULL: 'Загрузка', TRANSFORM: 'Обработка', APPLY: 'Применение', PUSH: 'Отправка',
};

const ITEM_TYPE_LABEL: Record<string, string> = {
    STOCK: 'Остаток', ORDER: 'Заказ', PRODUCT: 'Товар', WAREHOUSE: 'Склад',
};

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

// ─────────────────────────────── sub-components ───────────────────────────

function StatusBadge({ status }: { status: SyncRunStatus }) {
    const Icon = STATUS_ICON[status];
    const cfg = STATUS_BADGE[status];
    return (
        <Badge
            label={STATUS_LABEL[status]}
            color={cfg.color}
            bg={cfg.bg}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        />
    );
}

function AlertBox({ color, bg, border, icon: Icon, children }: {
    color: string; bg: string; border: string;
    icon: React.ComponentType<any>; children: React.ReactNode;
}) {
    return (
        <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16 }}>
            <Icon size={16} color={color} style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>{children}</div>
        </div>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
    const warn = tone === 'warn';
    return (
        <div style={{
            border: `1px solid ${warn ? 'rgba(245,158,11,0.3)' : S.border}`,
            borderRadius: 12, padding: '12px 16px',
            background: warn ? 'rgba(245,158,11,0.06)' : '#fff',
        }}>
            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 600, color: warn ? '#92400e' : S.ink }}>{value}</div>
        </div>
    );
}

function RunListItem({ run, accountLabel, onClick }: {
    run: SyncRunRow; accountLabel: string; onClick: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex', alignItems: 'center', minHeight: 60, padding: '0 20px',
                borderBottom: `1px solid ${S.border}`, cursor: 'pointer',
                background: hovered ? S.bg : '#fff', transition: 'background 0.1s', gap: 16,
            }}
        >
            <div style={{ flexShrink: 0 }}>
                <StatusBadge status={run.status} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountLabel}</span>
                    <span style={{ color: S.muted }}>·</span>
                    <span style={{ color: S.sub }}>{TRIGGER_LABEL[run.triggerType]}</span>
                    {run.attemptNumber > 1 && (
                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>(попытка {run.attemptNumber}/{run.maxAttempts})</span>
                    )}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {run.syncTypes.map(t => SYNC_TYPE_LABEL[t] ?? t).join(', ') || '—'}
                </div>
                {run.status === 'BLOCKED' && run.blockedReason && (
                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#7c3aed', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={10} />{BLOCKED_REASON_TEXT[run.blockedReason]?.title ?? run.blockedReason}
                    </div>
                )}
                {run.status === 'FAILED' && run.errorCode && (
                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.red, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertCircle size={10} />{ERROR_CODE_TEXT[run.errorCode] ?? run.errorCode}
                    </div>
                )}
                {run.status === 'PARTIAL_SUCCESS' && (
                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.amber, marginTop: 3 }}>
                        Обработано {run.processedCount}, ошибок {run.errorCount}
                    </div>
                )}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{formatDateTime(run.createdAt)}</div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 2 }}>{formatDuration(run.durationMs)}</div>
            </div>
            <AlertCircle size={15} color={S.muted} style={{ flexShrink: 0, opacity: 0.4 }} />
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <StatusBadge status={run.status} />
                            <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{TRIGGER_LABEL[run.triggerType]}</span>
                            {run.originRunId && (
                                <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>
                                    · попытка {run.attemptNumber} из {run.maxAttempts}
                                </span>
                            )}
                        </div>
                        <h2 style={{ fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: S.ink, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {accountLabel(run.accountId)}
                        </h2>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginTop: 4 }}>
                            {run.syncTypes.map(t => SYNC_TYPE_LABEL[t] ?? t).join(', ') || '—'}
                        </div>
                    </div>
                    {isRetryEligible && (
                        <Btn
                            variant="secondary"
                            onClick={() => onRetry(run.id)}
                            disabled={!canRetry}
                            title={!canRetry ? (externalBlocked ? 'Повтор недоступен в текущем тарифном статусе' : 'Недостаточно прав') : ''}
                        >
                            {!canRetry ? <Lock size={14} /> : <RotateCcw size={14} />}
                            Повторить
                        </Btn>
                    )}
                </div>

                {run.status === 'BLOCKED' && blockedHint && (
                    <AlertBox color="#7c3aed" bg="rgba(124,58,237,0.06)" border="rgba(124,58,237,0.2)" icon={PauseCircle}>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#4c1d95' }}>{blockedHint.title}</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#6d28d9', marginTop: 4 }}>{blockedHint.hint}</div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#7c3aed', marginTop: 6 }}>{run.blockedReason}</div>
                    </AlertBox>
                )}

                {run.status === 'FAILED' && (
                    <AlertBox color={S.red} bg="rgba(239,68,68,0.06)" border="rgba(239,68,68,0.2)" icon={XCircle}>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#7f1d1d' }}>Запуск завершился с ошибкой</div>
                        {errorHint && <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#991b1b', marginTop: 4 }}>{errorHint}</div>}
                        {run.errorCode && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.red, marginTop: 6 }}>{run.errorCode}</div>}
                        {run.errorMessage && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.red, marginTop: 4, wordBreak: 'break-all' }}>{run.errorMessage}</div>}
                        {run.nextAttemptAt && (
                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#991b1b', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Clock size={12} />Автоповтор: {formatDateTime(run.nextAttemptAt)}
                            </div>
                        )}
                    </AlertBox>
                )}

                {run.status === 'PARTIAL_SUCCESS' && (
                    <AlertBox color={S.amber} bg="rgba(245,158,11,0.06)" border="rgba(245,158,11,0.2)" icon={AlertTriangle}>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#92400e' }}>
                            Часть элементов не была обработана. Подробности — в списке ниже.
                        </div>
                    </AlertBox>
                )}
            </Card>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <SummaryCard label="Создан" value={formatDateTime(run.createdAt)} />
                <SummaryCard label="Длительность" value={formatDuration(run.durationMs)} />
                <SummaryCard label="Обработано" value={String(run.processedCount)} />
                <SummaryCard label="Ошибок" value={String(run.errorCount)} tone={run.errorCount > 0 ? 'warn' : undefined} />
            </div>

            {run.originRun && (
                <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 10, padding: '10px 14px', fontFamily: 'Inter', fontSize: 12, color: S.sub }}>
                    Этот запуск — повтор run <SkuTag>{run.originRun.id.slice(0, 8)}</SkuTag> (статус: {STATUS_LABEL[run.originRun.status]}).
                </div>
            )}

            {/* Items */}
            {run.items.length > 0 && (
                <Card noPad>
                    <div style={{ padding: '12px 20px', borderBottom: `1px solid ${S.border}`, background: S.bg, fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>
                        Проблемные элементы ({run.items.length})
                    </div>
                    {run.items.map(item => {
                        const itemBadge =
                            item.status === 'FAILED'   ? { color: S.red,   bg: 'rgba(239,68,68,0.08)' } :
                            item.status === 'CONFLICT' ? { color: S.amber, bg: 'rgba(245,158,11,0.08)' } :
                            { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' };
                        return (
                            <div key={item.id} style={{ padding: '12px 20px', borderBottom: `1px solid ${S.border}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <Badge label={item.status} color={itemBadge.color} bg={itemBadge.bg} />
                                    <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{STAGE_LABEL[item.stage]}</span>
                                    <span style={{ color: S.muted }}>·</span>
                                    <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{ITEM_TYPE_LABEL[item.itemType]}</span>
                                </div>
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.ink, wordBreak: 'break-all' }}>{item.itemKey}</div>
                                {item.error && (
                                    <pre style={{ marginTop: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 12px', overflowX: 'auto' }}>
                                        {JSON.stringify(item.error, null, 2)}
                                    </pre>
                                )}
                            </div>
                        );
                    })}
                </Card>
            )}

            {/* Conflicts */}
            {run.conflicts.length > 0 && (
                <Card noPad style={{ border: `1px solid rgba(245,158,11,0.3)` }}>
                    <div style={{ padding: '12px 20px', borderBottom: `1px solid rgba(245,158,11,0.2)`, background: 'rgba(245,158,11,0.06)', fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                        Конфликты ({run.conflicts.length})
                    </div>
                    {run.conflicts.map(c => (
                        <div key={c.id} style={{ padding: '12px 20px', borderBottom: `1px solid rgba(245,158,11,0.15)` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <Badge
                                    label={c.resolvedAt ? 'Закрыт' : 'Открыт'}
                                    color={c.resolvedAt ? S.green : S.amber}
                                    bg={c.resolvedAt ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)'}
                                />
                                <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.ink }}>{c.conflictType}</span>
                            </div>
                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>
                                {c.entityType}: <SkuTag>{c.entityId ?? '—'}</SkuTag>
                            </div>
                        </div>
                    ))}
                </Card>
            )}

            {run.items.length === 0 && run.conflicts.length === 0 && run.status === 'SUCCESS' && (
                <div style={{ background: 'rgba(16,185,129,0.06)', border: `1px solid rgba(16,185,129,0.2)`, borderRadius: 10, padding: '14px 18px', fontFamily: 'Inter', fontSize: 13, color: '#065f46', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={16} color={S.green} />
                    Все элементы обработаны успешно. Подробной построчной истории нет — это нормально для штатного запуска.
                </div>
            )}
        </div>
    );
}

function ConflictsTabView({ conflicts, loading, filter, onFilterChange, onResolve, onOpenRun, canResolve }: {
    conflicts: SyncConflictRow[];
    loading: boolean;
    filter: 'open' | 'resolved' | 'all';
    onFilterChange: (f: 'open' | 'resolved' | 'all') => void;
    onResolve: (id: string) => void;
    onOpenRun: (runId: string) => void;
    accountLabel: (id: string | null) => string;
    canResolve: boolean;
}) {
    const FILTER_OPTIONS = [
        { value: 'open', label: 'Открытые' },
        { value: 'resolved', label: 'Закрытые' },
        { value: 'all', label: 'Все' },
    ] as const;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6 }}>
                {FILTER_OPTIONS.map(f => (
                    <Btn
                        key={f.value}
                        size="sm"
                        variant={filter === f.value ? 'primary' : 'secondary'}
                        onClick={() => onFilterChange(f.value)}
                    >
                        {f.label}
                    </Btn>
                ))}
            </div>
            <Card noPad>
                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                        <Spinner /> Загрузка…
                    </div>
                ) : conflicts.length === 0 ? (
                    <EmptyState icon={CheckCircle2} title={filter === 'open' ? 'Открытых конфликтов нет' : 'Список пуст'} />
                ) : (
                    conflicts.map(c => (
                        <div key={c.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <Badge
                                        label={c.resolvedAt ? 'Закрыт' : 'Открыт'}
                                        color={c.resolvedAt ? S.green : S.amber}
                                        bg={c.resolvedAt ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)'}
                                    />
                                    <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>{c.conflictType}</span>
                                </div>
                                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>
                                    {c.entityType}: <SkuTag>{c.entityId ?? '—'}</SkuTag>
                                </div>
                                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, marginTop: 4 }}>
                                    <button
                                        onClick={() => onOpenRun(c.runId)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.blue, fontFamily: 'Inter', fontSize: 12, textDecoration: 'underline', padding: 0 }}
                                    >
                                        Запуск {c.runId.slice(0, 8)}…
                                    </button>
                                    <span style={{ margin: '0 6px' }}>·</span>
                                    {formatDateTime(c.createdAt)}
                                </div>
                            </div>
                            {!c.resolvedAt && canResolve && (
                                <Btn variant="success" size="sm" onClick={() => onResolve(c.id)}>
                                    Закрыть
                                </Btn>
                            )}
                        </div>
                    ))
                )}
            </Card>
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
    const AVAILABLE_TYPES = ['PULL_STOCKS', 'PULL_ORDERS', 'PULL_METADATA', 'PUSH_STOCKS', 'PULL_FINANCES_WB'];

    const toggleType = (t: string) => {
        if (types.includes(t)) setTypes(types.filter(x => x !== t));
        else setTypes([...types, t]);
    };

    return (
        <Modal open onClose={onClose} title="Запустить синхронизацию" width={440}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                    <FieldLabel>Подключение</FieldLabel>
                    <HiSelect
                        value={accountId}
                        onChange={setAccountId}
                        options={[
                            { value: '', label: '— выберите —' },
                            ...accounts.map(a => ({ value: a.id, label: `${a.label} (${MARKETPLACE_LABEL[a.marketplace] ?? a.marketplace})` })),
                        ]}
                        style={{ width: '100%' }}
                    />
                    {accounts.length === 0 && (
                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, marginTop: 6 }}>
                            Активных подключений нет. Перейдите в раздел «Подключения», чтобы добавить.
                        </div>
                    )}
                </div>
                <div>
                    <FieldLabel>Что синхронизировать</FieldLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {AVAILABLE_TYPES.map(t => (
                            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'Inter', fontSize: 13, color: S.ink }}>
                                <input
                                    type="checkbox"
                                    checked={types.includes(t)}
                                    onChange={() => toggleType(t)}
                                    style={{ accentColor: S.blue }}
                                />
                                {SYNC_TYPE_LABEL[t]}
                            </label>
                        ))}
                    </div>
                </div>
                {error && (
                    <div style={{ background: 'rgba(239,68,68,0.06)', border: `1px solid rgba(239,68,68,0.2)`, borderRadius: 8, padding: '10px 14px', fontFamily: 'Inter', fontSize: 13, color: S.red }}>
                        {error}
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                    <Btn variant="secondary" onClick={onClose}>Отмена</Btn>
                    <Btn
                        variant="primary"
                        onClick={onSubmit}
                        disabled={submitting || !accountId || types.length === 0}
                    >
                        {submitting && <Spinner size={14} color="#fff" />}
                        Запустить
                    </Btn>
                </div>
            </div>
        </Modal>
    );
}

// ─────────────────────────────── main component ───────────────────────────

export default function SyncRuns() {
    const { activeTenant } = useAuth();
    const accessState = activeTenant?.accessState;
    const externalBlocked = useMemo(
        () => (accessState ? EXTERNAL_API_BLOCKED_STATES.includes(accessState) : false),
        [accessState],
    );
    const role = activeTenant?.role;
    const canTriggerSync = role === 'OWNER' || role === 'ADMIN';

    const [runs, setRuns] = useState<SyncRunRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [filterStatus, setFilterStatus] = useState<SyncRunStatus | ''>('');
    const [filterAccount, setFilterAccount] = useState<string>('');
    const [page, setPage] = useState(1);
    const [meta, setMeta] = useState<{ total: number; page: number; limit: number; lastPage: number }>({
        total: 0, page: 1, limit: 20, lastPage: 1,
    });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<SyncRunDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [createAccountId, setCreateAccountId] = useState<string>('');
    const [createTypes, setCreateTypes] = useState<string[]>(['PULL_STOCKS', 'PULL_ORDERS']);
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

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
            const res = await axios.get('/marketplace-accounts', { params: { lifecycleStatus: 'ACTIVE' } });
            setAccounts(res.data?.data ?? []);
        } catch { /* не критично */ }
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
    useEffect(() => { if (activeTab === 'conflicts') loadConflicts(); }, [activeTab, loadConflicts]);

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
        if (!createAccountId) { setCreateError('Выберите подключение.'); return; }
        if (createTypes.length === 0) { setCreateError('Выберите хотя бы один тип синхронизации.'); return; }
        setCreateError(null);
        setCreateSubmitting(true);
        try {
            const res = await axios.post('/sync/runs', { accountId: createAccountId, syncTypes: createTypes });
            setShowCreate(false);
            setTopMessage({
                kind: res.data.status === 'BLOCKED' ? 'warn' : 'ok',
                text: res.data.status === 'BLOCKED'
                    ? `Запуск зафиксирован как заблокированный: ${BLOCKED_REASON_TEXT[res.data.blockedReason]?.title ?? res.data.blockedReason}`
                    : 'Синхронизация поставлена в очередь.',
            });
            await loadRuns();
            await openDetail(res.data.id);
        } catch (e: any) {
            const code = e?.response?.data?.code;
            if (code === 'MARKETPLACE_ACCOUNT_NOT_FOUND') setCreateError('Подключение не найдено.');
            else setCreateError(e?.response?.data?.message ?? 'Не удалось создать запуск.');
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
        const acc = accounts.find(a => a.id === id);
        return acc ? `${acc.label} (${MARKETPLACE_LABEL[acc.marketplace] ?? acc.marketplace})` : id.slice(0, 8) + '…';
    }, [accounts]);

    // ─── detail view
    if (selectedId) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Btn variant="ghost" onClick={() => { setSelectedId(null); setDetail(null); }} style={{ alignSelf: 'flex-start' }}>
                    <ArrowLeft size={14} /> К истории запусков
                </Btn>
                {detailLoading && (
                    <Card style={{ display: 'flex', alignItems: 'center', gap: 10, color: S.sub, fontSize: 13, fontFamily: 'Inter' }}>
                        <Spinner /> Загрузка деталей…
                    </Card>
                )}
                {detail && (
                    <RunDetailView
                        run={detail}
                        accountLabel={accountLabel}
                        onRetry={submitRetry}
                        canRetry={canTriggerSync && !externalBlocked}
                        externalBlocked={externalBlocked}
                    />
                )}
            </div>
        );
    }

    // ─── list view
    const msgColors = {
        ok:   { color: S.green, bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.2)' },
        warn: { color: S.amber, bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.2)' },
        err:  { color: S.red,   bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.2)' },
    };

    const statusOptions = [
        { value: '', label: 'Все статусы' },
        ...(Object.keys(STATUS_LABEL) as SyncRunStatus[]).map(s => ({ value: s, label: STATUS_LABEL[s] })),
    ];
    const accountOptions = [
        { value: '', label: 'Все подключения' },
        ...accounts.map(a => ({ value: a.id, label: `${a.label} (${MARKETPLACE_LABEL[a.marketplace] ?? a.marketplace})` })),
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {topMessage && (() => {
                const c = msgColors[topMessage.kind];
                return (
                    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 16px', fontFamily: 'Inter', fontSize: 13, color: c.color, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1 }}>{topMessage.text}</span>
                        <button onClick={() => setTopMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                );
            })()}

            <PageHeader
                title="Синхронизация"
                subtitle="История запусков, ошибки и конфликты по подключённым маркетплейсам."
            >
                <Btn variant="secondary" onClick={loadRuns}>
                    <RefreshCw size={14} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
                    Обновить
                </Btn>
                {canTriggerSync && (
                    <Btn
                        variant="primary"
                        onClick={() => { setShowCreate(true); setCreateError(null); }}
                        disabled={externalBlocked}
                        title={externalBlocked ? 'Запуск синхронизации недоступен в текущем тарифном статусе' : ''}
                    >
                        {externalBlocked ? <Lock size={14} /> : <CheckCircle2 size={14} />}
                        Запустить sync
                    </Btn>
                )}
            </PageHeader>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${S.border}`, gap: 0 }}>
                {([
                    { id: 'runs', label: 'История запусков', icon: ListTree },
                    { id: 'conflicts', label: 'Конфликты', icon: AlertCircle },
                ] as const).map(t => {
                    const active = activeTab === t.id;
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            style={{
                                padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                                fontFamily: 'Inter', fontSize: 13, fontWeight: 500,
                                color: active ? S.blue : S.sub,
                                borderBottom: active ? `2px solid ${S.blue}` : '2px solid transparent',
                                marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
                                transition: 'color 0.15s',
                            }}
                        >
                            <Icon size={15} />{t.label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'runs' && (
                <>
                    {/* Filters */}
                    <Card style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
                            <div>
                                <FieldLabel>Статус</FieldLabel>
                                <HiSelect
                                    value={filterStatus}
                                    onChange={v => { setFilterStatus(v as any); setPage(1); }}
                                    options={statusOptions}
                                />
                            </div>
                            <div>
                                <FieldLabel>Подключение</FieldLabel>
                                <HiSelect
                                    value={filterAccount}
                                    onChange={v => { setFilterAccount(v); setPage(1); }}
                                    options={accountOptions}
                                />
                            </div>
                            <div style={{ marginLeft: 'auto', fontFamily: 'Inter', fontSize: 12, color: S.muted, alignSelf: 'center' }}>
                                Всего: {meta.total}
                            </div>
                        </div>
                    </Card>

                    {/* List */}
                    <Card noPad>
                        {/* Header row */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 4px', background: S.bg, borderBottom: `1px solid ${S.border}` }}>
                            <div style={{ width: 120, padding: '0 16px' }}><TH>Статус</TH></div>
                            <TH flex={3}>Подключение / Типы</TH>
                            <TH flex={1} align="right">Дата / Длительность</TH>
                            <div style={{ width: 32 }} />
                        </div>
                        {loading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                                <Spinner /> Загрузка…
                            </div>
                        ) : runs.length === 0 ? (
                            <EmptyState icon={RefreshCw} title="История пуста" subtitle="Запустите первую синхронизацию или дождитесь автоматического запуска." />
                        ) : (
                            runs.map(run => (
                                <RunListItem
                                    key={run.id}
                                    run={run}
                                    accountLabel={accountLabel(run.accountId)}
                                    onClick={() => openDetail(run.id)}
                                />
                            ))
                        )}
                        {meta.lastPage > 1 && (
                            <Pagination
                                page={page}
                                totalPages={meta.lastPage}
                                onPage={setPage}
                                total={meta.total}
                                shown={runs.length}
                            />
                        )}
                    </Card>
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

            {showCreate && (
                <CreateRunModal
                    accounts={accounts.filter(a => a.lifecycleStatus === 'ACTIVE')}
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
