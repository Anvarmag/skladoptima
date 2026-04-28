import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Plug, Plus, Edit2, RefreshCw, Power, PowerOff, X, Lock, AlertCircle,
    CheckCircle2, AlertTriangle, PauseCircle, Activity, ChevronRight,
    KeyRound, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────── types ───────────────────────────────

const WRITE_BLOCKED_STATES = ['SUSPENDED', 'CLOSED'];                       // полный read-only
const EXTERNAL_API_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']; // блок validate/reactivate/create/credentials

type Marketplace = 'WB' | 'OZON';
type LifecycleStatus = 'ACTIVE' | 'INACTIVE';
type CredentialStatus = 'VALIDATING' | 'VALID' | 'INVALID' | 'NEEDS_RECONNECT' | 'UNKNOWN';
type SyncHealthStatus = 'HEALTHY' | 'DEGRADED' | 'PAUSED' | 'ERROR' | 'UNKNOWN';
type EffectiveRuntimeState = 'OPERATIONAL' | 'PAUSED_BY_TENANT' | 'CREDENTIAL_BLOCKED' | 'SYNC_DEGRADED' | 'INACTIVE';

interface CredentialView {
    maskedPreview: Record<string, string | null> | null;
    encryptionKeyVersion: number;
    schemaVersion: number;
    rotatedAt: string | null;
}

interface AccountRow {
    id: string;
    marketplace: Marketplace;
    label: string;
    lifecycleStatus: LifecycleStatus;
    credentialStatus: CredentialStatus;
    syncHealthStatus: SyncHealthStatus;
    syncHealthReason: string | null;
    lastValidatedAt: string | null;
    lastValidationErrorCode: string | null;
    lastValidationErrorMessage: string | null;
    lastSyncAt: string | null;
    lastSyncResult: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | null;
    lastSyncErrorCode: string | null;
    lastSyncErrorMessage: string | null;
    deactivatedAt: string | null;
    deactivatedBy: string | null;
    createdAt: string;
    updatedAt: string;
    credential: CredentialView | null;
}

interface AccountDiagnostics extends AccountRow {
    tenantAccessState: string | null;
    effectiveRuntimeState: EffectiveRuntimeState;
    effectiveRuntimeReason: string | null;
    statusLayers: {
        lifecycle: { status: LifecycleStatus; deactivatedAt: string | null; deactivatedBy: string | null };
        credential: { status: CredentialStatus; lastValidatedAt: string | null; lastValidationErrorCode: string | null; lastValidationErrorMessage: string | null };
        syncHealth: { status: SyncHealthStatus; reason: string | null; lastSyncAt: string | null; lastSyncResult: string | null; lastSyncErrorCode: string | null; lastSyncErrorMessage: string | null };
    };
    recentEvents: Array<{ id: string; eventType: string; createdAt: string; payload: any }>;
}

// ─────────────────────────────── helpers ─────────────────────────────

const MARKETPLACE_LABEL: Record<Marketplace, string> = { WB: 'Wildberries', OZON: 'Ozon' };
const MARKETPLACE_TONE: Record<Marketplace, string> = {
    WB: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
    OZON: 'bg-sky-50 text-sky-700 border border-sky-200',
};

const LIFECYCLE_TONE: Record<LifecycleStatus, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    INACTIVE: 'bg-slate-200 text-slate-700',
};
const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
    ACTIVE: 'Активен',
    INACTIVE: 'Отключён',
};

const CRED_TONE: Record<CredentialStatus, string> = {
    VALIDATING: 'bg-blue-100 text-blue-800',
    VALID: 'bg-emerald-100 text-emerald-800',
    INVALID: 'bg-red-100 text-red-800',
    NEEDS_RECONNECT: 'bg-amber-100 text-amber-800',
    UNKNOWN: 'bg-slate-100 text-slate-700',
};
const CRED_LABEL: Record<CredentialStatus, string> = {
    VALIDATING: 'Проверяется...',
    VALID: 'Ключи валидны',
    INVALID: 'Ключи невалидны',
    NEEDS_RECONNECT: 'Нужно переподключение',
    UNKNOWN: 'Статус неизвестен',
};

