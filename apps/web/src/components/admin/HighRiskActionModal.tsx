import { useState, useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { extractApiError } from '../../api/admin';

interface BaseProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description: string;
    confirmLabel: string;
    /// Доп. поля формы кроме reason — рендерятся над reason textarea.
    /// Сами доп. поля управляют своим валидным состоянием через `extraValid`.
    extraFields?: React.ReactNode;
    extraValid?: boolean;
    /// Возвращает domain-action promise. Если резолвится — модал закрывается
    /// и зовёт `onSuccess`. При rejection — показывает текст ошибки.
    onSubmit: (reason: string) => Promise<void>;
    onSuccess?: () => void;
}

const REASON_MIN = 10;
const REASON_MAX = 2000;

/// Универсальный modal для high-risk support actions. Гарантии (см. §10/§15
/// аналитики 19-admin):
///   • reason обязателен и проверяется перед submit (>= 10 символов);
///   • визуально выделен amber/red как destructive surface — оператор видит,
///     что делает не "ещё одно сохранение", а audited mutation;
///   • двойное подтверждение только на UI-уровне — финальная защита всё равно
///     в backend (DTO + AccessStatePolicy + AdminRoles guard).
export default function HighRiskActionModal({
    open,
    onClose,
    title,
    description,
    confirmLabel,
    extraFields,
    extraValid = true,
    onSubmit,
    onSuccess,
}: BaseProps) {
    const [reason, setReason] = useState('');
    const [confirmTyped, setConfirmTyped] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setReason('');
            setConfirmTyped(false);
            setSubmitting(false);
            setError(null);
        }
    }, [open]);

    if (!open) return null;

    const trimmed = reason.trim();
    const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
    const canSubmit = reasonValid && confirmTyped && extraValid && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit(trimmed);
            onSuccess?.();
            onClose();
        } catch (err) {
            const apiErr = extractApiError(err);
            setError(formatActionError(apiErr.code, apiErr.message));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-2xl w-full max-w-lg border-2 border-amber-300"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-amber-50 rounded-t-lg">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-6 w-6 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                            <p className="text-xs text-amber-800 mt-1 font-medium">
                                High-risk action · попадёт в audit
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-1"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <p className="text-sm text-slate-700">{description}</p>

                    {extraFields}

                    <div>
                        <label className="block text-sm font-semibold text-slate-700">
                            Reason / комментарий <span className="text-red-600">*</span>
                        </label>
                        <p className="text-xs text-slate-500 mb-1.5">
                            Минимум {REASON_MIN} символов. Будет сохранено в audit log
                            и доступно другим support-операторам.
                        </p>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            maxLength={REASON_MAX}
                            placeholder="Например: тикет #1234 — клиент не получил продление платежа, проверено по billing logs"
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            autoFocus
                        />
                        <div className="text-xs mt-1 flex justify-between">
                            <span
                                className={
                                    reasonValid
                                        ? 'text-green-600'
                                        : trimmed.length > 0
                                          ? 'text-red-600'
                                          : 'text-slate-400'
                                }
                            >
                                {trimmed.length < REASON_MIN
                                    ? `Ещё ${REASON_MIN - trimmed.length} симв.`
                                    : 'Reason достаточный'}
                            </span>
                            <span className="text-slate-400">
                                {trimmed.length} / {REASON_MAX}
                            </span>
                        </div>
                    </div>

                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={confirmTyped}
                            onChange={(e) => setConfirmTyped(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-sm text-slate-700">
                            Я понимаю, что действие зафиксируется в audit от моего имени
                            и его нельзя «откатить» автоматически.
                        </span>
                    </label>

                    {error && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-50"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="inline-flex items-center px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md"
                        >
                            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function formatActionError(code?: string, message?: string): string {
    switch (code) {
        case 'FORBIDDEN':
        case 'ADMIN_RBAC_DENIED':
        case 'SUPPORT_ADMIN_REQUIRED':
            return 'Недостаточно прав. Требуется роль SUPPORT_ADMIN.';
        case 'BILLING_OVERRIDE_NOT_ALLOWED':
            return 'Billing override запрещён для support в MVP — обратитесь к product owner.';
        case 'ACTION_NOT_ALLOWED_FOR_STATE':
        case 'CONFLICT':
            return 'Текущий state tenant не допускает эту транзицию. Проверьте subscription history.';
        case 'REASON_REQUIRED':
        case 'VALIDATION_ERROR':
            return message ?? 'Reason должен быть не короче 10 символов.';
        case 'ADMIN_TENANT_NOT_FOUND':
            return 'Tenant не найден.';
        case 'ADMIN_USER_ID_INVALID':
        case 'ADMIN_TENANT_ID_INVALID':
            return 'Некорректный идентификатор.';
        default:
            return message ?? 'Не удалось выполнить действие. Проверьте audit log.';
    }
}
