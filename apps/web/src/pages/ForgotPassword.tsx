import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await axios.post('/auth/password-resets', { email });
        } catch {
            // нейтральный ответ — ошибку не показываем
        } finally {
            setSent(true);
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                        <div className="text-4xl mb-4">✉️</div>
                        <h2 className="text-xl font-semibold text-slate-900 mb-2">Проверьте почту</h2>
                        <p className="text-sm text-slate-600 mb-6">
                            Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля.
                        </p>
                        <Link to="/login" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                            ← Назад ко входу
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
                    Сброс пароля
                </h2>
                <p className="mt-2 text-center text-sm text-slate-600">
                    Введите email и мы пришлём ссылку для сброса
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                    <form className="space-y-6" onSubmit={handleSubmit}>
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

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full justify-center rounded-md bg-blue-600 py-3 px-4 text-base font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                        >
                            {loading ? 'Отправка...' : 'Отправить ссылку'}
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
