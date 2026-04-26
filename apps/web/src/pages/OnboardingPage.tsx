import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Building2, ArrowRight, Check } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { onboardingApi, OnboardingState } from '../api/onboarding';

const TAX_SYSTEMS = [
    { value: 'USN_6',  label: 'УСН 6% (доходы)' },
    { value: 'USN_15', label: 'УСН 15% (доходы минус расходы)' },
    { value: 'OSNO',   label: 'ОСНО' },
    { value: 'NPD',    label: 'НПД (самозанятый)' },
];

const COUNTRIES = [
    { value: 'RU', label: 'Россия' },
    { value: 'BY', label: 'Беларусь' },
    { value: 'KZ', label: 'Казахстан' },
    { value: 'UZ', label: 'Узбекистан' },
    { value: 'AM', label: 'Армения' },
    { value: 'GE', label: 'Грузия' },
];

const CURRENCIES = [
    { value: 'RUB', label: 'RUB — Российский рубль' },
    { value: 'BYN', label: 'BYN — Белорусский рубль' },
    { value: 'KZT', label: 'KZT — Тенге' },
    { value: 'UZS', label: 'UZS — Узбекский сум' },
    { value: 'AMD', label: 'AMD — Армянский драм' },
    { value: 'GEL', label: 'GEL — Грузинский лари' },
    { value: 'USD', label: 'USD — Доллар США' },
    { value: 'EUR', label: 'EUR — Евро' },
];

