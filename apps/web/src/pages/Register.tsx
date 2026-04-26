import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [registered, setRegistered] = useState(false);

    const navigate = useNavigate();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await axios.post('/auth/register', { email, password });
            setRegistered(true);
        } catch (err: any) {
            const code = err.response?.data?.code;
            if (code === 'AUTH_EMAIL_TAKEN') {
                setError('Этот email уже зарегистрирован');
            } else if (code === 'AUTH_PHONE_TAKEN') {
                setError('Этот телефон уже зарегистрирован');
            } else {
                setError(err.response?.data?.message || 'Ошибка регистрации');
            }
        } finally {
            setLoading(false);
        }
    };

    if (registered) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">✉️</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Проверьте почту</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Мы отправили письмо с подтверждением на <strong>{email}</strong>.
                            Перейдите по ссылке в письме, чтобы активировать аккаунт.
                        </p>
                        <button
                            onClick={() => navigate('/login')}
                            className="text-sm text-blue-600 hover:text-blue-500 font-medium"
                        >
                            Перейти ко входу
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
                    Sklad Optima
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600">Регистрация нового аккаунта</p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleRegister}>
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
                            <label className="block text-sm font-medium text-slate-700">Пароль</label>
                            <div className="mt-1">
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Минимум 8 символов"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm font-medium border border-red-100 bg-red-50 p-2 rounded">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                        >
                            {loading ? 'Создание...' : 'Зарегистрироваться'}
                        </button>

                        <div className="text-center">
                            <Link to="/login" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                                Уже есть аккаунт? Войти
                            </Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
