import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

type PageState = 'loading' | 'success' | 'already_verified' | 'expired' | 'invalid' | 'resent';

export default function VerifyEmail() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const resendMode = searchParams.get('resend') === '1';
    const emailParam = searchParams.get('email') ?? '';

    const [state, setState] = useState<PageState>(token ? 'loading' : 'invalid');
    const [resendEmail, setResendEmail] = useState(emailParam);
    const [resendLoading, setResendLoading] = useState(false);
    const [resendError, setResendError] = useState('');

    useEffect(() => {
        if (!token) return;
        axios.post('/auth/email-verifications/confirm', { token })
            .then(res => {
                setState(res.data.status === 'ALREADY_VERIFIED' ? 'already_verified' : 'success');
            })
            .catch(err => {
                const code = err.response?.data?.code;
                setState(code === 'AUTH_VERIFICATION_TOKEN_EXPIRED' ? 'expired' : 'invalid');
            });
    }, [token]);

    const handleResend = async (e: React.FormEvent) => {
        e.preventDefault();
        setResendError('');
        setResendLoading(true);
        try {
            await axios.post('/auth/email-verifications', { email: resendEmail });
            setState('resent');
        } catch (err: any) {
            const code = err.response?.data?.code;
            if (code === 'AUTH_RESEND_TOO_SOON') {
                const sec = err.response?.data?.retryAfterSeconds ?? 60;
                setResendError(`Подождите ${sec} сек. перед повторной отправкой`);
            } else if (code === 'AUTH_RESEND_LIMIT_EXCEEDED') {
                setResendError('Превышен лимит отправок. Попробуйте позже.');
            } else {
                setResendError('Ошибка отправки. Попробуйте позже.');
            }
        } finally {
            setResendLoading(false);
        }
    };

    const card = (icon: string, title: string, body: React.ReactNode) => (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                    <div className="text-4xl mb-4">{icon}</div>
                    <h2 className="text-xl font-semibold text-slate-900 mb-3">{title}</h2>
                    {body}
                </div>
            </div>
        </div>
    );

    if (state === 'loading') return card('⏳', 'Подтверждение...', <p className="text-sm text-slate-500">Проверяем ссылку</p>);

    if (state === 'success') return card('✅', 'Email подтверждён!',
        <>
            <p className="text-sm text-slate-600 mb-6">Аккаунт активирован. Теперь вы можете войти.</p>
            <button onClick={() => navigate('/login')} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Войти
            </button>
        </>
    );

    if (state === 'already_verified') return card('✅', 'Уже подтверждён',
        <>
            <p className="text-sm text-slate-600 mb-6">Ваш email уже был подтверждён ранее.</p>
            <Link to="/login" className="text-sm text-blue-600 hover:text-blue-500 font-medium">Войти</Link>
        </>
    );

    if (state === 'resent') return card('✉️', 'Письмо отправлено',
        <p className="text-sm text-slate-600">Проверьте почту <strong>{resendEmail}</strong> и перейдите по ссылке.</p>
    );

    const resendForm = (title: string, description: string, icon: string) => card(icon, title,
        <>
            <p className="text-sm text-slate-600 mb-6">{description}</p>
            <form onSubmit={handleResend} className="text-left space-y-4">
                <input
                    type="email"
                    required
                    value={resendEmail}
                    onChange={e => setResendEmail(e.target.value)}
                    placeholder="Ваш email"
                    className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                />
                {resendError && <p className="text-red-600 text-xs">{resendError}</p>}
                <button
                    type="submit"
                    disabled={resendLoading}
                    className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-400"
                >
                    {resendLoading ? 'Отправка...' : 'Отправить новую ссылку'}
                </button>
            </form>
            <div className="mt-4">
                <Link to="/login" className="text-xs text-slate-500 hover:text-slate-700">← Назад ко входу</Link>
            </div>
        </>
    );

    if (state === 'expired' || resendMode)
        return resendForm('Ссылка устарела', 'Ссылка для подтверждения истекла. Введите email, чтобы получить новую.', '⏰');

    return resendForm('Ссылка недействительна', 'Ссылка уже использована или недействительна. Вы можете запросить новую.', '❌');
}
