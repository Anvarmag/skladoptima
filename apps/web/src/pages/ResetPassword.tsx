import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';

type PageState = 'form' | 'success' | 'expired' | 'invalid';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') ?? '';

    const [newPassword, setNewPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [state, setState] = useState<PageState>(token ? 'form' : 'invalid');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await axios.post('/auth/password-resets/confirm', { token, newPassword });
            setState('success');
        } catch (err: any) {
            const code = err.response?.data?.code;
            if (code === 'AUTH_RESET_TOKEN_EXPIRED') {
                setState('expired');
            } else if (code === 'AUTH_RESET_TOKEN_INVALID') {
                setState('invalid');
            } else {
                setError(err.response?.data?.message || 'Ошибка. Попробуйте ещё раз.');
            }
        } finally {
            setLoading(false);
        }
    };

    if (state === 'success') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">✅</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Пароль изменён</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Все активные сессии завершены. Войдите с новым паролем.
                        </p>
                        <button
                            onClick={() => navigate('/login')}
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                            Войти
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (state === 'expired') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">⏰</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Ссылка устарела</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Ссылка для сброса пароля действует 24 часа. Запросите новую.
                        </p>
                        <Link
                            to="/forgot-password"
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                            Запросить новую ссылку
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (state === 'invalid') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">❌</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Ссылка недействительна</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Ссылка уже использована или недействительна.
                        </p>
                        <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                            Запросить новую ссылку
                        </Link>
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
                    Новый пароль
                </h2>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Новый пароль</label>
                            <div className="mt-1">
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    placeholder="Минимум 8 символов"
                                    className="block w-full appearance-none rounded-md border border-slate-300 px-3 py-2 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm bg-red-50 border border-red-100 rounded px-3 py-2">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full justify-center rounded-md bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                        >
                            {loading ? 'Сохранение...' : 'Установить новый пароль'}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <Link to="/login" className="text-sm text-slate-500 hover:text-slate-700">
                            ← Назад ко входу
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
