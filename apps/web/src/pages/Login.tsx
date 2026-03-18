import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { checkAuth, isTelegram, linkAccountViaTelegram } = useAuth() as any;
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (isTelegram) {
                await linkAccountViaTelegram(email, password);
            } else {
                await axios.post('/auth/login', { email, password });
                await checkAuth();
            }
            navigate('/app');
        } catch (err: any) {
            const msg = err.response?.data?.message;
            if (msg === 'telegram_already_linked_elsewhere') {
                setError('Этот Telegram уже привязан к другому аккаунту');
            } else {
                setError(msg || 'Ошибка входа');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center text-blue-600">
                    <Package size={48} />
                </div>
                <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-slate-900">
                    {isTelegram ? 'Привязка аккаунта' : 'Sklad Optima'}
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600">
                    Управление остатками
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Логин</label>
                            <div className="mt-1">
                                <input
                                    type="text"
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="Введите логин"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Пароль</label>
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
                            <div className="text-red-500 text-sm font-medium">{error}</div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                            >
                                {loading ? 'Вход...' : 'Войти'}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-sm text-slate-600">
                            Нет аккаунта?{' '}
                            <Link to="/register" className="font-medium text-blue-600 hover:text-blue-500">
                                Зарегистрировать магазин
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