const TIMEZONES = [
    { value: 'Europe/Moscow',      label: 'Москва (UTC+3)' },
    { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
    { value: 'Europe/Minsk',       label: 'Минск (UTC+3)' },
    { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
    { value: 'Asia/Omsk',          label: 'Омск (UTC+6)' },
    { value: 'Asia/Krasnoyarsk',   label: 'Красноярск (UTC+7)' },
    { value: 'Asia/Irkutsk',       label: 'Иркутск (UTC+8)' },
    { value: 'Asia/Yakutsk',       label: 'Якутск (UTC+9)' },
    { value: 'Asia/Vladivostok',   label: 'Владивосток (UTC+10)' },
    { value: 'Asia/Almaty',        label: 'Алматы (UTC+6)' },
    { value: 'Asia/Tashkent',      label: 'Ташкент (UTC+5)' },
    { value: 'Asia/Yerevan',       label: 'Ереван (UTC+4)' },
    { value: 'Asia/Tbilisi',       label: 'Тбилиси (UTC+4)' },
    { value: 'UTC',                label: 'UTC' },
];

const WIZARD_STEPS = [
    { key: 'welcome', label: 'Добро пожаловать' },
    { key: 'setup_company', label: 'Создайте компанию' },
];

export default function OnboardingPage() {
    const navigate = useNavigate();
    const { checkAuth } = useAuth();

    const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
    const [loadingState, setLoadingState] = useState(true);
    const [activeStep, setActiveStep] = useState<'welcome' | 'setup_company'>('welcome');

    const [form, setForm] = useState({
        name: '',
        inn: '',
        legalName: '',
        taxSystem: 'USN_6',
        country: 'RU',
        currency: 'RUB',
        timezone: 'Europe/Moscow',
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        initState();
    }, []);

    const initState = async () => {
        try {
            let s = await onboardingApi.getState();
            if (!s) s = await onboardingApi.start();
            setOnboardingState(s);
            // Resume: go to setup_company if user was already there
            const setupStep = s?.steps.find((st) => st.key === 'setup_company');
            if (s?.lastStepKey === 'setup_company' || setupStep?.status === 'VIEWED') {
                setActiveStep('setup_company');
            }
        } catch {
            // Fallback: show welcome step without state tracking
        } finally {
            setLoadingState(false);
        }
    };

    // Mark welcome as viewed when shown
    useEffect(() => {
        if (activeStep === 'welcome' && onboardingState) {
            const step = onboardingState.steps.find((s) => s.key === 'welcome');
            if (step && step.status === 'PENDING') {
                onboardingApi.updateStep('welcome', 'viewed')
                    .then((s) => { if (s) setOnboardingState(s); })
                    .catch(() => {});
            }
        }
    }, [activeStep, onboardingState]);

    const goToSetupCompany = async () => {
        try {
            const updated = await onboardingApi.updateStep('setup_company', 'viewed');
            if (updated) setOnboardingState(updated);
        } catch { /* non-fatal */ }
        setActiveStep('setup_company');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleCreateCompany = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        setSubmitting(true);
        try {
            await axios.post('/tenants', {
                name: form.name.trim(),
                inn: form.inn.trim(),
                legalName: form.legalName.trim() || undefined,
                taxSystem: form.taxSystem,
                country: form.country,
                currency: form.currency,
                timezone: form.timezone,
            });
            await checkAuth();
            navigate('/app', { replace: true });
        } catch (err: any) {
            const code = err.response?.data?.message?.code ?? err.response?.data?.code;
            if (code === 'TENANT_INN_ALREADY_EXISTS') {
                setFormError('Компания с таким ИНН уже зарегистрирована в системе.');
            } else {
                setFormError('Не удалось создать компанию. Проверьте данные и попробуйте ещё раз.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const inputClass = 'w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
    const labelClass = 'block text-sm font-medium text-slate-700 mb-1';

    if (loadingState) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-sm text-slate-500">Загрузка...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-6">
                {WIZARD_STEPS.map((step, i) => {
                    const stateStep = onboardingState?.steps.find((s) => s.key === step.key);
                    const isDone = stateStep?.status === 'DONE';
                    const isCurrent = activeStep === step.key;
                    return (
                        <div key={step.key} className="flex items-center">
                            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-colors ${
                                isDone
                                    ? 'bg-green-500 text-white'
                                    : isCurrent
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-500'
                            }`}>
                                {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                            </div>
                            <span className={`ml-2 text-sm hidden sm:block ${isCurrent ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
                                {step.label}
                            </span>
                            {i < WIZARD_STEPS.length - 1 && (
                                <div className="ml-3 w-8 h-px bg-slate-300" />
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="w-full max-w-lg bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                {activeStep === 'welcome' ? (
                    <div className="text-center">
                        <Package className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">Добро пожаловать!</h1>
                        <p className="text-slate-500 mb-2 text-sm leading-relaxed">
                            Sklad Optima — система управления складскими остатками для маркетплейсов.
                        </p>
                        <p className="text-slate-400 mb-8 text-sm leading-relaxed">
                            Подключите Wildberries или Ozon, загрузите каталог товаров и отслеживайте остатки в реальном времени.
                        </p>
                        <button
                            onClick={goToSetupCompany}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm py-2.5 rounded-md transition-colors"
                        >
                            Создать компанию
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 mb-6">
                            <Building2 className="h-8 w-8 text-blue-600 flex-shrink-0" />
                            <div>
                                <h1 className="text-xl font-bold text-slate-900">Создайте компанию</h1>
                                <p className="text-sm text-slate-500">Добавьте данные вашей организации</p>
                            </div>
                        </div>

                        {formError && (
                            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3">
                                {formError}
                            </div>
                        )}

                        <form onSubmit={handleCreateCompany} className="space-y-4">
                            <div>
                                <label className={labelClass}>Название компании *</label>
                                <input
                                    name="name"
                                    value={form.name}
                                    onChange={handleChange}
                                    required
                                    minLength={2}
                                    maxLength={255}
                                    placeholder="ООО Ромашка"
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>ИНН *</label>
                                <input
                                    name="inn"
                                    value={form.inn}
                                    onChange={handleChange}
                                    required
                                    pattern="^\d{10}(\d{2})?$"
                                    placeholder="10 или 12 цифр"
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Юридическое наименование</label>
                                <input
                                    name="legalName"
                                    value={form.legalName}
                                    onChange={handleChange}
                                    maxLength={255}
                                    placeholder="Полное официальное название (необязательно)"
                                    className={inputClass}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>Система налогообложения *</label>
                                    <select name="taxSystem" value={form.taxSystem} onChange={handleChange} className={inputClass}>
                                        {TAX_SYSTEMS.map((t) => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>Страна *</label>
                                    <select name="country" value={form.country} onChange={handleChange} className={inputClass}>
                                        {COUNTRIES.map((c) => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>Валюта *</label>
                                    <select name="currency" value={form.currency} onChange={handleChange} className={inputClass}>
                                        {CURRENCIES.map((c) => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>Часовой пояс *</label>
                                    <select name="timezone" value={form.timezone} onChange={handleChange} className={inputClass}>
                                        {TIMEZONES.map((t) => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium text-sm py-2.5 rounded-md transition-colors mt-2"
                            >
                                {submitting ? 'Создание...' : 'Создать компанию'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveStep('welcome')}
                                className="w-full text-sm text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                ← Назад
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
