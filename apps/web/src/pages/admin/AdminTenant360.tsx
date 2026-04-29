import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    ArrowLeft,
    Loader2,
    AlertTriangle,
    Users,
    Building2,
    Clock,
    Activity,
    HardDrive,
    Bell,
    ShieldAlert,
    KeyRound,
    Calendar,
    RefreshCw,
} from 'lucide-react';
import {
    adminTenantsApi,
    adminActionsApi,
    type Tenant360,
    type AccessState,
    extractApiError,
} from '../../api/admin';
import { useAdminAuth } from '../../context/AdminAuthContext';
import HighRiskActionModal from '../../components/admin/HighRiskActionModal';
import InternalNotesPanel from '../../components/admin/InternalNotesPanel';

const ACCESS_STATE_TONE: Record<AccessState, string> = {
    TRIAL_ACTIVE: 'bg-blue-100 text-blue-800',
    TRIAL_EXPIRED: 'bg-amber-100 text-amber-800',
    ACTIVE_PAID: 'bg-green-100 text-green-800',
    GRACE_PERIOD: 'bg-orange-100 text-orange-800',
    SUSPENDED: 'bg-red-100 text-red-800',
    EARLY_ACCESS: 'bg-violet-100 text-violet-800',
    CLOSED: 'bg-slate-300 text-slate-800',
};

type ActionKind = 'extend-trial' | 'set-access-state' | 'restore-tenant' | 'password-reset' | null;