const SYNC_TONE: Record<SyncHealthStatus, string> = {
    HEALTHY: 'bg-emerald-100 text-emerald-800',
    DEGRADED: 'bg-amber-100 text-amber-800',
    PAUSED: 'bg-slate-200 text-slate-700',
    ERROR: 'bg-red-100 text-red-800',
    UNKNOWN: 'bg-slate-100 text-slate-700',
};
const SYNC_LABEL: Record<SyncHealthStatus, string> = {
    HEALTHY: 'Sync исправен',
    DEGRADED: 'Sync с ошибками',
    PAUSED: 'Sync на паузе',
    ERROR: 'Sync сломан',
    UNKNOWN: 'Sync не запускался',
};

const EFFECTIVE_TONE: Record<EffectiveRuntimeState, string> = {
    OPERATIONAL: 'bg-emerald-100 text-emerald-800',
    PAUSED_BY_TENANT: 'bg-amber-100 text-amber-800',
    CREDENTIAL_BLOCKED: 'bg-red-100 text-red-800',
    SYNC_DEGRADED: 'bg-amber-100 text-amber-800',
    INACTIVE: 'bg-slate-200 text-slate-700',
};
const EFFECTIVE_LABEL: Record<EffectiveRuntimeState, string> = {
    OPERATIONAL: 'Работает',
    PAUSED_BY_TENANT: 'Пауза по тарифу',
    CREDENTIAL_BLOCKED: 'Блок: ключи',
    SYNC_DEGRADED: 'Sync деградирован',
    INACTIVE: 'Отключён вручную',
};

