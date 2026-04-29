import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { adminAuthApi, extractApiError } from '../../api/admin';
import { useAdminAuth } from '../../context/AdminAuthContext';

export default function AdminChangePassword() {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const { logout } = useAdminAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (next !== confirm) {
            setError('Новый пароль и подтверждение не совпадают.');
            return;
        }
        if (next.length < 8) {
            setError('Новый пароль должен быть не короче 8 символов.');
            return;
        }
        setSubmitting(true);
        try {
            await adminAuthApi.changePassword(current, next);
            setSuccess(true);
            // backend revoked все остальные сессии оператора — текущая жива.
            // Локально на всякий случай подождём 1.2с и закроем всё.
            setTimeout(async () => {
                await logout();
                navigate('/admin/login', { replace: true });
            }, 1200);
        } catch (err) {
            const apiErr = extractApiError(err);
            switch (apiErr.code) {
                case 'ADMIN_AUTH_INVALID_CURRENT_PASSWORD':
                    setError('Текущий пароль введён неверно.');
                    break;
                case 'ADMIN_AUTH_NEW_PASSWORD_SAME_AS_CURRENT':
                    setError('Новый пароль не должен совпадать с текущим.');
                    break;
                default:
                    setError(apiErr.message ?? 'Не удалось сменить пароль.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-md">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Смена пароля</h1>
            <p className="text-sm text-slate-500 mb-6">
                После смены пароля все остальные ваши admin-сессии будут отозваны для безопасности.
            </p>

            {success ? (
                <div className="bg-green-50 border border-green-200 rounded-md p-4 text-green-800">
                    Пароль успешно изменён. Перевожу на страницу логина…
                </div>
            ) : (
                <form
                    onSubmit={handleSubmit}
                    className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-slate-700">
                            Текущий пароль
                        </label>
                        <input
                            type="password"
                            value={current}
                            onChange={(e) => setCurrent(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700">
                            Новый пароль
                        </label>
                        <input
                            type="password"
                            value={next}
                            onChange={(e) => setNext(e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700">
                            Повторите новый пароль
                        </label>
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                            autoComplete="new-password"
                            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex items-center px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md"
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <KeyRound className="h-4 w-4 mr-2" />
                        )}
                        Сменить пароль
                    </button>
                </form>
            )}
        </div>
    );
}
