import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Mail, Plus, RefreshCw, X, LogOut, AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Member {
    membershipId: string;
    userId: string;
    email: string;
    role: string;
    joinedAt: string;
}

interface Invitation {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: string;
    acceptedAt: string | null;
    cancelledAt: string | null;
    invitedBy: { id: string; email: string } | null;
    createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Владелец',
    ADMIN: 'Администратор',
    MANAGER: 'Менеджер',
    STAFF: 'Сотрудник',
};

const ROLE_COLORS: Record<string, string> = {
    OWNER: 'bg-blue-100 text-blue-800',
    ADMIN: 'bg-violet-100 text-violet-800',
    MANAGER: 'bg-green-100 text-green-800',
    STAFF: 'bg-slate-100 text-slate-600',
};

const INV_STATUS_LABELS: Record<string, string> = {
    PENDING: 'Ожидает',
    ACCEPTED: 'Принято',
    EXPIRED: 'Истёк',
    CANCELLED: 'Отменено',
};

const INV_STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    ACCEPTED: 'bg-green-100 text-green-800',
    EXPIRED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-slate-100 text-slate-600',
};

const WRITE_BLOCKED = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

function writeBlockMessage(accessState: string): string {
    if (accessState === 'CLOSED') return 'Компания закрыта. Управление командой недоступно.';
    if (accessState === 'SUSPENDED') return 'Доступ приостановлен. Изменения команды заблокированы.';
    if (accessState === 'TRIAL_EXPIRED') return 'Пробный период истёк. Изменения команды недоступны до оформления подписки.';
    return '';
}

function canManageInvites(role: string): boolean {
    return role === 'OWNER' || role === 'ADMIN';
}

