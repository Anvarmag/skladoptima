import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Package, Store } from 'lucide-react';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [storeName, setStoreName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { checkAuth } = useAuth();
    const navigate = useNavigate();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await axios.post('/auth/register', { email, password, storeName });
            await checkAuth();
            navigate('/app');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Ошибка регистрации');
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
                    Sklad Optima
                </h2>
                <h3 className="mt-2 text-center text-xl font-medium text-slate-700">
                    Регистрация нового магазина
                </h3>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleRegister}>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Название магазина</label>
                            <div className="mt-1 relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                    <Store size={18} />
                                </div>
                                <input
                                    type="text"
                                    required
                                    value={storeName}
                                    onChange={e => setStoreName(e.target.value)}
                                    placeholder="Например: Мой Бутик"
                                    className="block w-full appearance-none rounded-md border border-slate-300 pl-10 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Email (Логин)</label>
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
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Минимум 6 символов"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="text-red-500 text-sm font-medium border border-red-100 bg-red-50 p-2 rounded">{error}</div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                            >
                                {loading ? 'Создание...' : 'Зарегистрироваться'}
                            </button>
                        </div>

                        <div className="text-center mt-4">
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
