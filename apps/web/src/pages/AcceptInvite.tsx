import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Package, CheckCircle, XCircle, Clock, AlertTriangle, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type AcceptState =
    | 'loading'
    | 'need_auth'
    | 'success'
    | 'already_member'
    | 'expired'
    | 'used'
    | 'mismatch'
    | 'not_verified'
    | 'not_found'
    | 'tenant_blocked'
    | 'error';

const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Владелец',
    ADMIN: 'Администратор',
    MANAGER: 'Менеджер',
    STAFF: 'Сотрудник',
};

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <Link to="/app" className="flex justify-center mb-6">
                    <Package className="h-10 w-10 text-blue-600" />
                </Link>
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
                    <div className="flex justify-center mb-4">{icon}</div>
                    <h2 className="text-xl font-semibold text-slate-900 mb-3">{title}</h2>
                    {children}
                </div>
            </div>
        </div>
    );
}

export default function AcceptInvite() {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();

    const [state, setState] = useState<AcceptState>('loading');
    const [acceptedRole, setAcceptedRole] = useState<string | null>(null);

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            setState('need_auth');
            return;
        }

        if (!token) {
            setState('not_found');
            return;
        }

        axios.post(`/team/invitations/${token}/accept`)
            .then(res => {
                const data = res.data;
                setAcceptedRole(data.role ?? null);
                if (data.status === 'ALREADY_ACCEPTED' || data.status === 'ALREADY_MEMBER') {
                    setState('already_member');
                } else {
                    setState('success');
                }
            })
            .catch(err => {
                const code = err.response?.data?.code;
                const map: Record<string, AcceptState> = {
                    INVITATION_EXPIRED: 'expired',
                    INVITATION_ALREADY_USED: 'used',
                    INVITATION_EMAIL_MISMATCH: 'mismatch',
                    AUTH_EMAIL_NOT_VERIFIED: 'not_verified',
                    TEAM_WRITE_BLOCKED_BY_TENANT_STATE: 'tenant_blocked',
                    INVITATION_NOT_FOUND: 'not_found',
                };
                setState(map[code] ?? 'error');
            });
    }, [user, authLoading, token]);

    if (state === 'loading') return (
        <Card icon={<Clock className="h-12 w-12 text-slate-400" />} title="Обрабатываем приглашение...">
            <p className="text-sm text-slate-500">Пожалуйста, подождите</p>
        </Card>
    );

    if (state === 'need_auth') return (
        <Card icon={<Mail className="h-12 w-12 text-blue-600" />} title="Войдите, чтобы принять приглашение">
            <p className="text-sm text-slate-600 mb-6">
                Для принятия приглашения необходимо войти в аккаунт.
                Если у вас ещё нет аккаунта — зарегистрируйтесь, а после подтверждения email вернитесь по этой ссылке.
            </p>
            <div className="flex flex-col gap-3">
                <Link
                    to={`/login?redirect=/invite/${token}`}
                    className="block w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 text-center"
                >
                    Войти
                </Link>
                <Link
                    to="/register"
                    className="block w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 text-center"
                >
                    Зарегистрироваться
                </Link>
            </div>
        </Card>
    );

    if (state === 'success') return (
        <Card icon={<CheckCircle className="h-12 w-12 text-green-500" />} title="Приглашение принято!">
            <p className="text-sm text-slate-600 mb-6">
                {acceptedRole
                    ? `Вы вошли в команду с ролью «${ROLE_LABELS[acceptedRole] ?? acceptedRole}».`
                    : 'Вы успешно вошли в команду.'
                }{' '}
                Теперь вам доступны все функции приложения.
            </p>
            <button
                onClick={() => navigate('/app')}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
                Перейти в приложение
            </button>
        </Card>
    );

    if (state === 'already_member') return (
        <Card icon={<CheckCircle className="h-12 w-12 text-blue-500" />} title="Вы уже в команде">
            <p className="text-sm text-slate-600 mb-6">
                Это приглашение уже было принято. Вы состоите в команде.
            </p>
            <button
                onClick={() => navigate('/app')}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
                Перейти в приложение
            </button>
        </Card>
    );

    if (state === 'expired') return (
        <Card icon={<Clock className="h-12 w-12 text-amber-500" />} title="Приглашение истекло">
            <p className="text-sm text-slate-600 mb-6">
                Срок действия этого приглашения истёк (7 дней с момента отправки).
                Попросите администратора или владельца команды выслать новое.
            </p>
            <Link to="/app" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                Перейти в приложение
            </Link>
        </Card>
    );

    if (state === 'used') return (
        <Card icon={<XCircle className="h-12 w-12 text-slate-400" />} title="Приглашение недействительно">
            <p className="text-sm text-slate-600 mb-6">
                Это приглашение уже было использовано или отменено.
                Если вам нужен доступ, попросите администратора выслать новое приглашение.
            </p>
            <Link to="/app" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                Перейти в приложение
            </Link>
        </Card>
    );

    if (state === 'mismatch') return (
        <Card icon={<AlertTriangle className="h-12 w-12 text-amber-500" />} title="Неверный аккаунт">
            <p className="text-sm text-slate-600 mb-6">
                Это приглашение предназначено для другого email-адреса.
                Войдите в аккаунт, зарегистрированный на адрес, на который пришло приглашение.
            </p>
            <div className="flex flex-col gap-3">
                <Link
                    to={`/login?redirect=/invite/${token}`}
                    className="block w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 text-center"
                >
                    Войти в другой аккаунт
                </Link>
                <Link
                    to="/app"
                    className="text-sm text-slate-500 hover:text-slate-700"
                >
                    Остаться в текущем аккаунте
                </Link>
            </div>
        </Card>
    );

    if (state === 'not_verified') return (
        <Card icon={<Mail className="h-12 w-12 text-amber-500" />} title="Email не подтверждён">
            <p className="text-sm text-slate-600 mb-6">
                Чтобы принять приглашение, необходимо сначала подтвердить email вашего аккаунта.
                После подтверждения вернитесь по этой ссылке.
            </p>
            <Link
                to="/verify-email?resend=1"
                className="inline-block rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
                Подтвердить email
            </Link>
        </Card>
    );

    if (state === 'tenant_blocked') return (
        <Card icon={<XCircle className="h-12 w-12 text-red-500" />} title="Приглашение недоступно">
            <p className="text-sm text-slate-600">
                Компания, в которую вас пригласили, приостановила работу или закрыта.
                Обратитесь к администратору или свяжитесь с поддержкой.
            </p>
        </Card>
    );

    if (state === 'not_found') return (
        <Card icon={<XCircle className="h-12 w-12 text-red-500" />} title="Ссылка недействительна">
            <p className="text-sm text-slate-600 mb-6">
                Эта ссылка на приглашение недействительна. Возможно, она устарела или была отменена.
            </p>
            <Link to="/app" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                Перейти в приложение
            </Link>
        </Card>
    );

    return (
        <Card icon={<XCircle className="h-12 w-12 text-red-500" />} title="Что-то пошло не так">
            <p className="text-sm text-slate-600 mb-6">
                Не удалось обработать приглашение. Попробуйте ещё раз или обратитесь к администратору.
            </p>
            <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 mr-3"
            >
                Попробовать снова
            </button>
            <Link to="/app" className="text-sm text-blue-600 hover:text-blue-500 font-medium">
                В приложение
            </Link>
        </Card>
    );
}
