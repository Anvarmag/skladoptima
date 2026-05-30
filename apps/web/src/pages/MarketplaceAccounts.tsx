import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Plug, Plus, Edit2, RefreshCw, Power, PowerOff, X, Lock, AlertCircle,
    CheckCircle2, AlertTriangle, PauseCircle, Activity, ChevronRight,
    KeyRound, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { S, PageHeader, Card, Btn, Badge, Input, Modal, FieldLabel } from '../components/ui';

// ─────────────────────────────── types ───────────────────────────────

const WRITE_BLOCKED_STATES = ['SUSPENDED', 'CLOSED'];
const EXTERNAL_API_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

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
const MARKETPLACE_COLOR: Record<Marketplace, string> = { WB: S.wb, OZON: S.oz };

const FIELD_META: Record<string, { label: string; hint: string; placeholder?: string }> = {
    apiToken: {
        label: 'Токен управления остатками',
        hint: 'ЛК Wildberries → Профиль → Настройки → Доступ к API. Нужны права: Маркетплейс (чтение и запись)',
        placeholder: 'eyJ...',
    },
    warehouseId: {
        label: 'ID склада FBS',
        hint: 'ЛК маркетплейса → Логистика / Поставки → Склады → ID вашего склада FBS',
        placeholder: '123456',
    },
    analyticsToken: {
        label: 'Токен аналитики и юнит-экономики',
        hint: 'ЛК Wildberries → Доступ к API → создайте токен с правами: Статистика + Контент + Финансы + Аналитика (только чтение). Нужен для FBO-остатков, карточек товаров и финансовой аналитики.',
        placeholder: 'eyJ...',
    },
    clientId: {
        label: 'Client ID',
        hint: 'ЛК Ozon → Настройки → API ключи → Client ID',
        placeholder: '123456',
    },
    apiKey: {
        label: 'API-ключ',
        hint: 'ЛК Ozon → Настройки → API ключи → Ключ. Создайте с правами: Контент, Склад, Аналитика, Финансы',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    },
};

// Badge color helpers
function lifecycleBadge(s: LifecycleStatus): { color: string; bg: string } {
    if (s === 'ACTIVE') return { color: S.green, bg: 'rgba(16,185,129,0.10)' };
    return { color: S.sub, bg: '#f1f5f9' };
}
const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = { ACTIVE: 'Активен', INACTIVE: 'Отключён' };

