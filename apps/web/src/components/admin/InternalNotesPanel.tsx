import { useEffect, useState } from 'react';
import { StickyNote, Send, Loader2, Lock, ShieldAlert } from 'lucide-react';
import {
    adminNotesApi,
    extractApiError,
    type SupportNote,
} from '../../api/admin';
import { useAdminAuth } from '../../context/AdminAuthContext';

const NOTE_MIN = 1;
const NOTE_MAX = 4000;

/// Internal notes panel — internal-only support surface (см. §22 аналитики:
/// notes никогда не показываются tenant-facing UI). Read-only роль видит
/// notes (handoff context), но не может создавать новые.
export default function InternalNotesPanel({
    tenantId,
    initialNotes,
}: {
    tenantId: string;
    initialNotes: SupportNote[];
}) {
    const { isAdmin } = useAdminAuth();
    const [notes, setNotes] = useState<SupportNote[]>(initialNotes);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        setNotes(initialNotes);
    }, [initialNotes]);

    const reload = async () => {
        setRefreshing(true);
        try {
            const r = await adminNotesApi.list(tenantId);
            setNotes(r.items);
        } catch {
            // soft fail — оставляем старый список
        } finally {
            setRefreshing(false);
        }
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = draft.trim();
        if (trimmed.length < NOTE_MIN || trimmed.length > NOTE_MAX) return;
        setSubmitting(true);
        setError(null);
        try {
            const created = await adminNotesApi.create(tenantId, trimmed);
            setNotes((prev) => [created, ...prev]);
            setDraft('');
        } catch (err) {
            const apiErr = extractApiError(err);
            setError(
                apiErr.code === 'FORBIDDEN' || apiErr.code === 'SUPPORT_ADMIN_REQUIRED'
                    ? 'Создание notes доступно только SUPPORT_ADMIN.'
                    : (apiErr.message ?? 'Не удалось создать note'),
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <StickyNote className="h-4 w-4 text-slate-600" />
                    <h3 className="text-sm font-semibold text-slate-900">Internal notes</h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                        <Lock className="h-3 w-3" />
                        Internal-only
                    </span>
                </div>
                <button
                    onClick={reload}
                    disabled={refreshing}
                    className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
                >
                    {refreshing ? '...' : 'Обновить'}
                </button>
            </div>

            {/* Composer — только для SUPPORT_ADMIN. SUPPORT_READONLY видит зону без textarea. */}
            {isAdmin ? (
                <form onSubmit={submit} className="px-4 py-3 border-b border-slate-200">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        maxLength={NOTE_MAX}
                        placeholder="Например: тикет #1234, клиент жалуется на ошибку синка после 21:00 МСК…"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] text-slate-400">
                            {draft.length} / {NOTE_MAX} · видна только support-операторам
                        </span>
                        <button
                            type="submit"
                            disabled={
                                submitting ||
                                draft.trim().length < NOTE_MIN ||
                                draft.trim().length > NOTE_MAX
                            }
                            className="inline-flex items-center px-3 py-1.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md"
                        >
                            {submitting ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                                <Send className="h-3.5 w-3.5 mr-1" />
                            )}
                            Добавить
                        </button>
                    </div>
                    {error && (
                        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                            {error}
                        </div>
                    )}
                </form>
            ) : (
                <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2 text-xs text-slate-500">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Read-only роль не может создавать notes — handoff-context доступен только для
                    чтения.
                </div>
            )}

            {/* List */}
            <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                {notes.length === 0 ? (
                    <li className="p-6 text-center text-sm text-slate-400 italic">
                        Пока ни одной заметки. Первая запись — лучшая опора для handoff.
                    </li>
                ) : (
                    notes.map((n) => (
                        <li key={n.id} className="px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                                <div className="text-xs text-slate-700 font-semibold truncate">
                                    {n.author.email}
                                    <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        {n.author.role.replace('SUPPORT_', '')}
                                    </span>
                                </div>
                                <time className="text-[11px] text-slate-400 flex-shrink-0">
                                    {new Date(n.createdAt).toLocaleString('ru-RU', {
                                        month: '2-digit',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </time>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                                {n.note}
                            </p>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
}
