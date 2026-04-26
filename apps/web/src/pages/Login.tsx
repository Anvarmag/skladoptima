import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';

type LoginState = 'idle' | 'verify_email' | 'soft_locked';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [state, setState] = useState<LoginState>('idle');
    const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

    const { checkAuth, isTelegram, linkAccountViaTelegram } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirectTo = searchParams.get('redirect') ?? '/app';

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setState('idle');
        setLoading(true);

        try {
            if (isTelegram) {
                await linkAccountViaTelegram(email, password);
                navigate('/app');
                return;
            }

            await axios.post('/auth/login', { email, password });
            const route = await checkAuth();
            navigate(route ?? redirectTo);
        } catch (err: any) {
            const code = err.response?.data?.code;
            const msg = err.response?.data?.message;

            if (code === 'AUTH_EMAIL_NOT_VERIFIED') {
                setState('verify_email');
            } else if (code === 'AUTH_ACCOUNT_SOFT_LOCKED') {
                setState('soft_locked');
                setRetryAfterSeconds(err.response?.data?.retryAfterSeconds ?? 60);
            } else if (code === 'AUTH_ACCOUNT_LOCKED') {
                setError('Аккаунт заблокирован. Обратитесь в поддержку.');
            } else if (msg === 'telegram_already_linked_elsewhere') {
                setError('Этот Telegram уже привязан к другому аккаунту');
            } else {
                setError('Неверный email или пароль');
            }
        } finally {
            setLoading(false);
        }
    };

    if (state === 'verify_email') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">✉️</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Подтвердите email</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Ссылка для подтверждения отправлена на <strong>{email}</strong>.
                            Проверьте почту и перейдите по ссылке.
                        </p>
                        <Link
                            to={`/verify-email?resend=1&email=${encodeURIComponent(email)}`}
                            className="text-sm text-blue-600 hover:text-blue-500 font-medium"
                        >
                            Отправить письмо повторно
                        </Link>
                        <div className="mt-4">
                            <button
                                onClick={() => setState('idle')}
                                className="text-sm text-slate-500 hover:text-slate-700"
                            >
                                ← Назад
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (state === 'soft_locked') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">🔒</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Слишком много попыток</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Вход временно заблокирован. Попробуйте через{' '}
                            <strong>{Math.ceil(retryAfterSeconds / 60)} мин.</strong>
                        </p>
                        <button
                            onClick={() => setState('idle')}
                            className="text-sm text-slate-500 hover:text-slate-700"
                        >
                            ← Назад
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center text-blue-600">
                    <Package size={48} />
                </div>
                <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-slate-900">
                    {isTelegram ? 'Привязка аккаунта' : 'Sklad Optima'}
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600">Управление остатками</p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Email</label>
                            <div className="mt-1">
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="email@example.com"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-slate-700">Пароль</label>
                                {!isTelegram && (
                                    <Link
                                        to="/forgot-password"
                                        className="text-xs text-blue-600 hover:text-blue-500"
                                    >
                                        Забыли пароль?
                                    </Link>
                                )}
                            </div>
                            <div className="mt-1">
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Введите пароль"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-100 rounded px-3 py-2">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                        >
                            {loading ? 'Вход...' : 'Войти'}
                        </button>
                    </form>

                    {!isTelegram && (
                        <div className="mt-6 text-center">
                            <p className="text-sm text-slate-600">
                                Нет аккаунта?{' '}
                                <Link to="/register" className="font-medium text-blue-600 hover:text-blue-500">
                                    Зарегистрироваться
                                </Link>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