function credBadge(s: CredentialStatus): { color: string; bg: string } {
    if (s === 'VALID') return { color: S.green, bg: 'rgba(16,185,129,0.10)' };
    if (s === 'INVALID') return { color: S.red, bg: 'rgba(239,68,68,0.08)' };
    if (s === 'NEEDS_RECONNECT') return { color: S.amber, bg: 'rgba(245,158,11,0.10)' };
    if (s === 'VALIDATING') return { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
    return { color: S.muted, bg: '#f1f5f9' };
}
const CRED_LABEL: Record<CredentialStatus, string> = {
    VALIDATING: 'Проверяется...',
    VALID: 'Ключи валидны',
    INVALID: 'Ключи невалидны',
    NEEDS_RECONNECT: 'Нужно переподключение',
    UNKNOWN: 'Статус неизвестен',
};

function syncBadge(s: SyncHealthStatus): { color: string; bg: string } {
    if (s === 'HEALTHY') return { color: S.green, bg: 'rgba(16,185,129,0.10)' };
    if (s === 'DEGRADED') return { color: S.amber, bg: 'rgba(245,158,11,0.10)' };
    if (s === 'ERROR') return { color: S.red, bg: 'rgba(239,68,68,0.08)' };
    if (s === 'PAUSED') return { color: S.sub, bg: '#f1f5f9' };
    return { color: S.muted, bg: '#f1f5f9' };
}
const SYNC_LABEL: Record<SyncHealthStatus, string> = {
    HEALTHY: 'Sync исправен',
    DEGRADED: 'Sync с ошибками',
    PAUSED: 'Sync на паузе',
    ERROR: 'Sync сломан',
    UNKNOWN: 'Sync не запускался',
};

function effectiveBadge(s: EffectiveRuntimeState): { color: string; bg: string } {
    if (s === 'OPERATIONAL') return { color: S.green, bg: 'rgba(16,185,129,0.10)' };
    if (s === 'PAUSED_BY_TENANT') return { color: S.amber, bg: 'rgba(245,158,11,0.10)' };
    if (s === 'CREDENTIAL_BLOCKED') return { color: S.red, bg: 'rgba(239,68,68,0.08)' };
    if (s === 'SYNC_DEGRADED') return { color: S.amber, bg: 'rgba(245,158,11,0.10)' };
    return { color: S.sub, bg: '#f1f5f9' };
}
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

    const optionalFields = useMemo(() => (formMarketplace === 'WB' ? ['analyticsToken'] : []), [formMarketplace]);

    const isSecretField = (k: string) => k === 'apiToken' || k === 'apiKey' || k === 'analyticsToken';

    const submitForm = async () => {
        setFormError(null);
        const label = formLabel.trim();
        if (!label) { setFormError('Название обязательно.'); return; }

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
        if (modalMode === 'edit' && isCredentialChange && externalBlocked) {
            setFormError(externalHint || 'Изменение ключей сейчас заблокировано тарифом.');
            return;
        }
        if (modalMode === 'create' && externalBlocked) {
            setFormError(externalHint || 'Создание подключений сейчас заблокировано тарифом.');
            return;
        }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Page header */}
            <PageHeader
                title="Маркетплейс-подключения"
                subtitle="WB, Ozon — credentials, статусы и диагностика. По одному активному аккаунту на маркетплейс."
            >
                {writeBlocked && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 12, padding: '5px 12px', borderRadius: 8,
                        background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)',
                        color: S.amber, fontFamily: 'Inter', fontWeight: 600,
                    }}>
                        <Lock size={13} />
                        Только чтение
                    </span>
                )}
                <Btn
                    variant="secondary"
                    size="sm"
                    onClick={loadAccounts}
                    disabled={loading || refreshing}
                >
                    <RefreshCw size={13} style={{ animation: (loading || refreshing) ? 'spin 0.7s linear infinite' : undefined }} />
                    Обновить
                </Btn>
            </PageHeader>

            {/* Top message banner */}
            {topMessage && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 16px', borderRadius: 10, fontSize: 13, fontFamily: 'Inter',
                    background: topMessage.kind === 'ok'
                        ? 'rgba(16,185,129,0.08)'
                        : topMessage.kind === 'warn'
                            ? 'rgba(245,158,11,0.08)'
                            : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${
                        topMessage.kind === 'ok'
                            ? 'rgba(16,185,129,0.25)'
                            : topMessage.kind === 'warn'
                                ? 'rgba(245,158,11,0.25)'
                                : 'rgba(239,68,68,0.25)'
                    }`,
                    color: topMessage.kind === 'ok' ? S.green
                        : topMessage.kind === 'warn' ? S.amber
                        : S.red,
                }}>
                    {topMessage.kind === 'ok'
                        ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                        : topMessage.kind === 'warn'
                            ? <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                            : <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
                    <span style={{ flex: 1 }}>{topMessage.text}</span>
                    <button
                        onClick={() => setTopMessage(null)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'inherit', opacity: 0.6, display: 'flex', alignItems: 'center' }}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Quick add buttons */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(['WB', 'OZON'] as Marketplace[]).map((mp) => {
                    const blocked = mp === 'WB' ? wbExistsActive : ozonExistsActive;
                    const disabled = externalBlocked || blocked;
                    const reason = blocked
                        ? `Активный ${MARKETPLACE_LABEL[mp]}-аккаунт уже есть. Отключите его прежде чем создавать новый.`
                        : externalBlocked
                            ? externalHint
                            : `Подключить ${MARKETPLACE_LABEL[mp]}`;
                    return (
                        <Btn
                            key={mp}
                            variant={mp === 'WB' ? 'wb' : 'oz'}
                            size="sm"
                            onClick={() => openCreate(mp)}
                            disabled={disabled}
                            title={reason}
                        >
                            {disabled ? <Lock size={13} /> : <Plus size={13} />}
                            Подключить {MARKETPLACE_LABEL[mp]}
                        </Btn>
                    );
                })}
            </div>

            {/* Master-detail layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
                    {/* Accounts table */}
                    <Card noPad>
                        {/* Table header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                            alignItems: 'center',
                            padding: '10px 16px',
                            borderBottom: `1px solid ${S.border}`,
                            background: '#f8fafc',
                            borderRadius: '16px 16px 0 0',
                        }}>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Подключение</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Жизн. цикл</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ключи</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sync</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>Действия</div>
                        </div>

                        {/* Empty state */}
                        {accounts.length === 0 && !loading && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 24px' }}>
                                <Plug size={28} color={S.muted} style={{ opacity: 0.4 }} />
                                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                                    Нет подключений. Используйте кнопки выше.
                                </span>
                            </div>
                        )}

                        {/* Rows */}
                        {accounts.map((a, idx) => {
                            const isActive = selectedId === a.id;
                            const isInactive = a.lifecycleStatus === 'INACTIVE';
                            const mpColor = MARKETPLACE_COLOR[a.marketplace];
                            const lc = lifecycleBadge(a.lifecycleStatus);
                            const cr = credBadge(a.credentialStatus);
                            const sy = syncBadge(a.syncHealthStatus);
                            return (
                                <div
                                    key={a.id}
                                    onClick={() => setSelectedId(a.id)}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        borderBottom: idx < accounts.length - 1 ? `1px solid ${S.border}` : 'none',
                                        background: isActive ? 'rgba(59,130,246,0.04)' : '#fff',
                                        borderLeft: `3px solid ${mpColor}`,
                                        cursor: 'pointer',
                                        transition: 'background 0.12s',
                                        ...(idx === accounts.length - 1 ? { borderRadius: '0 0 16px 16px' } : {}),
                                    }}
                                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'; }}
                                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#fff'; }}
                                >
                                    {/* Name + masked preview */}
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{
                                                fontFamily: 'Inter', fontWeight: 700, fontSize: 11,
                                                color: mpColor, background: `${mpColor}14`,
                                                padding: '2px 7px', borderRadius: 99, border: `1px solid ${mpColor}33`,
                                                flexShrink: 0,
                                            }}>
                                                {MARKETPLACE_LABEL[a.marketplace]}
                                            </span>
                                            <span style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {a.label}
                                            </span>
                                        </div>
                                        {a.credential?.maskedPreview && (
                                            <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                {Object.entries(a.credential.maskedPreview).map(([k, v]) => v && (
                                                    <span key={k} style={{ fontFamily: 'monospace', fontSize: 10, color: S.muted }}>
                                                        {k}={v}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Lifecycle */}
                                    <div>
                                        <Badge label={LIFECYCLE_LABEL[a.lifecycleStatus]} color={lc.color} bg={lc.bg} />
                                    </div>

                                    {/* Credential */}
                                    <div>
                                        <Badge label={CRED_LABEL[a.credentialStatus]} color={cr.color} bg={cr.bg} />
                                    </div>

                                    {/* Sync */}
                                    <div>
                                        <Badge label={SYNC_LABEL[a.syncHealthStatus]} color={sy.color} bg={sy.bg} />
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        {!isInactive && (
                                            <Btn
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => onValidate(a.id)}
                                                disabled={externalBlocked || refreshing}
                                                title={externalBlocked ? externalHint : 'Проверить ключи'}
                                            >
                                                <Activity size={12} />
                                                Проверить
                                            </Btn>
                                        )}
                                        <Btn
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => openEdit(a)}
                                            disabled={writeBlocked}
                                            title={writeBlocked ? writeHint : 'Изменить'}
                                        >
                                            <Edit2 size={12} />
                                            Изменить
                                        </Btn>
                                        {isInactive ? (
                                            <Btn
                                                size="sm"
                                                variant="success"
                                                onClick={() => onReactivate(a.id)}
                                                disabled={externalBlocked || refreshing}
                                                title={externalBlocked ? externalHint : 'Реактивировать (запустит проверку ключей)'}
                                            >
                                                <Power size={12} />
                                                Включить
                                            </Btn>
                                        ) : (
                                            <Btn
                                                size="sm"
                                                variant="danger"
                                                onClick={() => onDeactivate(a.id)}
                                                disabled={writeBlocked || refreshing}
                                                title={writeBlocked ? writeHint : 'Отключить'}
                                            >
                                                <PowerOff size={12} />
                                                Отключить
                                            </Btn>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </Card>

                    {/* Diagnostics panel */}
                    <Card style={{ display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'start' }}>
                        {!selected && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', gap: 10 }}>
                                <ChevronRight size={32} color={S.muted} style={{ opacity: 0.4 }} />
                                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, textAlign: 'center' }}>
                                    Выберите подключение слева, чтобы увидеть диагностику.
                                </span>
                            </div>
                        )}

                        {selected && diagLoading && (
                            <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, padding: '16px 0' }}>
                                Загрузка диагностики...
                            </div>
                        )}

                        {selected && diagnostics && (
                            <>
                                {/* Header */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <h2 style={{
                                                fontFamily: 'Inter', fontWeight: 700, fontSize: 15,
                                                color: S.ink, margin: 0,
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                {selected.label}
                                            </h2>
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 3 }}>
                                                {MARKETPLACE_LABEL[selected.marketplace]} · ID:{' '}
                                                <span style={{ fontFamily: 'monospace' }}>{selected.id.slice(0, 8)}...</span>
                                            </div>
                                        </div>
                                        <Badge
                                            label={EFFECTIVE_LABEL[diagnostics.effectiveRuntimeState]}
                                            {...effectiveBadge(diagnostics.effectiveRuntimeState)}
                                            style={{ flexShrink: 0 }}
                                        />
                                    </div>
                                    <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                                        {EFFECTIVE_HINT[diagnostics.effectiveRuntimeState]}
                                    </p>
                                    {diagnostics.effectiveRuntimeReason && (
                                        <p style={{ fontFamily: 'monospace', fontSize: 10, color: S.muted, marginTop: 4, marginBottom: 0 }}>
                                            {diagnostics.effectiveRuntimeReason}
                                        </p>
                                    )}
                                </div>

                                {/* Status layers */}
                                <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                                    <StatusLayer
                                        icon={<Activity size={12} color={S.muted} />}
                                        title="Жизн. цикл"
                                        valueLabel={LIFECYCLE_LABEL[diagnostics.statusLayers.lifecycle.status]}
                                        badge={lifecycleBadge(diagnostics.statusLayers.lifecycle.status)}
                                        detail={diagnostics.statusLayers.lifecycle.deactivatedAt
                                            ? `Отключён: ${formatDateTime(diagnostics.statusLayers.lifecycle.deactivatedAt)}`
                                            : null}
                                    />
                                    <StatusLayer
                                        icon={<KeyRound size={12} color={S.muted} />}
                                        title="Ключи"
                                        valueLabel={CRED_LABEL[diagnostics.statusLayers.credential.status]}
                                        badge={credBadge(diagnostics.statusLayers.credential.status)}
                                        detail={diagnostics.statusLayers.credential.lastValidationErrorMessage
                                            ?? (diagnostics.statusLayers.credential.lastValidatedAt
                                                ? `Проверены ${formatDateTime(diagnostics.statusLayers.credential.lastValidatedAt)}`
                                                : null)}
                                        errorCode={diagnostics.statusLayers.credential.lastValidationErrorCode}
                                    />
                                    <StatusLayer
                                        icon={<RefreshCw size={12} color={S.muted} />}
                                        title="Sync"
                                        valueLabel={SYNC_LABEL[diagnostics.statusLayers.syncHealth.status]}
                                        badge={syncBadge(diagnostics.statusLayers.syncHealth.status)}
                                        detail={diagnostics.statusLayers.syncHealth.lastSyncErrorMessage
                                            ?? (diagnostics.statusLayers.syncHealth.lastSyncAt
                                                ? `Последний sync ${formatDateTime(diagnostics.statusLayers.syncHealth.lastSyncAt)}`
                                                : null)}
                                        errorCode={diagnostics.statusLayers.syncHealth.lastSyncErrorCode}
                                    />
                                </div>

                                {/* Tenant access state hint */}
                                {diagnostics.tenantAccessState && diagnostics.effectiveRuntimeState === 'PAUSED_BY_TENANT' && (
                                    <div style={{
                                        borderTop: `1px solid ${S.border}`, paddingTop: 12,
                                        display: 'flex', alignItems: 'flex-start', gap: 8,
                                        padding: '10px 12px', borderRadius: 8,
                                        background: 'rgba(245,158,11,0.08)',
                                        border: '1px solid rgba(245,158,11,0.25)',
                                    }}>
                                        <PauseCircle size={14} color={S.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.amber, lineHeight: 1.5 }}>
                                            Подписка:{' '}
                                            <span style={{ fontFamily: 'monospace' }}>{diagnostics.tenantAccessState}</span>.{' '}
                                            Внешние API-вызовы приостановлены до возобновления подписки.
                                        </span>
                                    </div>
                                )}

                                {/* Recent events */}
                                <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
                                    <div style={{
                                        fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                                        color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em',
                                        marginBottom: 8,
                                    }}>
                                        События
                                    </div>
                                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        {diagnostics.recentEvents.length === 0 && (
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>
                                                Событий пока нет.
                                            </div>
                                        )}
                                        {diagnostics.recentEvents.map((ev) => (
                                            <div key={ev.id} style={{
                                                padding: '7px 10px', borderRadius: 8,
                                                background: '#f8fafc', border: `1px solid ${S.border}`,
                                                marginBottom: 4,
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: S.ink, fontWeight: 600 }}>
                                                        {shortenEvent(ev.eventType)}
                                                    </span>
                                                    <span style={{ fontFamily: 'Inter', fontSize: 10, color: S.muted, flexShrink: 0 }}>
                                                        {formatDateTime(ev.createdAt)}
                                                    </span>
                                                </div>
                                                {ev.payload && (
                                                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {summarizePayload(ev.eventType, ev.payload)}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </Card>
                </div>
            </div>

            {/* Create / Edit modal */}
            <Modal
                open={!!modalMode}
                onClose={closeModal}
                title={`${modalMode === 'create' ? 'Подключить' : 'Изменить'} ${MARKETPLACE_LABEL[formMarketplace]}`}
                width={520}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* How-to hint for create */}
                    {modalMode === 'create' && (
                        <div style={{
                            padding: '12px 14px', borderRadius: 10,
                            background: formMarketplace === 'WB' ? 'rgba(203,17,171,0.05)' : 'rgba(0,91,255,0.05)',
                            border: `1px solid ${formMarketplace === 'WB' ? 'rgba(203,17,171,0.2)' : 'rgba(0,91,255,0.2)'}`,
                            fontFamily: 'Inter', fontSize: 12, lineHeight: 1.6,
                            color: S.ink,
                        }}>
                            {formMarketplace === 'WB' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ fontWeight: 700, color: S.wb, marginBottom: 2 }}>Как подключить WB</div>
                                    <div style={{ fontWeight: 600, color: S.ink }}>Токен для управления остатками (обязательно)</div>
                                    <div>1. ЛК Wildberries → <b>Профиль</b> → <b>Настройки</b> → <b>Доступ к API</b></div>
                                    <div>2. Создайте токен с правами: <b>Маркетплейс (чтение и запись)</b></div>
                                    <div>3. ID склада FBS: <b>Поставки</b> → <b>Склады</b> → скопируйте ID</div>
                                    <div style={{ fontWeight: 600, color: S.ink, marginTop: 4 }}>Токен для аналитики (необязательно)</div>
                                    <div>4. Создайте второй токен с правами: <b>Статистика</b> + <b>Контент</b> + <b>Финансы</b> + <b>Аналитика</b> (только чтение)</div>
                                    <div style={{ color: S.sub, marginTop: 2 }}>Без него FBO-остатки и карточки товаров не загружаются.</div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ fontWeight: 700, color: S.oz, marginBottom: 2 }}>Как получить ключ Ozon</div>
                                    <div>1. Войдите в ЛК Ozon → <b>Настройки</b> → <b>API ключи</b> → <b>Добавить ключ</b></div>
                                    <div>2. Роль: <b>Admin</b> или создайте с правами: <b>Контент</b>, <b>Склад</b>, <b>Аналитика</b>, <b>Финансы</b></div>
                                    <div>3. ID склада: <b>Логистика</b> → <b>Мои склады</b> → ID вашего FBS-склада</div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Label */}
                    <div>
                        <FieldLabel>Название подключения</FieldLabel>
                        <Input
                            value={formLabel}
                            onChange={(e) => setFormLabel(e.target.value)}
                            placeholder={MARKETPLACE_LABEL[formMarketplace] + ' Основной'}
                        />
                    </div>

                    {/* Masked preview for edit */}
                    {modalMode === 'edit' && modalAccount?.credential?.maskedPreview && (
                        <div style={{
                            padding: '10px 12px', borderRadius: 8,
                            background: '#f8fafc', border: `1px solid ${S.border}`,
                        }}>
                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                Текущие ключи (маска)
                            </div>
                            {Object.entries(modalAccount.credential.maskedPreview).map(([k, v]) => v && (
                                <div key={k} style={{ fontFamily: 'monospace', fontSize: 12, color: S.ink }}>{k}: {v}</div>
                            ))}
                            <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 6 }}>
                                Заполните только те поля, что хотите обновить.
                            </div>
                        </div>
                    )}

                    {/* Credential fields for WB */}
                    {formMarketplace === 'WB' ? (
                        <>
                            <div>
                                <FieldLabel>Токен для управления остатками и заказами</FieldLabel>
                            </div>
                            {requiredFields.map((field) => (
                                <CredentialField
                                    key={field}
                                    field={field}
                                    isSecret={isSecretField(field)}
                                    isRequired={modalMode === 'create'}
                                    value={formCredentials[field] ?? ''}
                                    show={!!showSecrets[field]}
                                    onChange={(v) => {
                                        setFormCredentials((p) => ({ ...p, [field]: v }));
                                        setFormSecretsTouched((p) => ({ ...p, [field]: true }));
                                    }}
                                    onToggleShow={() => setShowSecrets((p) => ({ ...p, [field]: !p[field] }))}
                                    placeholderInEdit={modalMode === 'edit' && isSecretField(field) ? 'Не менять' : undefined}
                                />
                            ))}
                            <div>
                                <FieldLabel>
                                    Токен для аналитики{' '}
                                    <span style={{ textTransform: 'none', fontWeight: 400 }}>(необязательно)</span>
                                </FieldLabel>
                            </div>
                            {optionalFields.map((field) => (
                                <CredentialField
                                    key={field}
                                    field={field}
                                    isSecret={isSecretField(field)}
                                    isRequired={false}
                                    value={formCredentials[field] ?? ''}
                                    show={!!showSecrets[field]}
                                    onChange={(v) => {
                                        setFormCredentials((p) => ({ ...p, [field]: v }));
                                        setFormSecretsTouched((p) => ({ ...p, [field]: true }));
                                    }}
                                    onToggleShow={() => setShowSecrets((p) => ({ ...p, [field]: !p[field] }))}
                                    placeholderInEdit={modalMode === 'edit' && isSecretField(field) ? 'Не менять' : undefined}
                                />
                            ))}
                        </>
                    ) : (
                        [...requiredFields, ...optionalFields].map((field) => (
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
                                placeholderInEdit={modalMode === 'edit' && isSecretField(field) ? 'Не менять' : undefined}
                            />
                        ))
                    )}

                    {/* Form error */}
                    {formError && (
                        <div style={{
                            padding: '10px 12px', borderRadius: 8,
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                            fontFamily: 'Inter', fontSize: 12, color: S.red,
                        }}>
                            {formError}
                        </div>
                    )}

                    {/* Modal actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${S.border}`, paddingTop: 16, marginTop: 4 }}>
                        <Btn variant="ghost" onClick={closeModal}>Отмена</Btn>
                        <Btn variant="primary" onClick={submitForm} disabled={formSubmitting}>
                            {formSubmitting ? 'Сохраняем...' : modalMode === 'create' ? 'Создать' : 'Сохранить'}
                        </Btn>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