const EFFECTIVE_HINT: Record<EffectiveRuntimeState, string> = {
    OPERATIONAL: 'Подключение работает штатно. Sync выполняется по расписанию.',
    PAUSED_BY_TENANT: 'Внешние API-вызовы приостановлены политикой подписки. Оформите подписку для возобновления.',
    CREDENTIAL_BLOCKED: 'Ключи невалидны или требуют переподключения. Обновите credentials через «Изменить».',
    SYNC_DEGRADED: 'Credentials в порядке, но последний sync run прошёл с ошибкой. История ошибок ниже.',
    INACTIVE: 'Подключение отключено вручную. Можно реактивировать.',
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

function ucWriteHint(state: string | undefined, scope: 'external' | 'internal'): string {
    if (!state) return '';
    if (scope === 'external') {
        if (state === 'TRIAL_EXPIRED') return 'Пробный период истёк. Внешние API-действия (создание, валидация, реактивация, обновление ключей) недоступны до оплаты подписки.';
        if (state === 'SUSPENDED') return 'Доступ приостановлен. Все действия с подключениями заблокированы.';
        if (state === 'CLOSED') return 'Компания закрыта. Действия с подключениями недоступны.';
    } else {
        if (state === 'SUSPENDED') return 'Доступ приостановлен. Запись данных заблокирована.';
        if (state === 'CLOSED') return 'Компания закрыта. Запись недоступна.';
    }
    return '';
}

// ─────────────────────────────── component ───────────────────────────

export default function MarketplaceAccounts() {
    const { activeTenant } = useAuth();
    const accessState = activeTenant?.accessState;
    const writeBlocked = accessState ? WRITE_BLOCKED_STATES.includes(accessState) : false;
    const externalBlocked = accessState ? EXTERNAL_API_BLOCKED_STATES.includes(accessState) : false;

    const externalHint = ucWriteHint(accessState, 'external');
    const writeHint = ucWriteHint(accessState, 'internal');

    // ─── list state
    const [accounts, setAccounts] = useState<AccountRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [topMessage, setTopMessage] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

    // ─── selected detail state
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<AccountDiagnostics | null>(null);
    const [diagLoading, setDiagLoading] = useState(false);

    // ─── create/edit modal state
    const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
    const [modalAccount, setModalAccount] = useState<AccountRow | null>(null);
    const [formMarketplace, setFormMarketplace] = useState<Marketplace>('WB');
    const [formLabel, setFormLabel] = useState('');
    const [formCredentials, setFormCredentials] = useState<Record<string, string>>({});
    const [formSecretsTouched, setFormSecretsTouched] = useState<Record<string, boolean>>({});
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [formSubmitting, setFormSubmitting] = useState(false);

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/marketplace-accounts');
            setAccounts(res.data.data ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDiagnostics = useCallback(async (id: string) => {
        setDiagLoading(true);
        try {
            const res = await axios.get(`/marketplace-accounts/${id}/diagnostics`);
            setDiagnostics(res.data);
        } catch {
            setDiagnostics(null);
        } finally {
            setDiagLoading(false);
        }
    }, []);

    useEffect(() => { loadAccounts(); }, [loadAccounts]);
    useEffect(() => {
        if (selectedId) loadDiagnostics(selectedId);
        else setDiagnostics(null);
    }, [selectedId, loadDiagnostics]);

    const selected = useMemo(() => accounts.find((a) => a.id === selectedId) ?? null, [accounts, selectedId]);
    const wbExistsActive = useMemo(
        () => accounts.some((a) => a.marketplace === 'WB' && a.lifecycleStatus === 'ACTIVE'),
        [accounts],
    );
    const ozonExistsActive = useMemo(
        () => accounts.some((a) => a.marketplace === 'OZON' && a.lifecycleStatus === 'ACTIVE'),
        [accounts],
    );

    // ─── lifecycle actions
    const onValidate = async (id: string) => {
        if (externalBlocked) return;
        setRefreshing(true);
        setTopMessage(null);
        try {
            await axios.post(`/marketplace-accounts/${id}/validate`);
            setTopMessage({ kind: 'ok', text: 'Валидация выполнена.' });
            await loadAccounts();
            if (selectedId === id) await loadDiagnostics(id);
        } catch (err: any) {
            setTopMessage({ kind: 'err', text: mapServerError(err, externalHint) });
        } finally {
            setRefreshing(false);
        }
    };

    const onDeactivate = async (id: string) => {
        if (writeBlocked) return;
        if (!confirm('Отключить подключение? Историю sync/orders/warehouses это не удаляет.')) return;
        setRefreshing(true);
        setTopMessage(null);
        try {
            await axios.post(`/marketplace-accounts/${id}/deactivate`);
            setTopMessage({ kind: 'ok', text: 'Подключение отключено.' });
            await loadAccounts();
            if (selectedId === id) await loadDiagnostics(id);
        } catch (err: any) {
            setTopMessage({ kind: 'err', text: mapServerError(err, writeHint) });
        } finally {
            setRefreshing(false);
        }
    };

    const onReactivate = async (id: string) => {
        if (externalBlocked) return;
        setRefreshing(true);
        setTopMessage(null);
        try {
            await axios.post(`/marketplace-accounts/${id}/reactivate`);
            setTopMessage({ kind: 'ok', text: 'Подключение реактивировано (запущена проверка ключей).' });
            await loadAccounts();
            if (selectedId === id) await loadDiagnostics(id);
        } catch (err: any) {
            setTopMessage({ kind: 'err', text: mapServerError(err, externalHint) });
        } finally {
            setRefreshing(false);
        }
    };

    // ─── modal helpers
    const openCreate = (marketplace: Marketplace) => {
        if (externalBlocked) return;
        setModalMode('create');
        setModalAccount(null);
        setFormMarketplace(marketplace);
        setFormLabel(MARKETPLACE_LABEL[marketplace]);
        setFormCredentials({});
        setFormSecretsTouched({});
        setShowSecrets({});
        setFormError(null);
    };

    const openEdit = (acc: AccountRow) => {
        if (writeBlocked) return;
        setModalMode('edit');
        setModalAccount(acc);
        setFormMarketplace(acc.marketplace);
        setFormLabel(acc.label);
        setFormCredentials({});
        setFormSecretsTouched({});
        setShowSecrets({});
        setFormError(null);
    };

    const closeModal = () => {
        setModalMode(null);
        setModalAccount(null);
        setFormError(null);
    };

    const requiredFields = useMemo(() => {
        if (formMarketplace === 'WB') return ['apiToken', 'warehouseId'];
        return ['clientId', 'apiKey', 'warehouseId'];
    }, [formMarketplace]);

    const optionalFields = useMemo(() => (formMarketplace === 'WB' ? ['statToken'] : []), [formMarketplace]);

    const isSecretField = (k: string) => k === 'apiToken' || k === 'apiKey' || k === 'statToken';

    const submitForm = async () => {
        setFormError(null);
        const label = formLabel.trim();
        if (!label) { setFormError('Название обязательно.'); return; }

        // Сборка credentials: для CREATE — все required; для EDIT — только тронутые поля.
        const creds: Record<string, string> = {};
        const allFields = [...requiredFields, ...optionalFields];
        for (const k of allFields) {
            const v = (formCredentials[k] ?? '').trim();
            if (modalMode === 'create') {
                if (requiredFields.includes(k) && !v) {
                    setFormError(`Поле «${k}» обязательно.`); return;
                }
                if (v) creds[k] = v;
            } else {
                if (formSecretsTouched[k] && v) creds[k] = v;
            }
        }

        const isCredentialChange = Object.keys(creds).length > 0;
        if (modalMode === 'edit' && !isCredentialChange && label === modalAccount?.label) {
            setFormError('Нет изменений.'); return;
        }
        // EDIT с credentials — попадает под external-API guard.
        if (modalMode === 'edit' && isCredentialChange && externalBlocked) {
            setFormError(externalHint || 'Изменение ключей сейчас заблокировано тарифом.');
            return;
        }
        // CREATE → external-API guard.
        if (modalMode === 'create' && externalBlocked) {
            setFormError(externalHint || 'Создание подключений сейчас заблокировано тарифом.');
            return;
        }
        // EDIT label-only → internal write guard (только SUSPENDED/CLOSED блокируют).
        if (modalMode === 'edit' && !isCredentialChange && writeBlocked) {
            setFormError(writeHint || 'Изменения заблокированы.');
            return;
        }

        setFormSubmitting(true);
        try {
            if (modalMode === 'create') {
                await axios.post('/marketplace-accounts', {
                    marketplace: formMarketplace,
                    label,
                    credentials: creds,
                });
                setTopMessage({ kind: 'ok', text: 'Подключение создано. Запущена проверка ключей.' });
            } else if (modalAccount) {
                const body: any = {};
                if (label !== modalAccount.label) body.label = label;
                if (isCredentialChange) body.credentials = creds;
                await axios.patch(`/marketplace-accounts/${modalAccount.id}`, body);
                setTopMessage({
                    kind: 'ok',
                    text: isCredentialChange
                        ? 'Подключение обновлено. Запущена повторная проверка ключей.'
                        : 'Название подключения обновлено.',
                });
            }
            closeModal();
            await loadAccounts();
            if (selectedId) await loadDiagnostics(selectedId);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const map: Record<string, string> = {
                ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE: 'Активное подключение этого маркетплейса уже есть. Сначала отключите старое.',
                ACCOUNT_LABEL_ALREADY_EXISTS: 'Подключение с таким названием уже есть.',
                CREDENTIALS_MISSING_FIELDS: 'Не все обязательные поля заполнены.',
                CREDENTIALS_UNKNOWN_FIELDS: 'В запросе есть лишние поля.',
                CREDENTIALS_FIELD_INVALID_TYPE: 'Значение должно быть строкой.',
                CREDENTIALS_FIELD_EMPTY: 'Поле credentials не может быть пустым.',
                CREDENTIALS_FIELD_TOO_LONG: 'Значение слишком длинное (>1024).',
                MARKETPLACE_NOT_SUPPORTED: 'Этот маркетплейс пока не поддерживается.',
                ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE: externalHint || 'Действие заблокировано тарифом.',
                TENANT_WRITE_BLOCKED: writeHint || 'Запись заблокирована.',
                LABEL_REQUIRED: 'Название обязательно.',
                UPDATE_EMPTY: 'Нет изменений.',
            };
            setFormError(map[code] ?? err?.response?.data?.message ?? err?.message ?? 'Не удалось сохранить.');
        } finally {
            setFormSubmitting(false);
        }
    };

    // ─── render
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center">
                        <Plug className="h-6 w-6 mr-2 text-blue-600" />
                        Маркетплейс-подключения
                    </h1>
                    <p className="text-xs md:text-sm text-slate-500 mt-1">
                        WB, Ozon — credentials, статусы и диагностика. По одному активному аккаунту на маркетплейс.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {writeBlocked && (
                        <span className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                            <Lock className="h-3.5 w-3.5" />
                            Только чтение
                        </span>
                    )}
                    <button
                        onClick={loadAccounts}
                        disabled={loading || refreshing}
                        className="px-3 py-1.5 text-sm rounded inline-flex items-center gap-1 border border-slate-300 text-slate-600 hover:bg-slate-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
                        Обновить
                    </button>
                </div>
            </div>

            {topMessage && (
                <div className={`text-sm border rounded-md px-3 py-2 flex items-start gap-2 ${
                    topMessage.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : topMessage.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                    {topMessage.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        : topMessage.kind === 'warn' ? <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                    <span>{topMessage.text}</span>
                    <button onClick={() => setTopMessage(null)} className="ml-auto text-current/60 hover:text-current">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Quick add buttons */}
            <div className="flex flex-wrap gap-2">
                {(['WB', 'OZON'] as Marketplace[]).map((mp) => {
                    const blocked = mp === 'WB' ? wbExistsActive : ozonExistsActive;
                    const disabled = externalBlocked || blocked;
                    const reason = blocked
                        ? `Активный ${MARKETPLACE_LABEL[mp]}-аккаунт уже есть. Отключите его прежде чем создавать новый.`
                        : externalBlocked
                            ? externalHint
                            : `Подключить ${MARKETPLACE_LABEL[mp]}`;
                    return (
                        <button
                            key={mp}
                            onClick={() => openCreate(mp)}
                            disabled={disabled}
                            title={reason}
                            className={`text-sm inline-flex items-center px-3 py-1.5 rounded border ${
                                disabled
                                    ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
                                    : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                            }`}
                        >
                            {disabled ? <Lock className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                            Подключить {MARKETPLACE_LABEL[mp]}
                        </button>
                    );
                })}
            </div>

            {/* Master-detail */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* List */}
                <div className="lg:col-span-3 bg-white border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                            <tr>
                                <th className="px-3 py-2 text-left">Подключение</th>
                                <th className="px-3 py-2 text-left">Жизн. цикл</th>
                                <th className="px-3 py-2 text-left">Ключи</th>
                                <th className="px-3 py-2 text-left">Sync</th>
                                <th className="px-3 py-2 text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {accounts.length === 0 && !loading && (
                                <tr><td colSpan={5} className="text-center py-8 text-slate-500">Нет подключений. Используйте кнопки выше.</td></tr>
                            )}
                            {accounts.map((a) => {
                                const active = selectedId === a.id;
                                const isInactive = a.lifecycleStatus === 'INACTIVE';
                                return (
                                    <tr
                                        key={a.id}
                                        onClick={() => setSelectedId(a.id)}
                                        className={`cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${MARKETPLACE_TONE[a.marketplace]}`}>
                                                    {MARKETPLACE_LABEL[a.marketplace]}
                                                </span>
                                                <span className="font-medium text-slate-900">{a.label}</span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-0.5">
                                                {a.credential?.maskedPreview && Object.entries(a.credential.maskedPreview).map(([k, v]) => v && (
                                                    <span key={k} className="font-mono mr-2">{k}={v}</span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${LIFECYCLE_TONE[a.lifecycleStatus]}`}>
                                                {LIFECYCLE_LABEL[a.lifecycleStatus]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${CRED_TONE[a.credentialStatus]}`}>
                                                {CRED_LABEL[a.credentialStatus]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${SYNC_TONE[a.syncHealthStatus]}`}>
                                                {SYNC_LABEL[a.syncHealthStatus]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="inline-flex flex-wrap gap-1 justify-end">
                                                {!isInactive && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onValidate(a.id); }}
                                                        disabled={externalBlocked || refreshing}
                                                        title={externalBlocked ? externalHint : 'Проверить ключи'}
                                                        className={`text-xs inline-flex items-center px-2 py-0.5 rounded border ${
                                                            externalBlocked
                                                                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                                : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                                                        }`}
                                                    >
                                                        <Activity className="h-3 w-3 mr-1" />
                                                        Проверить
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                                                    disabled={writeBlocked}
                                                    title={writeBlocked ? writeHint : 'Изменить'}
                                                    className={`text-xs inline-flex items-center px-2 py-0.5 rounded border ${
                                                        writeBlocked
                                                            ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                            : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <Edit2 className="h-3 w-3 mr-1" />
                                                    Изменить
                                                </button>
                                                {isInactive ? (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onReactivate(a.id); }}
                                                        disabled={externalBlocked || refreshing}
                                                        title={externalBlocked ? externalHint : 'Реактивировать (запустит проверку ключей)'}
                                                        className={`text-xs inline-flex items-center px-2 py-0.5 rounded border ${
                                                            externalBlocked
                                                                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                                : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                                                        }`}
                                                    >
                                                        <Power className="h-3 w-3 mr-1" />
                                                        Включить
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onDeactivate(a.id); }}
                                                        disabled={writeBlocked || refreshing}
                                                        title={writeBlocked ? writeHint : 'Отключить'}
                                                        className={`text-xs inline-flex items-center px-2 py-0.5 rounded border ${
                                                            writeBlocked
                                                                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                                : 'border-amber-300 text-amber-700 hover:bg-amber-50'
                                                        }`}
                                                    >
                                                        <PowerOff className="h-3 w-3 mr-1" />
                                                        Отключить
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Diagnostics panel */}
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md p-4 space-y-3">
                    {!selected && (
                        <div className="text-sm text-slate-500 text-center py-10 flex flex-col items-center gap-2">
                            <ChevronRight className="h-5 w-5 text-slate-300" />
                            Выберите подключение слева, чтобы увидеть диагностику.
                        </div>
                    )}

                    {selected && diagLoading && (
                        <div className="text-sm text-slate-500">Загрузка диагностики...</div>
                    )}

                    {selected && diagnostics && (
                        <>
                            <div>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <h2 className="font-semibold text-slate-900 truncate">{selected.label}</h2>
                                        <div className="text-xs text-slate-500 mt-0.5">
                                            {MARKETPLACE_LABEL[selected.marketplace]} • ID: <span className="font-mono">{selected.id.slice(0, 8)}...</span>
                                        </div>
                                    </div>
                                    <span className={`text-[11px] px-2 py-0.5 rounded ${EFFECTIVE_TONE[diagnostics.effectiveRuntimeState]}`}>
                                        {EFFECTIVE_LABEL[diagnostics.effectiveRuntimeState]}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 mt-2">
                                    {EFFECTIVE_HINT[diagnostics.effectiveRuntimeState]}
                                </p>
                                {diagnostics.effectiveRuntimeReason && (
                                    <p className="text-[10px] text-slate-400 mt-1 font-mono">
                                        {diagnostics.effectiveRuntimeReason}
                                    </p>
                                )}
                            </div>

                            {/* Status layers */}
                            <div className="border-t pt-3 grid grid-cols-3 gap-2 text-[11px]">
                                <StatusLayer
                                    icon={<Activity className="h-3 w-3" />}
                                    title="Жизн. цикл"
                                    valueLabel={LIFECYCLE_LABEL[diagnostics.statusLayers.lifecycle.status]}
                                    tone={LIFECYCLE_TONE[diagnostics.statusLayers.lifecycle.status]}
                                    detail={diagnostics.statusLayers.lifecycle.deactivatedAt
                                        ? `Отключён: ${formatDateTime(diagnostics.statusLayers.lifecycle.deactivatedAt)}`
                                        : null}
                                />
                                <StatusLayer
                                    icon={<KeyRound className="h-3 w-3" />}
                                    title="Ключи"
                                    valueLabel={CRED_LABEL[diagnostics.statusLayers.credential.status]}
                                    tone={CRED_TONE[diagnostics.statusLayers.credential.status]}
                                    detail={diagnostics.statusLayers.credential.lastValidationErrorMessage
                                        ?? (diagnostics.statusLayers.credential.lastValidatedAt
                                            ? `Проверены ${formatDateTime(diagnostics.statusLayers.credential.lastValidatedAt)}`
                                            : null)}
                                    errorCode={diagnostics.statusLayers.credential.lastValidationErrorCode}
                                />
                                <StatusLayer
                                    icon={<RefreshCw className="h-3 w-3" />}
                                    title="Sync"
                                    valueLabel={SYNC_LABEL[diagnostics.statusLayers.syncHealth.status]}
                                    tone={SYNC_TONE[diagnostics.statusLayers.syncHealth.status]}
                                    detail={diagnostics.statusLayers.syncHealth.lastSyncErrorMessage
                                        ?? (diagnostics.statusLayers.syncHealth.lastSyncAt
                                            ? `Последний sync ${formatDateTime(diagnostics.statusLayers.syncHealth.lastSyncAt)}`
                                            : null)}
                                    errorCode={diagnostics.statusLayers.syncHealth.lastSyncErrorCode}
                                />
                            </div>

                            {/* Tenant access state hint */}
                            {diagnostics.tenantAccessState && diagnostics.effectiveRuntimeState === 'PAUSED_BY_TENANT' && (
                                <div className="border-t pt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
                                    <PauseCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                    <span>
                                        Подписка: <span className="font-mono">{diagnostics.tenantAccessState}</span>. Внешние API-вызовы приостановлены до возобновления подписки.
                                    </span>
                                </div>
                            )}

                            {/* Recent events */}
                            <div className="border-t pt-3">
                                <h3 className="text-xs font-semibold uppercase text-slate-600 mb-1">События</h3>
                                <div className="max-h-72 overflow-y-auto -mx-1">
                                    {diagnostics.recentEvents.length === 0 && (
                                        <div className="text-xs text-slate-400 italic">Событий пока нет.</div>
                                    )}
                                    {diagnostics.recentEvents.map((ev) => (
                                        <div key={ev.id} className="px-1 py-1 border-b border-slate-50 last:border-0 text-[11px]">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-mono text-slate-700">{shortenEvent(ev.eventType)}</span>
                                                <span className="text-slate-400">{formatDateTime(ev.createdAt)}</span>
                                            </div>
                                            {ev.payload && (
                                                <div className="text-slate-500 truncate">{summarizePayload(ev.eventType, ev.payload)}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Modal */}
            {modalMode && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-full overflow-y-auto">
                        <div className="px-4 py-3 border-b flex items-center justify-between">
                            <h2 className="text-base font-semibold text-slate-900">
                                {modalMode === 'create' ? 'Подключить' : 'Изменить'} {MARKETPLACE_LABEL[formMarketplace]}
                            </h2>
                            <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="block text-xs text-slate-600 mb-1">Название</label>
                                <input
                                    value={formLabel}
                                    onChange={(e) => setFormLabel(e.target.value)}
                                    maxLength={128}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                                    placeholder={MARKETPLACE_LABEL[formMarketplace] + ' Основной'}
                                />
                            </div>

                            {modalMode === 'edit' && modalAccount?.credential?.maskedPreview && (
                                <div className="bg-slate-50 rounded p-2 text-[11px] space-y-0.5">
                                    <div className="text-slate-500 uppercase">Текущие ключи (маска):</div>
                                    {Object.entries(modalAccount.credential.maskedPreview).map(([k, v]) => v && (
                                        <div key={k} className="font-mono text-slate-700">{k}: {v}</div>
                                    ))}
                                    <div className="text-slate-400 pt-1">Заполните только те поля, что хотите обновить.</div>
                                </div>
                            )}

                            {[...requiredFields, ...optionalFields].map((field) => (
                                <CredentialField
                                    key={field}
                                    field={field}
                                    isSecret={isSecretField(field)}
                                    isRequired={modalMode === 'create' && requiredFields.includes(field)}
                                    value={formCredentials[field] ?? ''}
                                    show={!!showSecrets[field]}
                                    onChange={(v) => {
                                        setFormCredentials((p) => ({ ...p, [field]: v }));
                                        setFormSecretsTouched((p) => ({ ...p, [field]: true }));
                                    }}
                                    onToggleShow={() => setShowSecrets((p) => ({ ...p, [field]: !p[field] }))}
                                    placeholderInEdit={
                                        modalMode === 'edit' && isSecretField(field)
                                            ? 'Не менять'
                                            : undefined
                                    }
                                />
                            ))}

                            {formError && (
                                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                    {formError}
                                </div>
                            )}
                        </div>
                        <div className="px-4 py-3 border-t flex justify-end gap-2">
                            <button onClick={closeModal} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">Отмена</button>
                            <button
                                onClick={submitForm}
                                disabled={formSubmitting}
                                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {formSubmitting ? 'Сохраняем...' : modalMode === 'create' ? 'Создать' : 'Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── small subcomponents ───
function StatusLayer({
    icon, title, valueLabel, tone, detail, errorCode,
}: {
    icon: React.ReactNode;
    title: string;
    valueLabel: string;
    tone: string;
    detail?: string | null;
    errorCode?: string | null;
}) {
    return (
        <div className="bg-slate-50 rounded p-2">
            <div className="flex items-center gap-1 text-[10px] uppercase text-slate-500">
                {icon}
                {title}
            </div>
            <div className={`text-[11px] mt-0.5 inline-block px-1.5 py-0.5 rounded ${tone}`}>{valueLabel}</div>
            {errorCode && <div className="text-[10px] text-slate-400 mt-1 font-mono">{errorCode}</div>}
            {detail && <div className="text-[10px] text-slate-500 mt-0.5">{detail}</div>}
        </div>
    );
}

function CredentialField({
    field, isSecret, isRequired, value, show, onChange, onToggleShow, placeholderInEdit,
}: {
    field: string;
    isSecret: boolean;
    isRequired: boolean;
    value: string;
    show: boolean;
    onChange: (v: string) => void;
    onToggleShow: () => void;
    placeholderInEdit?: string;
}) {
    return (
        <div>
            <label className="block text-xs text-slate-600 mb-1">
                {field}{isRequired && ' *'}
            </label>
            <div className="relative">
                <input
                    type={isSecret && !show ? 'password' : 'text'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholderInEdit ?? (isRequired ? 'обязательное поле' : 'опционально')}
                    className="w-full px-2 py-1.5 pr-9 border border-slate-300 rounded text-sm font-mono"
                    autoComplete="new-password"
                />
                {isSecret && (
                    <button
                        type="button"
                        onClick={onToggleShow}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                )}
            </div>
        </div>
    );
}

function shortenEvent(t: string): string {
    return t.replace(/^marketplace_account_/, '');
}

function summarizePayload(eventType: string, payload: any): string {
    if (!payload) return '';
    if (eventType === 'marketplace_account_credentials_rotated' && payload.fieldsRotated) {
        return `обновлены: ${payload.fieldsRotated.join(', ')}`;
    }
    if (eventType === 'marketplace_account_label_updated' && payload.from && payload.to) {
        return `«${payload.from}» → «${payload.to}»`;
    }
    if (eventType === 'marketplace_account_validation_failed' && payload.errorCode) {
        return `ошибка: ${payload.errorCode}`;
    }
    if (eventType === 'marketplace_account_sync_error_detected' && payload.errorCode) {
        return `ошибка sync: ${payload.errorCode}`;
    }
    if (eventType === 'marketplace_account_paused_by_tenant_state') {
        return `${payload.action ?? '—'} → ${payload.accessState ?? '—'}`;
    }
    return JSON.stringify(payload).slice(0, 80);
}

function mapServerError(err: any, fallback: string): string {
    const code = err?.response?.data?.code;
    const map: Record<string, string> = {
        ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE: fallback || 'Действие заблокировано тарифом.',
        TENANT_WRITE_BLOCKED: fallback || 'Запись заблокирована.',
        ACCOUNT_NOT_FOUND: 'Подключение не найдено.',
        ACCOUNT_INACTIVE: 'Подключение неактивно — реактивируйте сначала.',
        ACCOUNT_HAS_NO_CREDENTIALS: 'Ключи не сохранены — обновите credentials.',
        ACCOUNT_ALREADY_INACTIVE: 'Уже отключено.',
        ACCOUNT_ALREADY_ACTIVE: 'Уже активно.',
        ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE: 'Активный аккаунт этого маркетплейса уже есть.',
    };
    return map[code] ?? err?.response?.data?.message ?? err?.message ?? 'Не удалось выполнить действие.';
}
