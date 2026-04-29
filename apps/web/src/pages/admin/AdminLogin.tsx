import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { extractApiError } from '../../api/admin';

type LoginState = 'idle' | 'soft_locked' | 'inactive';

/// Изолированный admin login. Намеренно отличается визуально от tenant
/// `Login.tsx` — оператор сразу видит, что входит в internal control plane,
/// а не в tenant-кабинет (см. §4 frontend-правил аналитики).
export default function AdminLogin() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [state, setState] = useState<LoginState>('idle');
    const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const { login } = useAdminAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setState('idle');
        setSubmitting(true);
        try {
            await login(email.trim(), password);
            navigate('/admin', { replace: true });
        } catch (err) {
            const apiErr = extractApiError(err);
            switch (apiErr.code) {
                case 'ADMIN_AUTH_SOFT_LOCKED':
                    setState('soft_locked');
                    setRetryAfterSeconds(apiErr.retryAfterSeconds ?? 900);
                    break;
                case 'ADMIN_AUTH_INACTIVE':
                    setState('inactive');
                    break;
                case 'ADMIN_AUTH_INVALID_CREDENTIALS':
                    setError('Неверный email или пароль');
                    break;
                default:
                    setError('Не удалось войти. Попробуйте позже.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (state === 'soft_locked') {
        return (
            <Shell>
                <div className="text-center">
                    <div className="text-4xl mb-3">🔒</div>
                    <h2 className="text-xl font-semibold text-white mb-2">Слишком много попыток</h2>
                    <p className="text-sm text-slate-300 mb-6">
                        Internal login временно заблокирован. Попробуйте через{' '}
                        <strong>{Math.ceil(retryAfterSeconds / 60)} мин.</strong>
                    </p>
                    <button
                        onClick={() => setState('idle')}
                        className="text-sm text-slate-400 hover:text-white"
                    >
                        ← Назад
                    </button>
                </div>
            </Shell>
        );
    }

    if (state === 'inactive') {
        return (
            <Shell>
                <div className="text-center">
                    <div className="text-4xl mb-3">⚠️</div>
                    <h2 className="text-xl font-semibold text-white mb-2">
                        Учётная запись неактивна
                    </h2>
                    <p className="text-sm text-slate-300 mb-6">
                        Обратитесь к support lead для активации support-аккаунта.
                    </p>
                    <button
                        onClick={() => setState('idle')}
                        className="text-sm text-slate-400 hover:text-white"
                    >
                        ← Назад
                    </button>
                </div>
            </Shell>
        );
    }

    return (
        <Shell>
            <div className="flex justify-center text-amber-400 mb-2">
                <ShieldAlert size={42} />
            </div>
            <h2 className="text-center text-2xl font-bold tracking-tight text-white">
                Internal Admin
            </h2>
            <p className="mt-1 text-center text-xs uppercase tracking-wider text-amber-400 font-bold">
                Support control plane
            </p>
            <form className="space-y-5 mt-6" onSubmit={handleSubmit}>
                <div>
                    <label className="block text-sm font-medium text-slate-200">Operator email</label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="username"
                        placeholder="support@example.com"
                        className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 text-slate-100 px-3 py-2 placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 sm:text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-200">Пароль</label>
                    <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 text-slate-100 px-3 py-2 placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 sm:text-sm"
                    />
                </div>

                {error && (
                    <div className="text-red-400 text-sm font-medium bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full justify-center rounded-md bg-amber-500 py-2.5 px-4 text-sm font-bold text-slate-900 shadow-sm hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:bg-amber-700 disabled:text-slate-400"
                >
                    {submitting ? 'Вход...' : 'Войти в admin'}
                </button>
            </form>
            <p className="mt-6 text-center text-xs text-slate-500">
                Это внутренний support-контур. Ваши действия логируются.
            </p>
        </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl sm:rounded-lg sm:px-10">
                    {children}
                </div>
            </div>
        </div>
    );
}