// ─── StatusLayer subcomponent ───
function StatusLayer({
    icon, title, valueLabel, badge, detail, errorCode,
}: {
    icon: React.ReactNode;
    title: string;
    valueLabel: string;
    badge: { color: string; bg: string };
    detail?: string | null;
    errorCode?: string | null;
}) {
    return (
        <div style={{
            background: '#f8fafc', borderRadius: 10, padding: '10px 10px 8px',
            border: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', gap: 5,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {icon}
                <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {title}
                </span>
            </div>
            <Badge label={valueLabel} color={badge.color} bg={badge.bg} />
            {errorCode && (
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: S.muted }}>{errorCode}</div>
            )}
            {detail && (
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: S.sub, lineHeight: 1.4 }}>{detail}</div>
            )}
        </div>
    );
}

// ─── CredentialField subcomponent ───
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
    const meta = FIELD_META[field];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.ink }}>
                {meta?.label ?? field}
                {isRequired && <span style={{ color: S.red, marginLeft: 2 }}>*</span>}
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                    type={isSecret && !show ? 'password' : 'text'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholderInEdit ?? meta?.placeholder ?? (isRequired ? 'обязательное поле' : 'опционально')}
                    autoComplete="new-password"
                    style={{
                        width: '100%', padding: isSecret ? '8px 36px 8px 12px' : '8px 12px',
                        borderRadius: 8, border: `1px solid ${S.border}`,
                        fontFamily: 'monospace', fontSize: 12, color: S.ink,
                        background: '#fff', outline: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        boxSizing: 'border-box',
                    }}
                />
                {isSecret && (
                    <button
                        type="button"
                        onClick={onToggleShow}
                        style={{
                            position: 'absolute', right: 10,
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: 0, color: S.muted, display: 'flex', alignItems: 'center',
                        }}
                    >
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                )}
            </div>
            {meta?.hint && (
                <p style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, margin: 0, lineHeight: 1.5 }}>
                    {meta.hint}
                </p>
            )}
        </div>
    );
}

// ─── utility functions ───
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