function canRemoveMember(actorRole: string, targetRole: string): boolean {
    if (actorRole === 'OWNER') return true;
    if (actorRole === 'ADMIN') return targetRole === 'MANAGER' || targetRole === 'STAFF';
    return false;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function RoleBadge({ role }: { role: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role] ?? 'bg-slate-100 text-slate-600'}`}>
            {ROLE_LABELS[role] ?? role}
        </span>
    );
}

function InvStatusBadge({ status }: { status: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${INV_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
            {INV_STATUS_LABELS[status] ?? status}
        </span>
    );
}

export default function Team() {
    const { user, activeTenant } = useAuth();
    const role = activeTenant?.role ?? '';
    const accessState = activeTenant?.accessState ?? '';
    const isWriteBlocked = WRITE_BLOCKED.has(accessState);

    const [tab, setTab] = useState<'members' | 'invitations'>('members');
    const [members, setMembers] = useState<Member[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [loadingInvitations, setLoadingInvitations] = useState(false);
    const [membersError, setMembersError] = useState('');

    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('MANAGER');
    const [inviting, setInviting] = useState(false);
    const [inviteError, setInviteError] = useState('');
    const [inviteSuccess, setInviteSuccess] = useState('');

    const [busyMember, setBusyMember] = useState<string | null>(null);
    const [busyInvite, setBusyInvite] = useState<string | null>(null);
    const [toast, setToast] = useState('');

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }

    const loadMembers = useCallback(async () => {
        setLoadingMembers(true);
        setMembersError('');
        try {
            const res = await axios.get('/team/members');
            setMembers(res.data);
        } catch {
            setMembersError('Не удалось загрузить список участников');
        } finally {
            setLoadingMembers(false);
        }
    }, []);

    const loadInvitations = useCallback(async () => {
        setLoadingInvitations(true);
        try {
            const res = await axios.get('/team/invitations');
            setInvitations(res.data);
        } finally {
            setLoadingInvitations(false);
        }
    }, []);

    useEffect(() => {
        if (role === 'STAFF') return;
        loadMembers();
        if (canManageInvites(role)) loadInvitations();
    }, [role, loadMembers, loadInvitations]);

    // STAFF: no access
    if (role === 'STAFF') {
        return (
            <div className="max-w-lg mx-auto mt-12 text-center">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10">
                    <Lock className="mx-auto h-10 w-10 text-slate-400 mb-4" />
                    <h2 className="text-lg font-semibold text-slate-900 mb-2">Нет доступа</h2>
                    <p className="text-sm text-slate-500">
                        Раздел «Команда» недоступен для роли «Сотрудник».
                        Обратитесь к владельцу или администратору, если вам нужен доступ.
                    </p>
                </div>
            </div>
        );
    }

    const handleSendInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setInviteError('');
        setInviteSuccess('');
        setInviting(true);
        try {
            await axios.post('/team/invitations', { email: inviteEmail, role: inviteRole });
            setInviteSuccess(`Приглашение отправлено на ${inviteEmail}`);
            setInviteEmail('');
            loadInvitations();
        } catch (err: any) {
            const code = err.response?.data?.code;
            const msgs: Record<string, string> = {
                INVITATION_ALREADY_PENDING: 'Для этого email уже есть активное приглашение',
                INVITATION_ALREADY_MEMBER: 'Этот пользователь уже состоит в команде',
                INVITATION_SELF_INVITE: 'Нельзя пригласить самого себя',
                ROLE_CHANGE_NOT_ALLOWED: 'Эта роль недоступна для приглашения',
                TEAM_WRITE_BLOCKED_BY_TENANT_STATE: 'Изменения команды заблокированы статусом компании',
            };
            setInviteError(msgs[code] ?? 'Ошибка отправки приглашения. Попробуйте ещё раз.');
        } finally {
            setInviting(false);
        }
    };

    const handleChangeRole = async (membershipId: string, newRole: string) => {
        setBusyMember(membershipId);
        try {
            await axios.patch(`/team/members/${membershipId}/role`, { role: newRole });
            showToast('Роль изменена');
            loadMembers();
        } catch (err: any) {
            const code = err.response?.data?.code;
            showToast(code === 'LAST_OWNER_GUARD' ? 'Нельзя изменить роль единственного владельца' : 'Не удалось изменить роль');
        } finally {
            setBusyMember(null);
        }
    };

    const handleRemoveMember = async (membershipId: string, email: string) => {
        if (!confirm(`Удалить участника ${email} из команды?`)) return;
        setBusyMember(membershipId);
        try {
            await axios.delete(`/team/members/${membershipId}`);
            showToast('Участник удалён из команды');
            loadMembers();
        } catch (err: any) {
            const code = err.response?.data?.code;
            showToast(code === 'LAST_OWNER_GUARD' ? 'Нельзя удалить единственного владельца' : 'Не удалось удалить участника');
        } finally {
            setBusyMember(null);
        }
    };

    const handleLeave = async (membershipId: string) => {
        if (!confirm('Вы уверены, что хотите покинуть команду?')) return;
        setBusyMember(membershipId);
        try {
            await axios.post(`/team/members/${membershipId}/leave`);
            window.location.href = '/app';
        } catch (err: any) {
            const code = err.response?.data?.code;
            showToast(code === 'LAST_OWNER_GUARD' ? 'Вы единственный владелец и не можете покинуть команду' : 'Не удалось покинуть команду');
            setBusyMember(null);
        }
    };

    const handleResendInvite = async (id: string) => {
        setBusyInvite(id);
        try {
            await axios.post(`/team/invitations/${id}/resend`);
            showToast('Приглашение переотправлено');
            loadInvitations();
        } catch {
            showToast('Не удалось переотправить приглашение');
        } finally {
            setBusyInvite(null);
        }
    };

    const handleCancelInvite = async (id: string, email: string) => {
        if (!confirm(`Отменить приглашение для ${email}?`)) return;
        setBusyInvite(id);
        try {
            await axios.delete(`/team/invitations/${id}`);
            showToast('Приглашение отменено');
            loadInvitations();
        } catch {
            showToast('Не удалось отменить приглашение');
        } finally {
            setBusyInvite(null);
        }
    };

    const pendingCount = invitations.filter(i => i.status === 'PENDING').length;

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in pb-12">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Команда</h1>

            {isWriteBlocked && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 flex items-start gap-2 text-amber-800 text-sm">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{writeBlockMessage(accessState)}</span>
                </div>
            )}

            {canManageInvites(role) && (
                <div className="flex border-b border-slate-200">
                    <button
                        onClick={() => setTab('members')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'members' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                    >
                        Участники
                        {members.length > 0 && (
                            <span className="ml-1.5 text-xs text-slate-400">{members.length}</span>
                        )}
                    </button>
                    <button
                        onClick={() => setTab('invitations')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'invitations' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
                    >
                        Приглашения
                        {pendingCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] bg-blue-600 text-white rounded-full">
                                {pendingCount}
                            </span>
                        )}
                    </button>
                </div>
            )}

            {tab === 'members' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {loadingMembers ? (
                        <div className="p-8 text-center text-slate-500 text-sm">Загрузка...</div>
                    ) : membersError ? (
                        <div className="p-8 text-center">
                            <p className="text-sm text-red-600 mb-3">{membersError}</p>
                            <button onClick={loadMembers} className="text-xs text-blue-600 hover:underline">Попробовать снова</button>
                        </div>
                    ) : members.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-sm">Участников нет</div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {members.map(member => {
                                const isMe = member.userId === user?.id;
                                const isBusy = busyMember === member.membershipId;
                                // OWNER can change role of non-OWNER non-self members
                                const canChangeThisRole = !isWriteBlocked && role === 'OWNER' && !isMe && member.role !== 'OWNER';
                                const canRemoveThis = !isWriteBlocked && !isMe && canRemoveMember(role, member.role);
                                const canLeave = !isWriteBlocked && isMe;

                                return (
                                    <li key={member.membershipId} className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-slate-900 truncate">{member.email}</span>
                                                {isMe && <span className="text-xs text-slate-400">(вы)</span>}
                                            </div>
                                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                                <RoleBadge role={member.role} />
                                                <span className="text-xs text-slate-400">с {formatDate(member.joinedAt)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {canChangeThisRole && (
                                                <select
                                                    disabled={isBusy}
                                                    value={member.role}
                                                    onChange={e => handleChangeRole(member.membershipId, e.target.value)}
                                                    className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-700 bg-white focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50 cursor-pointer"
                                                >
                                                    <option value="ADMIN">Администратор</option>
                                                    <option value="MANAGER">Менеджер</option>
                                                    <option value="STAFF">Сотрудник</option>
                                                </select>
                                            )}
                                            {canRemoveThis && (
                                                <button
                                                    disabled={isBusy}
                                                    onClick={() => handleRemoveMember(member.membershipId, member.email)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40 rounded hover:bg-red-50"
                                                    title="Удалить участника"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            )}
                                            {canLeave && (
                                                <button
                                                    disabled={isBusy}
                                                    onClick={() => handleLeave(member.membershipId)}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40 rounded hover:bg-red-50"
                                                    title="Покинуть команду"
                                                >
                                                    <LogOut className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {tab === 'invitations' && canManageInvites(role) && (
                <div className="space-y-4">
                    {!isWriteBlocked && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
                            <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                <Mail className="h-4 w-4 text-blue-600" />
                                Пригласить участника
                            </h2>
                            <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row gap-2">
                                <input
                                    type="email"
                                    required
                                    value={inviteEmail}
                                    onChange={e => setInviteEmail(e.target.value)}
                                    placeholder="email@example.com"
                                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                />
                                <select
                                    value={inviteRole}
                                    onChange={e => setInviteRole(e.target.value)}
                                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                >
                                    <option value="ADMIN">Администратор</option>
                                    <option value="MANAGER">Менеджер</option>
                                    <option value="STAFF">Сотрудник</option>
                                </select>
                                <button
                                    type="submit"
                                    disabled={inviting}
                                    className="flex items-center justify-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400 transition-colors whitespace-nowrap"
                                >
                                    <Plus className="h-4 w-4" />
                                    {inviting ? 'Отправка...' : 'Пригласить'}
                                </button>
                            </form>
                            {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
                            {inviteSuccess && <p className="mt-2 text-sm text-green-600">{inviteSuccess}</p>}
                        </div>
                    )}

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-slate-900">История приглашений</h2>
                            <button onClick={loadInvitations} className="text-slate-400 hover:text-slate-600 p-1 rounded" title="Обновить">
                                <RefreshCw className={`h-4 w-4 ${loadingInvitations ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                        {invitations.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">
                                {loadingInvitations ? 'Загрузка...' : 'Приглашений пока нет'}
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {invitations.map(inv => {
                                    const isBusy = busyInvite === inv.id;
                                    const isPending = inv.status === 'PENDING';
                                    return (
                                        <li key={inv.id} className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-medium text-slate-900 truncate">{inv.email}</span>
                                                    <RoleBadge role={inv.role} />
                                                    <InvStatusBadge status={inv.status} />
                                                </div>
                                                <div className="mt-1 text-xs text-slate-400">
                                                    {inv.invitedBy && `Приглашён: ${inv.invitedBy.email} · `}
                                                    {formatDate(inv.createdAt)}
                                                    {isPending && ` · истекает ${formatDate(inv.expiresAt)}`}
                                                </div>
                                            </div>
                                            {isPending && !isWriteBlocked && (
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <button
                                                        disabled={isBusy}
                                                        onClick={() => handleResendInvite(inv.id)}
                                                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40 rounded hover:bg-blue-50"
                                                        title="Переотправить приглашение"
                                                    >
                                                        <RefreshCw className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        disabled={isBusy}
                                                        onClick={() => handleCancelInvite(inv.id, inv.email)}
                                                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40 rounded hover:bg-red-50"
                                                        title="Отменить приглашение"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg bg-slate-900 text-white text-sm font-medium z-50">
                    {toast}
                </div>
            )}
        </div>
    );
}
