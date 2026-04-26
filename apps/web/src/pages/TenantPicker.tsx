import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Lock, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ACCESS_STATE_LABEL: Record<string, { label: string; color: string }> = {
    EARLY_ACCESS:  { label: 'Ранний доступ',  color: 'text-blue-600 bg-blue-50' },
    TRIAL_ACTIVE:  { label: 'Пробный период', color: 'text-green-700 bg-green-50' },
    TRIAL_EXPIRED: { label: 'Пробный истёк',  color: 'text-red-700 bg-red-50' },
    ACTIVE_PAID:   { label: 'Активна',         color: 'text-green-700 bg-green-50' },
    GRACE_PERIOD:  { label: 'Льготный период', color: 'text-yellow-700 bg-yellow-50' },
    SUSPENDED:     { label: 'Приостановлена',  color: 'text-orange-700 bg-orange-50' },
    CLOSED:        { label: 'Закрыта',         color: 'text-slate-600 bg-slate-100' },
};

export default function TenantPicker() {
    const navigate = useNavigate();
    const { tenants, switchTenant } = useAuth();
    const [switching, setSwitching] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSwitch = async (tenantId: string) => {
        setSwitching(tenantId);
        setError(null);
        try {
            await switchTenant(tenantId);
            navigate('/app', { replace: true });
        } catch {
            setError('Не удалось переключить компанию. Попробуйте ещё раз.');
            setSwitching(null);
        }
    };

    const available = tenants.filter((t) => t.isAvailable);
    const unavailable = tenants.filter((t) => !t.isAvailable);

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-6">
                    <Building2 className="h-10 w-10 text-blue-600 mx-auto mb-3" />
                    <h1 className="text-xl font-bold text-slate-900">Выберите компанию</h1>
                    <p className="text-sm text-slate-500 mt-1">Для продолжения выберите компанию из списка</p>
                </div>

                {error && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {available.map((tenant) => {
                        const badge = ACCESS_STATE_LABEL[tenant.accessState];
                        const isLoading = switching === tenant.id;
                        return (
                            <button
                                key={tenant.id}
                                onClick={() => handleSwitch(tenant.id)}
                                disabled={isLoading || switching !== null}
                                className="w-full flex items-center gap-3 px-4 py-4 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 disabled:opacity-60 text-left"
                            >
                                <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                    <Building2 className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-900 truncate">{tenant.name}</div>
                                    {badge && (
                                        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 ${badge.color}`}>
                                            {badge.label}
                                        </span>
                                    )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                            </button>
                        );
                    })}

                    {unavailable.map((tenant) => {
                        const badge = ACCESS_STATE_LABEL[tenant.accessState] ?? ACCESS_STATE_LABEL.CLOSED;
                        return (
                            <div
                                key={tenant.id}
                                className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 last:border-0 opacity-60"
                            >
                                <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                                    <Lock className="h-5 w-5 text-slate-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-500 truncate">{tenant.name}</div>
                                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 ${badge.color}`}>
                                        {badge.label}
                                    </span>
                                    <div className="text-xs text-slate-400 mt-0.5">Обратитесь в службу поддержки</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={() => navigate('/onboarding')}
                    className="mt-4 w-full flex items-center justify-center gap-2 text-sm text-slate-600 hover:text-blue-600 py-3 rounded-lg border border-dashed border-slate-300 hover:border-blue-400 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                    Добавить новую компанию
                </button>
            </div>
        </div>
    );
}
