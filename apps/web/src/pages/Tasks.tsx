import { useState, useEffect, useRef, useCallback, KeyboardEvent as KBEvent } from 'react';
import axios from 'axios';
import {
    AlertCircle, Archive, Calendar, CheckCircle2, ChevronDown, ChevronRight,
    ClipboardList, Clock, Inbox, Loader2, MessageSquare, PauseCircle, Plus,
    Send, Tag, Trash2, User as UserIcon, X, LayoutDashboard, ExternalLink,
    RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskStatus   = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'ARCHIVED';
type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
type TaskCategory = 'MARKETPLACE_CLIENT_ISSUE' | 'PRODUCTION_INQUIRY' | 'WAREHOUSE' | 'FINANCE' | 'OTHER';
type TaskEventType = 'CREATED' | 'UPDATED' | 'ASSIGNED' | 'STATUS_CHANGED' | 'COMMENTED'
                   | 'DUE_CHANGED' | 'ARCHIVED' | 'DUE_REMINDER_SENT' | 'OVERDUE_NOTIFIED';

interface Task {
    id: string; title: string; description: string | null;
    category: TaskCategory; priority: TaskPriority; status: TaskStatus;
    assigneeUserId: string; createdByUserId: string;
    dueAt: string | null; relatedOrderId: string | null; relatedProductId: string | null;
    tags: string[]; completedAt: string | null; archivedAt: string | null;
    createdAt: string; updatedAt: string;
}

interface TaskComment {
    id: string; authorUserId: string; body: string;
    createdAt: string; editedAt: string | null;
}

interface TaskEvent {
    id: string; actorUserId: string | null;
    eventType: TaskEventType; payload: any; createdAt: string;
}

interface TaskDetail extends Task {
    comments: TaskComment[];
    events: TaskEvent[];
}

export interface Member {
    membershipId: string; userId: string; email: string; role: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, { label: string; tone: string }> = {
    OPEN:        { label: 'Открыта',    tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
    IN_PROGRESS: { label: 'В работе',   tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
    WAITING:     { label: 'Ожидает',    tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
    DONE:        { label: 'Выполнена',  tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    ARCHIVED:    { label: 'Архив',      tone: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

const PRIORITY_LABEL: Record<TaskPriority, { label: string; dot: string }> = {
    LOW:    { label: 'Низкий',   dot: 'bg-slate-400' },
    NORMAL: { label: 'Обычный',  dot: 'bg-blue-500' },
    HIGH:   { label: 'Высокий',  dot: 'bg-amber-500' },
    URGENT: { label: 'Срочный',  dot: 'bg-rose-500' },
};

const CATEGORY_LABEL: Record<TaskCategory, string> = {
    MARKETPLACE_CLIENT_ISSUE: 'Клиент маркетплейс',
    PRODUCTION_INQUIRY:       'Запрос производства',
    WAREHOUSE:                'Склад',
    FINANCE:                  'Финансы',
    OTHER:                    'Другое',
};

const EVENT_TYPE_LABEL: Record<TaskEventType, string> = {
    CREATED:            'Задача создана',
    UPDATED:            'Задача обновлена',
    ASSIGNED:           'Назначен исполнитель',
    STATUS_CHANGED:     'Изменён статус',
    COMMENTED:          'Добавлен комментарий',
    DUE_CHANGED:        'Изменён дедлайн',
    ARCHIVED:           'Задача архивирована',
    DUE_REMINDER_SENT:  'Напоминание о дедлайне',
    OVERDUE_NOTIFIED:   'Уведомление о просрочке',
};

const PAUSED_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

type InboxTab = 'MY_OPEN' | 'ASSIGNED_TODAY' | 'CREATED_BY_ME' | 'OVERDUE' | 'ALL_OPEN';

const INBOX_TABS: Array<{ id: InboxTab; label: string }> = [
    { id: 'MY_OPEN',        label: 'Мои открытые' },
    { id: 'ASSIGNED_TODAY', label: 'Назначено сегодня' },
    { id: 'CREATED_BY_ME',  label: 'Я создал' },
    { id: 'OVERDUE',        label: 'Просрочено' },
    { id: 'ALL_OPEN',       label: 'Все открытые' },
];

const KANBAN_COLS: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
const KANBAN_COL_LABEL: Record<string, string> = {
    OPEN: 'Открытые', IN_PROGRESS: 'В работе', WAITING: 'Ожидают',
    DONE: 'Выполнено', ARCHIVED: 'Архив',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Tasks() {
    const { user, activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;

    const [view, setView] = useState<'inbox' | 'kanban'>('inbox');
    const [members, setMembers] = useState<Member[]>([]);

    // Inbox state
    const [activeTab, setActiveTab] = useState<InboxTab>('MY_OPEN');
    const [tasks, setTasks]         = useState<Task[]>([]);
    const [tabCounts, setTabCounts] = useState<Record<InboxTab, number>>({
        MY_OPEN: 0, ASSIGNED_TODAY: 0, CREATED_BY_ME: 0, OVERDUE: 0, ALL_OPEN: 0,
    });
    const [page, setPage]   = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [inboxLoading, setInboxLoading] = useState(false);
    const [inboxError, setInboxError]     = useState<string | null>(null);

    // Kanban state
    const [kanbanCols, setKanbanCols] = useState<Record<TaskStatus, Task[]>>({
        OPEN: [], IN_PROGRESS: [], WAITING: [], DONE: [], ARCHIVED: [],
    });
    const [kanbanLoading, setKanbanLoading] = useState(false);
    const [kanbanError, setKanbanError]     = useState<string | null>(null);
    const [doneExpanded, setDoneExpanded]   = useState(false);
    const [archExpanded, setArchExpanded]   = useState(false);

    // Modal / Drawer
    const [quickCreateOpen, setQuickCreateOpen] = useState(false);
    const [quickCreatePrefill, setQuickCreatePrefill] = useState<{ title?: string; relatedOrderId?: string }>({});
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    // Toast
    const [toast, setToast] = useState<{ msg: string; taskId?: string } | null>(null);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const memberEmail = useCallback((userId: string) =>
        members.find(m => m.userId === userId)?.email ?? userId.slice(0, 8) + '…',
    [members]);

    const showToast = useCallback((msg: string, taskId?: string) => {
        setToast({ msg, taskId });
        setTimeout(() => setToast(null), 4000);
    }, []);

    // ── Data fetching ─────────────────────────────────────────────────────────

    const fetchMembers = useCallback(async () => {
        try {
            const res = await axios.get('/team/members');
            setMembers(res.data ?? []);
        } catch { /* non-critical */ }
    }, []);

    const tabParams = useCallback((tab: InboxTab): Record<string, string> => {
        const base: Record<string, string> = { view: 'inbox' };
        switch (tab) {
            case 'MY_OPEN':        return { ...base, assignee: 'me', status: 'OPEN,IN_PROGRESS,WAITING' };
            case 'ASSIGNED_TODAY': return { ...base, assignee: 'me', status: 'OPEN,IN_PROGRESS,WAITING' };
            case 'CREATED_BY_ME':  return { ...base, createdBy: 'me', status: 'OPEN,IN_PROGRESS,WAITING' };
            case 'OVERDUE':        return { ...base, overdue: 'true', assignee: 'me' };
            case 'ALL_OPEN':       return { ...base, status: 'OPEN,IN_PROGRESS,WAITING' };
        }
    }, []);

    const fetchInbox = useCallback(async (tab: InboxTab, pg: number) => {
        setInboxLoading(true);
        setInboxError(null);
        try {
            const res = await axios.get('/tasks', { params: { ...tabParams(tab), page: pg, limit: 20 } });
            let items: Task[] = res.data.items ?? [];

            if (tab === 'ASSIGNED_TODAY') {
                const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                items = items.filter(t => new Date(t.createdAt) >= todayStart);
            }

            setTasks(items);
            setPages(res.data.meta?.pages ?? 1);
            setTotal(tab === 'ASSIGNED_TODAY' ? items.length : (res.data.meta?.total ?? 0));
        } catch (e: any) {
            setInboxError(e?.response?.data?.message ?? 'Не удалось загрузить задачи');
        } finally {
            setInboxLoading(false);
        }
    }, [tabParams]);

    const fetchTabCounts = useCallback(async () => {
        try {
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const [myOpen, assignedToday, createdByMe, overdue, allOpen] = await Promise.all([
                axios.get('/tasks', { params: { assignee: 'me', status: 'OPEN,IN_PROGRESS,WAITING', limit: 1 } }),
                axios.get('/tasks', { params: { assignee: 'me', status: 'OPEN,IN_PROGRESS,WAITING', limit: 100 } }),
                axios.get('/tasks', { params: { createdBy: 'me', status: 'OPEN,IN_PROGRESS,WAITING', limit: 1 } }),
                axios.get('/tasks', { params: { overdue: 'true', assignee: 'me', limit: 1 } }),
                axios.get('/tasks', { params: { status: 'OPEN,IN_PROGRESS,WAITING', limit: 1 } }),
            ]);
            const todayCount = (assignedToday.data.items ?? [])
                .filter((t: Task) => new Date(t.createdAt) >= todayStart).length;
            setTabCounts({
                MY_OPEN:        myOpen.data.meta?.total ?? 0,
                ASSIGNED_TODAY: todayCount,
                CREATED_BY_ME:  createdByMe.data.meta?.total ?? 0,
                OVERDUE:        overdue.data.meta?.total ?? 0,
                ALL_OPEN:       allOpen.data.meta?.total ?? 0,
            });
        } catch { /* non-critical */ }
    }, []);

    const fetchKanban = useCallback(async () => {
        setKanbanLoading(true);
        setKanbanError(null);
        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
            const [open, inProg, waiting, done] = await Promise.all([
                axios.get('/tasks', { params: { status: 'OPEN',        view: 'kanban', limit: 50 } }),
                axios.get('/tasks', { params: { status: 'IN_PROGRESS', view: 'kanban', limit: 50 } }),
                axios.get('/tasks', { params: { status: 'WAITING',     view: 'kanban', limit: 50 } }),
                axios.get('/tasks', { params: { status: 'DONE',        view: 'kanban', limit: 20 } }),
            ]);
            const doneFiltered = (done.data.items ?? []).filter(
                (t: Task) => t.completedAt && new Date(t.completedAt) >= new Date(sevenDaysAgo)
            );
            setKanbanCols({
                OPEN:        open.data.items ?? [],
                IN_PROGRESS: inProg.data.items ?? [],
                WAITING:     waiting.data.items ?? [],
                DONE:        doneFiltered,
                ARCHIVED:    [],
            });
        } catch (e: any) {
            setKanbanError(e?.response?.data?.message ?? 'Не удалось загрузить доску');
        } finally {
            setKanbanLoading(false);
        }
    }, []);

    // ── Effects ───────────────────────────────────────────────────────────────

    useEffect(() => {
        fetchMembers();
        fetchTabCounts();
    }, [fetchMembers, fetchTabCounts]);

    useEffect(() => {
        if (view === 'inbox') fetchInbox(activeTab, page);
    }, [view, activeTab, page, fetchInbox]);

    useEffect(() => {
        if (view === 'kanban') fetchKanban();
    }, [view, fetchKanban]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                setQuickCreatePrefill({});
                setQuickCreateOpen(true);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleTabChange = (tab: InboxTab) => {
        setActiveTab(tab); setPage(1);
    };

    const handleCreated = (task: Task) => {
        setQuickCreateOpen(false);
        fetchTabCounts();
        if (view === 'inbox') fetchInbox(activeTab, page);
        else fetchKanban();
        showToast('Задача создана', task.id);
    };

    const handleTaskUpdated = () => {
        if (view === 'inbox') fetchInbox(activeTab, page);
        else fetchKanban();
        fetchTabCounts();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Задачи</h1>
                    <p className="text-slate-500 mt-1 text-xs sm:text-sm">
                        Внутренние поручения, обращения клиентов и контроль дедлайнов
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                        <button
                            onClick={() => setView('inbox')}
                            className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 transition-colors ${
                                view === 'inbox' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <Inbox className="h-4 w-4" /> Inbox
                        </button>
                        <button
                            onClick={() => setView('kanban')}
                            className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 border-l border-slate-200 transition-colors ${
                                view === 'kanban' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            <LayoutDashboard className="h-4 w-4" /> Kanban
                        </button>
                    </div>
                    {/* Quick create */}
                    <button
                        onClick={() => { setQuickCreatePrefill({}); setQuickCreateOpen(true); }}
                        disabled={isPaused}
                        title={isPaused ? 'Создание недоступно при паузе интеграций' : 'Создать задачу (Ctrl+I)'}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        <Plus className="h-4 w-4" />
                        Новая задача
                    </button>
                </div>
            </header>

            {/* Paused banner */}
            {isPaused && (
                <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 flex items-start gap-3">
                    <PauseCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                        <div className="font-semibold">Создание/редактирование задач недоступно при паузе интеграций</div>
                        <div className="mt-0.5">
                            История задач доступна для просмотра ({activeTenant?.accessState}).
                        </div>
                    </div>
                </div>
            )}

            {/* Views */}
            {view === 'inbox' ? (
                <InboxView
                    tabs={INBOX_TABS}
                    activeTab={activeTab}
                    tabCounts={tabCounts}
                    tasks={tasks}
                    loading={inboxLoading}
                    error={inboxError}
                    page={page}
                    pages={pages}
                    total={total}
                    members={members}
                    onTabChange={handleTabChange}
                    onPageChange={setPage}
                    onSelectTask={setSelectedTaskId}
                    memberEmail={memberEmail}
                />
            ) : (
                <KanbanView
                    cols={kanbanCols}
                    loading={kanbanLoading}
                    error={kanbanError}
                    members={members}
                    doneExpanded={doneExpanded}
                    archExpanded={archExpanded}
                    isPaused={isPaused}
                    onDoneToggle={() => setDoneExpanded(v => !v)}
                    onArchToggle={() => setArchExpanded(v => !v)}
                    onSelectTask={setSelectedTaskId}
                    onStatusChanged={handleTaskUpdated}
                    memberEmail={memberEmail}
                />
            )}

            {/* Quick-create modal */}
            {quickCreateOpen && (
                <QuickCreateModal
                    members={members}
                    isPaused={isPaused}
                    prefill={quickCreatePrefill}
                    currentUserId={user?.id ?? ''}
                    onCreated={handleCreated}
                    onClose={() => setQuickCreateOpen(false)}
                />
            )}

            {/* Task detail drawer */}
            {selectedTaskId && (
                <TaskDetailDrawer
                    taskId={selectedTaskId}
                    members={members}
                    isPaused={isPaused}
                    currentUserId={user?.id ?? ''}
                    onClose={() => setSelectedTaskId(null)}
                    onTaskUpdated={handleTaskUpdated}
                    memberEmail={memberEmail}
                />
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>{toast.msg}</span>
                    {toast.taskId && (
                        <button
                            onClick={() => { setSelectedTaskId(toast.taskId!); setToast(null); }}
                            className="text-blue-400 hover:text-blue-300 font-semibold"
                        >
                            Открыть
                        </button>
                    )}
                    <button onClick={() => setToast(null)} className="ml-1 text-slate-400 hover:text-white">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── InboxView ────────────────────────────────────────────────────────────────

function InboxView({
    tabs, activeTab, tabCounts, tasks, loading, error,
    page, pages, total, members, onTabChange, onPageChange, onSelectTask, memberEmail,
}: {
    tabs: typeof INBOX_TABS;
    activeTab: InboxTab;
    tabCounts: Record<InboxTab, number>;
    tasks: Task[];
    loading: boolean;
    error: string | null;
    page: number; pages: number; total: number;
    members: Member[];
    onTabChange: (t: InboxTab) => void;
    onPageChange: (p: number) => void;
    onSelectTask: (id: string) => void;
    memberEmail: (id: string) => string;
}) {
    return (
        <div className="space-y-4">
            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => onTabChange(t.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                            activeTab === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        {t.label}
                        {tabCounts[t.id] > 0 && (
                            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                                activeTab === t.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                            }`}>
                                {tabCounts[t.id] > 99 ? '99+' : tabCounts[t.id]}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {error && (
                <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
                    <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/60 border-b border-slate-100">
                            <tr>
                                <Th>Приоритет</Th>
                                <Th>Название</Th>
                                <Th>Статус</Th>
                                <Th>Исполнитель</Th>
                                <Th>Дедлайн</Th>
                                <Th>Создана</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && tasks.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-16 text-center text-slate-400">
                                        <Loader2 className="h-6 w-6 animate-spin inline-block" />
                                    </td>
                                </tr>
                            ) : tasks.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-16 text-center text-slate-400 italic">
                                        Задач по выбранным фильтрам нет
                                    </td>
                                </tr>
                            ) : tasks.map(task => {
                                const p = PRIORITY_LABEL[task.priority];
                                const s = STATUS_LABEL[task.status];
                                const isOverdue = task.dueAt && new Date(task.dueAt) < new Date()
                                    && task.status !== 'DONE' && task.status !== 'ARCHIVED';
                                return (
                                    <tr
                                        key={task.id}
                                        onClick={() => onSelectTask(task.id)}
                                        className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`w-2 h-2 rounded-full ${p.dot}`} />
                                                <span className="text-xs text-slate-600">{p.label}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 max-w-xs">
                                            <div className="text-sm font-medium text-slate-900 truncate">{task.title}</div>
                                            {task.tags.length > 0 && (
                                                <div className="flex gap-1 mt-0.5">
                                                    {task.tags.slice(0, 3).map(tag => (
                                                        <span key={tag} className="text-[10px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ring-1 ring-inset ${s.tone}`}>
                                                {s.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-600">
                                            {memberEmail(task.assigneeUserId)}
                                        </td>
                                        <td className={`px-4 py-3 text-xs ${isOverdue ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                                            {task.dueAt ? (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {formatDate(task.dueAt)}
                                                </span>
                                            ) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-400">
                                            {timeAgo(task.createdAt)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                className="text-blue-600 hover:text-blue-700 text-xs font-semibold"
                                            >
                                                Открыть →
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                    <button disabled={page === 1} onClick={() => onPageChange(page - 1)}
                        className="px-3 py-1.5 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50">
                        Назад
                    </button>
                    <span className="text-xs text-slate-600">
                        Страница <span className="font-semibold">{page}</span> из <span className="font-semibold">{pages}</span>
                        {' · '}Всего: <span className="font-semibold">{total}</span>
                    </span>
                    <button disabled={page >= pages} onClick={() => onPageChange(page + 1)}
                        className="px-3 py-1.5 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50">
                        Вперёд
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── KanbanView ───────────────────────────────────────────────────────────────

function KanbanView({
    cols, loading, error, members, doneExpanded, archExpanded, isPaused,
    onDoneToggle, onArchToggle, onSelectTask, onStatusChanged, memberEmail,
}: {
    cols: Record<TaskStatus, Task[]>;
    loading: boolean; error: string | null;
    members: Member[]; doneExpanded: boolean; archExpanded: boolean; isPaused: boolean;
    onDoneToggle: () => void; onArchToggle: () => void;
    onSelectTask: (id: string) => void;
    onStatusChanged: () => void;
    memberEmail: (id: string) => string;
}) {
    const [draggedTask, setDraggedTask] = useState<Task | null>(null);
    const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

    const handleDrop = async (targetStatus: TaskStatus) => {
        if (!draggedTask || draggedTask.status === targetStatus || isPaused) return;
        try {
            await axios.post(`/tasks/${draggedTask.id}/status`, { status: targetStatus });
            onStatusChanged();
        } catch { /* silently fail — board will stay as-is */ }
        setDraggedTask(null);
        setDragOverCol(null);
    };

    if (error) {
        return (
            <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
                <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto pb-4">
            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка доски…
                </div>
            ) : (
                <div className="flex gap-4 min-w-max">
                    {/* Main columns */}
                    {KANBAN_COLS.map(status => (
                        <KanbanColumn
                            key={status}
                            status={status}
                            tasks={cols[status]}
                            dragOver={dragOverCol === status}
                            isPaused={isPaused}
                            memberEmail={memberEmail}
                            onDragStart={setDraggedTask}
                            onDragOver={setDragOverCol}
                            onDrop={handleDrop}
                            onSelect={onSelectTask}
                        />
                    ))}

                    {/* Done column (last 7 days, narrow) */}
                    <div
                        className={`flex flex-col w-64 min-h-[200px] rounded-xl border-2 transition-colors ${
                            dragOverCol === 'DONE' ? 'border-emerald-400 bg-emerald-50/30' : 'border-dashed border-slate-200 bg-slate-50/50'
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOverCol('DONE'); }}
                        onDragLeave={() => setDragOverCol(null)}
                        onDrop={() => handleDrop('DONE')}
                    >
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                                    Выполнено
                                </span>
                                <span className="text-[10px] text-slate-400">7 дней</span>
                            </div>
                            <button onClick={onDoneToggle} className="text-slate-400 hover:text-slate-600">
                                {doneExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                        {doneExpanded && (
                            <div className="flex flex-col gap-2 p-2">
                                {cols.DONE.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic text-center py-4">Нет задач</p>
                                ) : cols.DONE.map(task => (
                                    <KanbanCard
                                        key={task.id} task={task} isPaused={isPaused}
                                        memberEmail={memberEmail}
                                        onDragStart={setDraggedTask}
                                        onSelect={onSelectTask}
                                    />
                                ))}
                            </div>
                        )}
                        {!doneExpanded && cols.DONE.length > 0 && (
                            <button onClick={onDoneToggle} className="m-2 text-xs text-slate-500 hover:text-slate-700 text-center py-2">
                                {cols.DONE.length} задач — развернуть
                            </button>
                        )}
                    </div>

                    {/* Archived column (collapsed by default) */}
                    <div className="flex flex-col w-12 rounded-xl border border-dashed border-slate-200 bg-slate-50/30">
                        <button
                            onClick={onArchToggle}
                            className="flex flex-col items-center justify-center flex-1 py-4 text-slate-400 hover:text-slate-600 gap-2"
                        >
                            <Archive className="h-4 w-4" />
                            <span className="text-[10px] font-semibold uppercase tracking-widest writing-vertical-lr">
                                Архив
                            </span>
                            {cols.ARCHIVED.length > 0 && (
                                <span className="text-[10px] bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5">
                                    {cols.ARCHIVED.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function KanbanColumn({
    status, tasks, dragOver, isPaused, memberEmail,
    onDragStart, onDragOver, onDrop, onSelect,
}: {
    status: TaskStatus; tasks: Task[]; dragOver: boolean; isPaused: boolean;
    memberEmail: (id: string) => string;
    onDragStart: (t: Task) => void;
    onDragOver: (s: TaskStatus) => void;
    onDrop: (s: TaskStatus) => void;
    onSelect: (id: string) => void;
}) {
    const s = STATUS_LABEL[status];
    const dotColor = status === 'OPEN' ? 'bg-slate-500' : status === 'IN_PROGRESS' ? 'bg-blue-500' : 'bg-amber-500';

    return (
        <div
            className={`flex flex-col w-72 min-h-[400px] rounded-xl border-2 transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50/30' : 'border-transparent bg-slate-100/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); onDragOver(status); }}
            onDragLeave={() => onDragOver(null as any)}
            onDrop={() => onDrop(status)}
        >
            <div className="flex items-center justify-between px-3 py-2.5 rounded-t-xl bg-white border border-slate-200 border-b-0">
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        {KANBAN_COL_LABEL[status]}
                    </span>
                </div>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                    {tasks.length}
                </span>
            </div>
            <div className="flex flex-col gap-2 p-2 flex-1 bg-white rounded-b-xl border border-t-0 border-slate-200">
                {tasks.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-8">Нет задач</p>
                ) : tasks.map(task => (
                    <KanbanCard
                        key={task.id} task={task} isPaused={isPaused}
                        memberEmail={memberEmail}
                        onDragStart={onDragStart}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </div>
    );
}

function KanbanCard({
    task, isPaused, memberEmail, onDragStart, onSelect,
}: {
    task: Task; isPaused: boolean; memberEmail: (id: string) => string;
    onDragStart: (t: Task) => void;
    onSelect: (id: string) => void;
}) {
    const p = PRIORITY_LABEL[task.priority];
    const isOverdue = task.dueAt && new Date(task.dueAt) < new Date()
        && task.status !== 'DONE' && task.status !== 'ARCHIVED';

    return (
        <div
            draggable={!isPaused}
            onDragStart={() => onDragStart(task)}
            onClick={() => onSelect(task.id)}
            className={`bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:shadow-sm hover:border-blue-300 transition-all ${
                isPaused ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
            }`}
        >
            <div className="flex items-start gap-2">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${p.dot}`} />
                <span className="text-sm font-medium text-slate-900 leading-tight">{task.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-2 ml-4">
                <span className="text-[10px] text-slate-500">{memberEmail(task.assigneeUserId)}</span>
                {task.dueAt && (
                    <span className={`flex items-center gap-0.5 text-[10px] ${isOverdue ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>
                        <Clock className="h-3 w-3" />
                        {formatDate(task.dueAt)}
                    </span>
                )}
            </div>
            {task.tags.length > 0 && (
                <div className="flex gap-1 mt-1.5 ml-4 flex-wrap">
                    {task.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded">{tag}</span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── QuickCreateModal ─────────────────────────────────────────────────────────

export function QuickCreateModal({
    members, isPaused, prefill = {}, currentUserId, onCreated, onClose,
}: {
    members: Member[];
    isPaused: boolean;
    prefill?: { title?: string; relatedOrderId?: string };
    currentUserId: string;
    onCreated: (task: Task) => void;
    onClose: () => void;
}) {
    const [title, setTitle]           = useState(prefill.title ?? '');
    const [expanded, setExpanded]     = useState(!!prefill.relatedOrderId);
    const [assignee, setAssignee]     = useState(currentUserId);
    const [dueAt, setDueAt]           = useState('');
    const [category, setCategory]     = useState<TaskCategory>('OTHER');
    const [priority, setPriority]     = useState<TaskPriority>('NORMAL');
    const [tags, setTags]             = useState('');
    const [relatedOrderId, setRelatedOrderId] = useState(prefill.relatedOrderId ?? '');
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState<string | null>(null);
    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => { titleRef.current?.focus(); }, []);

    const handleSubmit = async () => {
        if (!title.trim() || isPaused) return;
        setSaving(true);
        setError(null);
        try {
            const body: any = {
                title: title.trim(),
                assigneeUserId: assignee || currentUserId,
            };
            if (expanded) {
                if (dueAt) body.dueAt = new Date(dueAt).toISOString();
                body.category = category;
                body.priority  = priority;
                if (tags.trim()) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
                if (relatedOrderId.trim()) body.relatedOrderId = relatedOrderId.trim();
            }
            const res = await axios.post('/tasks', body);
            onCreated(res.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Не удалось создать задачу');
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: KBEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !expanded) { e.preventDefault(); handleSubmit(); }
        if (e.key === 'Escape') onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">Новая задача</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Title */}
                <input
                    ref={titleRef}
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Название задачи — Enter для быстрого создания"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                    disabled={isPaused}
                />

                {/* Expanded fields */}
                {expanded && (
                    <div className="space-y-3">
                        {/* Assignee */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Исполнитель
                            </label>
                            <select
                                value={assignee}
                                onChange={e => setAssignee(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                disabled={isPaused}
                            >
                                {members.map(m => (
                                    <option key={m.userId} value={m.userId}>
                                        {m.email} ({m.role})
                                    </option>
                                ))}
                            </select>
                        </div>
                        {/* Due + Priority row */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Дедлайн</label>
                                <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" disabled={isPaused} />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Приоритет</label>
                                <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" disabled={isPaused}>
                                    {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map(p => (
                                        <option key={p} value={p}>{PRIORITY_LABEL[p].label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* Category */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Категория</label>
                            <select value={category} onChange={e => setCategory(e.target.value as TaskCategory)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" disabled={isPaused}>
                                {(Object.keys(CATEGORY_LABEL) as TaskCategory[]).map(c => (
                                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                                ))}
                            </select>
                        </div>
                        {/* Tags */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Теги (через запятую)
                            </label>
                            <input type="text" value={tags} onChange={e => setTags(e.target.value)}
                                placeholder="клиент, возврат, склад"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" disabled={isPaused} />
                        </div>
                        {/* Related order */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                ID связанного заказа
                            </label>
                            <input type="text" value={relatedOrderId} onChange={e => setRelatedOrderId(e.target.value)}
                                placeholder="UUID заказа"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" disabled={isPaused} />
                        </div>
                    </div>
                )}

                {error && (
                    <p className="text-sm text-rose-600 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" /> {error}
                    </p>
                )}

                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setExpanded(v => !v)}
                        className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {expanded ? 'Свернуть' : 'Расширенная форма'}
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
                            Отмена
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!title.trim() || saving || isPaused}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Создать
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── TaskDetailDrawer ─────────────────────────────────────────────────────────

function TaskDetailDrawer({
    taskId, members, isPaused, currentUserId, onClose, onTaskUpdated, memberEmail,
}: {
    taskId: string; members: Member[]; isPaused: boolean; currentUserId: string;
    onClose: () => void; onTaskUpdated: () => void;
    memberEmail: (id: string) => string;
}) {
    const [detail, setDetail]           = useState<TaskDetail | null>(null);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);
    const [saving, setSaving]           = useState(false);
    const [showTimeline, setShowTimeline] = useState(false);

    // Inline title editing
    const [editingTitle, setEditingTitle] = useState(false);
    const [editTitle, setEditTitle]       = useState('');
    const titleRef = useRef<HTMLInputElement>(null);

    // Comment
    const [commentBody, setCommentBody]           = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`/tasks/${taskId}`);
            setDetail(res.data);
            setEditTitle(res.data.title);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Не удалось загрузить задачу');
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (editingTitle) titleRef.current?.focus(); }, [editingTitle]);

    // ── Patch helper ────────────────────────────────────────────────────────

    const patch = async (data: Record<string, any>) => {
        if (isPaused || !detail) return;
        setSaving(true);
        try {
            await axios.patch(`/tasks/${taskId}`, data);
            await load();
            onTaskUpdated();
        } catch { /* ignore — drawer stays open */ }
        finally { setSaving(false); }
    };

    const changeStatus = async (status: TaskStatus) => {
        if (isPaused || !detail) return;
        setSaving(true);
        try {
            await axios.post(`/tasks/${taskId}/status`, { status });
            await load(); onTaskUpdated();
        } catch { } finally { setSaving(false); }
    };

    const changeAssignee = async (userId: string) => {
        if (isPaused || !detail) return;
        setSaving(true);
        try {
            await axios.post(`/tasks/${taskId}/assign`, { assigneeUserId: userId });
            await load(); onTaskUpdated();
        } catch { } finally { setSaving(false); }
    };

    const submitComment = async () => {
        if (!commentBody.trim() || submittingComment || isPaused) return;
        setSubmittingComment(true);
        try {
            await axios.post(`/tasks/${taskId}/comments`, { body: commentBody.trim() });
            setCommentBody('');
            await load();
        } catch { } finally { setSubmittingComment(false); }
    };

    const deleteComment = async (commentId: string) => {
        try {
            await axios.delete(`/tasks/${taskId}/comments/${commentId}`);
            await load();
        } catch { }
    };

    const saveTitle = async () => {
        setEditingTitle(false);
        if (!editTitle.trim() || editTitle === detail?.title) return;
        await patch({ title: editTitle.trim() });
    };

    const handleCommentKeyDown = (e: KBEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submitComment();
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-slate-900/40" onClick={onClose} />
            <aside className="w-full max-w-xl bg-white shadow-2xl flex flex-col">
                {/* Header */}
                <header className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        {editingTitle ? (
                            <input
                                ref={titleRef}
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                onBlur={saveTitle}
                                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditingTitle(false); setEditTitle(detail?.title ?? ''); } }}
                                className="w-full text-base font-semibold text-slate-900 border-b-2 border-blue-500 focus:outline-none bg-transparent pb-0.5"
                            />
                        ) : (
                            <h2
                                className={`text-base font-semibold text-slate-900 leading-snug ${!isPaused ? 'cursor-text hover:text-blue-700' : ''}`}
                                onClick={() => { if (!isPaused) { setEditTitle(detail?.title ?? ''); setEditingTitle(true); } }}
                                title={isPaused ? undefined : 'Нажмите для редактирования'}
                            >
                                {loading ? '…' : (detail?.title ?? '—')}
                            </h2>
                        )}
                        {detail && (
                            <div className="text-xs text-slate-400 mt-0.5">
                                {CATEGORY_LABEL[detail.category]} · создана {timeAgo(detail.createdAt)}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {saving && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">
                            ×
                        </button>
                    </div>
                </header>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {loading ? (
                        <div className="flex items-center text-slate-500 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка…
                        </div>
                    ) : error ? (
                        <div className="text-rose-600 text-sm">{error}</div>
                    ) : detail ? (
                        <>
                            {/* Status row */}
                            <section>
                                <FieldLabel>Статус</FieldLabel>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE'] as TaskStatus[]).map(st => (
                                        <button
                                            key={st}
                                            disabled={isPaused || detail.status === st}
                                            onClick={() => changeStatus(st)}
                                            className={`px-2.5 py-1 rounded text-[11px] font-semibold ring-1 ring-inset transition-opacity ${
                                                STATUS_LABEL[st].tone
                                            } ${detail.status === st ? 'opacity-100 ring-2' : 'opacity-60 hover:opacity-100 disabled:opacity-60'}`}
                                        >
                                            {STATUS_LABEL[st].label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Priority + Assignee */}
                            <section className="grid grid-cols-2 gap-4">
                                <div>
                                    <FieldLabel>Приоритет</FieldLabel>
                                    <select
                                        value={detail.priority}
                                        onChange={e => patch({ priority: e.target.value })}
                                        disabled={isPaused}
                                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                                    >
                                        {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map(p => (
                                            <option key={p} value={p}>{PRIORITY_LABEL[p].label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <FieldLabel>Исполнитель</FieldLabel>
                                    <select
                                        value={detail.assigneeUserId}
                                        onChange={e => changeAssignee(e.target.value)}
                                        disabled={isPaused}
                                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                                    >
                                        {members.map(m => (
                                            <option key={m.userId} value={m.userId}>{m.email}</option>
                                        ))}
                                    </select>
                                </div>
                            </section>

                            {/* Due + Category */}
                            <section className="grid grid-cols-2 gap-4">
                                <div>
                                    <FieldLabel>Дедлайн</FieldLabel>
                                    <input
                                        type="datetime-local"
                                        defaultValue={detail.dueAt ? detail.dueAt.slice(0, 16) : ''}
                                        onBlur={e => patch({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                                        disabled={isPaused}
                                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm"
                                    />
                                </div>
                                <div>
                                    <FieldLabel>Категория</FieldLabel>
                                    <select
                                        value={detail.category}
                                        onChange={e => patch({ category: e.target.value })}
                                        disabled={isPaused}
                                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                                    >
                                        {(Object.keys(CATEGORY_LABEL) as TaskCategory[]).map(c => (
                                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                                        ))}
                                    </select>
                                </div>
                            </section>

                            {/* Tags */}
                            <section>
                                <FieldLabel>Теги</FieldLabel>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {detail.tags.map(tag => (
                                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                                            <Tag className="h-3 w-3" />{tag}
                                        </span>
                                    ))}
                                    {detail.tags.length === 0 && <span className="text-xs text-slate-400 italic">нет тегов</span>}
                                </div>
                            </section>

                            {/* Related order */}
                            {detail.relatedOrderId && (
                                <section>
                                    <FieldLabel>Связанный заказ</FieldLabel>
                                    <div className="mt-1 flex items-center gap-1.5 text-sm text-blue-600">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        <span className="font-mono text-xs">{detail.relatedOrderId}</span>
                                    </div>
                                </section>
                            )}

                            {/* Description */}
                            {detail.description && (
                                <section>
                                    <FieldLabel>Описание</FieldLabel>
                                    <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border border-slate-200">
                                        {detail.description}
                                    </div>
                                </section>
                            )}

                            {/* Comments */}
                            <section>
                                <FieldLabel>
                                    <MessageSquare className="inline h-3.5 w-3.5 mr-1" />
                                    Комментарии ({detail.comments.length})
                                </FieldLabel>
                                <div className="mt-2 space-y-3">
                                    {detail.comments.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Комментариев пока нет</p>
                                    ) : (
                                        detail.comments.map(c => (
                                            <div key={c.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs font-semibold text-slate-700">
                                                        {memberEmail(c.authorUserId)}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-400">{timeAgo(c.createdAt)}</span>
                                                        {c.authorUserId === currentUserId && !isPaused && (
                                                            <button onClick={() => deleteComment(c.id)}
                                                                className="text-slate-300 hover:text-rose-500 transition-colors"
                                                                title="Удалить комментарий">
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
                                                {c.editedAt && (
                                                    <p className="text-[10px] text-slate-400 mt-1">редактировано</p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                                {/* Comment input */}
                                {!isPaused && (
                                    <div className="mt-3 flex gap-2">
                                        <textarea
                                            value={commentBody}
                                            onChange={e => setCommentBody(e.target.value)}
                                            onKeyDown={handleCommentKeyDown}
                                            placeholder="Комментарий… (Ctrl+Enter для отправки)"
                                            rows={2}
                                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:ring-blue-500 focus:border-blue-500"
                                        />
                                        <button
                                            onClick={submitComment}
                                            disabled={!commentBody.trim() || submittingComment}
                                            className="self-end px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                        >
                                            {submittingComment
                                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                                : <Send className="h-4 w-4" />
                                            }
                                        </button>
                                    </div>
                                )}
                                {isPaused && (
                                    <p className="text-xs text-amber-700 mt-2 italic">
                                        Комментирование недоступно при паузе интеграций.
                                    </p>
                                )}
                            </section>

                            {/* Timeline */}
                            <section>
                                <button
                                    onClick={() => setShowTimeline(v => !v)}
                                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 uppercase tracking-wider"
                                >
                                    {showTimeline
                                        ? <ChevronDown className="h-3.5 w-3.5" />
                                        : <ChevronRight className="h-3.5 w-3.5" />
                                    }
                                    История изменений ({detail.events.length})
                                </button>
                                {showTimeline && (
                                    <ol className="relative border-l border-slate-200 ml-2 mt-3">
                                        {detail.events.map(e => (
                                            <li key={e.id} className="ml-4 mb-4">
                                                <span className="absolute -left-[7px] flex items-center justify-center w-3.5 h-3.5 bg-white border border-slate-300 rounded-full" />
                                                <div className="text-sm font-semibold text-slate-700">
                                                    {EVENT_TYPE_LABEL[e.eventType] ?? e.eventType}
                                                </div>
                                                <time className="block text-[11px] text-slate-400 mt-0.5">
                                                    {formatDate(e.createdAt)}
                                                    {e.actorUserId && ` · ${memberEmail(e.actorUserId)}`}
                                                </time>
                                                {e.payload && Object.keys(e.payload).length > 0 && (
                                                    <pre className="mt-1 bg-slate-50 border border-slate-100 rounded p-2 text-[10px] text-slate-500 overflow-x-auto">
{JSON.stringify(e.payload, null, 2)}
                                                    </pre>
                                                )}
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                        </>
                    ) : null}
                </div>
            </aside>
        </div>
    );
}

// ─── Shared subcomponents ─────────────────────────────────────────────────────

function Th({ children }: { children?: React.ReactNode }) {
    return (
        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {children}
        </th>
    );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center">
            {children}
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function timeAgo(iso?: string | null) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 24) return `${Math.floor(h / 24)} д назад`;
    if (h > 0) return `${h} ч назад`;
    return `${m} мин назад`;
}