export default function AdminTenant360() {
    const { tenantId } = useParams<{ tenantId: string }>();
    const { isAdmin, isReadonly } = useAdminAuth();
    const [data, setData] = useState<Tenant360 | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openModal, setOpenModal] = useState<ActionKind>(null);
    const [pwResetUserId, setPwResetUserId] = useState<string | null>(null);
    const [setStateTarget, setSetStateTarget] = useState<'TRIAL_ACTIVE' | 'SUSPENDED'>(
        'TRIAL_ACTIVE',
    );

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        setError(null);
        try {
            const t = await adminTenantsApi.tenant360(tenantId);
            setData(t);
        } catch (err) {
            const apiErr = extractApiError(err);
            setError(
                apiErr.code === 'ADMIN_TENANT_NOT_FOUND'
                    ? 'Tenant не найден.'
                    : 'Не удалось загрузить tenant 360.',
            );
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        load();
    }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Загружаем tenant 360…
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-white border border-red-200 rounded-lg p-8 text-center">
                <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
                <p className="text-red-700 font-medium">{error ?? 'Нет данных'}</p>
                <Link
                    to="/admin"
                    className="inline-block mt-4 text-sm text-blue-600 hover:underline"
                >
                    ← к directory
                </Link>
            </div>
        );
    }

    const { core, owner, team, subscription, marketplaceAccounts, sync, notifications, worker, files, audit, securityEvents, supportActions } = data;

    const allowExtendTrial =
        isAdmin && (core.accessState === 'TRIAL_ACTIVE' || core.accessState === 'TRIAL_EXPIRED');
    const allowSetState =
        isAdmin &&
        // narrow-set: SUPPORT_ALLOWED_TRANSITIONS из backend AccessStatePolicy
        (core.accessState === 'TRIAL_EXPIRED' || core.accessState === 'CLOSED');
    const allowRestore = isAdmin && core.accessState === 'CLOSED' && core.status !== 'ACTIVE';

    return (
        <div className="space-y-5 max-w-7xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <Link
                        to="/admin"
                        className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center"
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Tenant directory
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-900 mt-1">{core.name}</h1>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${ACCESS_STATE_TONE[core.accessState]}`}
                        >
                            {core.accessState}
                        </span>
                        <span className="text-xs text-slate-500">{core.status}</span>
                        <span className="text-xs text-slate-400 font-mono">{core.id}</span>
                    </div>
                </div>
                <button
                    onClick={load}
                    className="inline-flex items-center text-xs text-slate-600 hover:text-slate-900 px-2 py-1 border border-slate-200 rounded hover:bg-slate-50"
                >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Обновить
                </button>
            </div>

            {/* Read-only diagnostics — намеренно отделено от high-risk зоны */}
            <section>
                <h2 className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-2">
                    Read-only diagnostics
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Card title="Core" icon={<Building2 className="h-4 w-4" />}>
                        <Row k="ИНН" v={core.inn ?? '—'} />
                        <Row k="Создан" v={fmtDate(core.createdAt)} />
                        <Row k="Обновлён" v={fmtDate(core.updatedAt)} />
                        <Row k="Closed at" v={core.closedAt ? fmtDate(core.closedAt) : '—'} />
                        {core.closureJob && (
                            <Row
                                k="Closure job"
                                v={`${core.closureJob.status} · scheduled: ${
                                    core.closureJob.scheduledFor
                                        ? fmtDate(core.closureJob.scheduledFor)
                                        : '—'
                                }`}
                            />
                        )}
                    </Card>

                    <Card title="Owner" icon={<KeyRound className="h-4 w-4" />}>
                        {owner ? (
                            <>
                                <Row k="Email" v={owner.email} />
                                <Row k="Status" v={owner.status} />
                                <Row
                                    k="Email verified"
                                    v={
                                        owner.emailVerifiedAt
                                            ? fmtDate(owner.emailVerifiedAt)
                                            : 'не подтверждён'
                                    }
                                />
                                <Row
                                    k="Last login"
                                    v={owner.lastLoginAt ? fmtDate(owner.lastLoginAt) : 'никогда'}
                                />
                                {isAdmin ? (
                                    <button
                                        onClick={() => {
                                            setPwResetUserId(owner.id);
                                            setOpenModal('password-reset');
                                        }}
                                        className="mt-2 text-xs text-amber-700 hover:text-amber-900 inline-flex items-center font-medium"
                                    >
                                        <KeyRound className="h-3 w-3 mr-1" />
                                        Trigger password reset…
                                    </button>
                                ) : (
                                    <ReadonlyHint />
                                )}
                            </>
                        ) : (
                            <span className="text-sm text-slate-400">primary owner не назначен</span>
                        )}
                    </Card>

                    <Card title="Team" icon={<Users className="h-4 w-4" />}>
                        <Row k="Active" v={String(team.active)} />
                        <Row k="Revoked / Left" v={`${team.revoked} / ${team.left}`} />
                        <Row k="Total" v={String(team.total)} />
                        {team.recentMembers.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                                    Recent joins
                                </div>
                                {team.recentMembers.slice(0, 3).map((m) => (
                                    <div
                                        key={m.id}
                                        className="text-xs text-slate-600 flex justify-between"
                                    >
                                        <span className="truncate">{m.user.email}</span>
                                        <span className="text-slate-400 ml-2">{m.role}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card title="Subscription / Access" icon={<Calendar className="h-4 w-4" />}>
                        <Row k="Access state" v={subscription.accessState} />
                        <Row k="Tenant status" v={subscription.tenantStatus} />
                        {subscription.history.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                                    History (последние 5)
                                </div>
                                {subscription.history.map((h) => (
                                    <div key={h.id} className="text-xs text-slate-600 mb-0.5">
                                        <span className="font-mono text-slate-400">
                                            {fmtDateShort(h.createdAt)}
                                        </span>{' '}
                                        {h.fromState ?? '·'} → <strong>{h.toState}</strong>
                                        {h.reasonCode && (
                                            <span className="text-slate-400"> · {h.reasonCode}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card title="Marketplace" icon={<Activity className="h-4 w-4" />}>
                        <Row k="Аккаунтов" v={String(marketplaceAccounts.length)} />
                        {marketplaceAccounts.slice(0, 4).map((a) => (
                            <div key={a.id} className="text-xs text-slate-600 mt-1">
                                <span className="font-medium">{a.marketplace}</span>{' '}
                                <span className="text-slate-400">{a.label ?? ''}</span>
                                <span
                                    className={`ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle ${
                                        a.syncHealthStatus === 'HEALTHY'
                                            ? 'bg-green-500'
                                            : a.syncHealthStatus === 'DEGRADED'
                                              ? 'bg-amber-500'
                                              : 'bg-red-500'
                                    }`}
                                />
                            </div>
                        ))}
                    </Card>

                    <Card title="Sync" icon={<RefreshCw className="h-4 w-4" />}>
                        <Row k="Failed (7d)" v={String(sync.failedRunsLast7d)} />
                        <Row k="Open conflicts" v={String(sync.openConflicts)} />
                        {sync.recentRuns.slice(0, 3).map((r) => (
                            <div key={r.id} className="text-xs text-slate-600 mt-1">
                                <span className="font-mono text-slate-400">
                                    {fmtDateShort(r.createdAt)}
                                </span>{' '}
                                {r.status}
                                {r.errorCode && (
                                    <span className="text-red-600"> · {r.errorCode}</span>
                                )}
                            </div>
                        ))}
                    </Card>

                    <Card title="Notifications" icon={<Bell className="h-4 w-4" />}>
                        <Row k="Critical (7d)" v={String(notifications.severityCountsLast7d.CRITICAL ?? 0)} />
                        <Row k="Warning (7d)" v={String(notifications.severityCountsLast7d.WARNING ?? 0)} />
                        <Row k="Info (7d)" v={String(notifications.severityCountsLast7d.INFO ?? 0)} />
                    </Card>

                    <Card title="Worker / Files" icon={<HardDrive className="h-4 w-4" />}>
                        <Row
                            k="Failed jobs"
                            v={String(
                                (worker.statusCounts.failed ?? 0) +
                                    (worker.statusCounts.dead_lettered ?? 0),
                            )}
                        />
                        <Row k="File store" v={fmtBytes(files.totalSizeBytes)} />
                    </Card>

                    <Card title="Audit / Security" icon={<ShieldAlert className="h-4 w-4" />}>
                        <Row k="Audit (7d)" v={String(audit.eventsLast7d)} />
                        <Row k="Audit total" v={String(audit.totalEvents)} />
                        <Row k="Security events" v={String(securityEvents.length)} />
                    </Card>
                </div>
            </section>

            {/* High-risk zone — выделено визуально */}
            <section className="border-2 border-amber-200 bg-amber-50/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <h2 className="text-xs uppercase tracking-wider font-bold text-amber-800">
                        High-risk support actions
                    </h2>
                </div>
                {isReadonly ? (
                    <p className="text-sm text-slate-600 italic">
                        Ваша роль <strong>SUPPORT_READONLY</strong> — high-risk actions недоступны.
                        Эскалируйте инцидент на SUPPORT_ADMIN, если нужна mutation.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <ActionButton
                            disabled={!allowExtendTrial}
                            onClick={() => setOpenModal('extend-trial')}
                            label="Extend trial"
                            hint={
                                allowExtendTrial
                                    ? 'Продлить trial'
                                    : 'Доступно только при TRIAL_ACTIVE/TRIAL_EXPIRED'
                            }
                        />
                        <ActionButton
                            disabled={!allowSetState}
                            onClick={() => setOpenModal('set-access-state')}
                            label="Change access state"
                            hint={
                                allowSetState
                                    ? 'Изменить access state (узкий набор)'
                                    : 'Только из TRIAL_EXPIRED/CLOSED в TRIAL_ACTIVE/SUSPENDED'
                            }
                        />
                        <ActionButton
                            disabled={!allowRestore}
                            onClick={() => setOpenModal('restore-tenant')}
                            label="Restore CLOSED tenant"
                            hint={
                                allowRestore
                                    ? 'Восстановить из CLOSED в retention window'
                                    : 'Доступно только для CLOSED tenant'
                            }
                        />
                    </div>
                )}
            </section>

            {/* Two-column: Notes + recent support actions */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                    <InternalNotesPanel tenantId={core.id} initialNotes={data.notes.items} />
                </div>
                <Card title="Recent support actions" icon={<Clock className="h-4 w-4" />}>
                    {supportActions.recent.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">
                            Support actions ещё не выполнялись.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {supportActions.recent.slice(0, 6).map((a) => (
                                <li key={a.id} className="text-xs border-b border-slate-100 pb-2">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-slate-700">
                                            {a.actionType}
                                        </span>
                                        <ResultBadge status={a.resultStatus} />
                                    </div>
                                    <div className="text-slate-500 mt-0.5">
                                        {fmtDateShort(a.createdAt)} ·{' '}
                                        {a.actorSupportUser.email ?? a.actorSupportUser.id.slice(0, 8)}
                                    </div>
                                    <div className="text-slate-600 mt-1 line-clamp-2">{a.reason}</div>
                                    {a.errorCode && (
                                        <div className="text-red-600 mt-1 font-mono text-[11px]">
                                            {a.errorCode}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </section>

            {/* Modals */}
            <HighRiskActionModal
                open={openModal === 'extend-trial'}
                onClose={() => setOpenModal(null)}
                title="Extend trial"
                description={`Продлить trial для tenant "${core.name}". Действие выполняется через TenantService.extendTrialBySupport — стандартное доменное правило валидации применится.`}
                confirmLabel="Продлить trial"
                onSubmit={async (reason) => {
                    await adminActionsApi.extendTrial(core.id, reason);
                }}
                onSuccess={load}
            />

            <HighRiskActionModal
                open={openModal === 'set-access-state'}
                onClose={() => setOpenModal(null)}
                title="Change access state"
                description={`Текущий state: ${core.accessState}. SUPPORT может перевести только в TRIAL_ACTIVE или SUSPENDED — billing override (ACTIVE_PAID/GRACE_PERIOD/EARLY_ACCESS) запрещён в MVP.`}
                confirmLabel="Применить транзицию"
                extraValid={!!setStateTarget}
                extraFields={
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                            Целевой state
                        </label>
                        <select
                            value={setStateTarget}
                            onChange={(e) =>
                                setSetStateTarget(e.target.value as 'TRIAL_ACTIVE' | 'SUSPENDED')
                            }
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        >
                            <option value="TRIAL_ACTIVE">TRIAL_ACTIVE</option>
                            <option value="SUSPENDED">SUSPENDED</option>
                        </select>
                    </div>
                }
                onSubmit={async (reason) => {
                    await adminActionsApi.setAccessState(core.id, setStateTarget, reason);
                }}
                onSuccess={load}
            />

            <HighRiskActionModal
                open={openModal === 'restore-tenant'}
                onClose={() => setOpenModal(null)}
                title="Restore CLOSED tenant"
                description={`Tenant "${core.name}" сейчас в CLOSED. Восстановление работает только пока retention window не истёк — иначе сервер вернёт CONFLICT.`}
                confirmLabel="Восстановить tenant"
                onSubmit={async (reason) => {
                    await adminActionsApi.restoreTenant(core.id, reason);
                }}
                onSuccess={load}
            />

            <HighRiskActionModal
                open={openModal === 'password-reset' && !!pwResetUserId}
                onClose={() => {
                    setOpenModal(null);
                    setPwResetUserId(null);
                }}
                title="Trigger password reset"
                description={`Запустит обычный self-service flow для пользователя ${owner?.email ?? ''}. Support не получает plaintext password или хэш — только инициирует email с reset-ссылкой.`}
                confirmLabel="Trigger reset"
                onSubmit={async (reason) => {
                    if (!pwResetUserId) return;
                    await adminActionsApi.triggerPasswordReset(pwResetUserId, reason);
                }}
            />
        </div>
    );
}

// ─── presentational helpers ────────────────────────────────────────────────

function Card({
    title,
    icon,
    children,
}: {
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2 text-slate-700">
                {icon}
                <h3 className="text-sm font-semibold">{title}</h3>
            </div>
            <div className="space-y-0.5">{children}</div>
        </div>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex justify-between items-baseline text-xs gap-2">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-800 font-medium text-right truncate" title={v}>
                {v}
            </span>
        </div>
    );
}

function ActionButton({
    label,
    hint,
    disabled,
    onClick,
}: {
    label: string;
    hint: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <div className="flex flex-col">
            <button
                disabled={disabled}
                onClick={onClick}
                className="px-3 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed rounded-md"
            >
                {label}
            </button>
            <span className="text-[10px] text-slate-500 mt-1 max-w-[180px]">{hint}</span>
        </div>
    );
}

function ResultBadge({ status }: { status: 'success' | 'failed' | 'blocked' }) {
    const tone =
        status === 'success'
            ? 'bg-green-100 text-green-800'
            : status === 'blocked'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-red-100 text-red-800';
    return (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${tone}`}>
            {status}
        </span>
    );
}

function ReadonlyHint() {
    return (
        <span className="text-[11px] text-slate-400 italic mt-2 inline-block">
            (read-only роль не выполняет mutations)
        </span>
    );
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function fmtDateShort(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function fmtBytes(rawString: string): string {
    const n = Number(rawString);
    if (!Number.isFinite(n) || n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}
