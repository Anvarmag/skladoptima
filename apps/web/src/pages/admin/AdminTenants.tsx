import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink, Loader2 } from 'lucide-react';
import {
    adminTenantsApi,
    type AccessState,
    type TenantStatus,
    type TenantDirectoryRow,
    type ListTenantsQuery,
} from '../../api/admin';

const ACCESS_STATES: AccessState[] = [
    'TRIAL_ACTIVE',
    'TRIAL_EXPIRED',
    'ACTIVE_PAID',
    'GRACE_PERIOD',
    'SUSPENDED',
    'EARLY_ACCESS',
    'CLOSED',
];

const TENANT_STATUSES: TenantStatus[] = ['ACTIVE', 'CLOSURE_PENDING', 'CLOSED'];

const ACCESS_STATE_LABEL: Record<AccessState, string> = {
    TRIAL_ACTIVE: 'Trial',
    TRIAL_EXPIRED: 'Trial истёк',
    ACTIVE_PAID: 'Платная',
    GRACE_PERIOD: 'Grace',
    SUSPENDED: 'Suspended',
    EARLY_ACCESS: 'Early access',
    CLOSED: 'Закрыт',
};

const ACCESS_STATE_TONE: Record<AccessState, string> = {
    TRIAL_ACTIVE: 'bg-blue-100 text-blue-800',
    TRIAL_EXPIRED: 'bg-amber-100 text-amber-800',
    ACTIVE_PAID: 'bg-green-100 text-green-800',
    GRACE_PERIOD: 'bg-orange-100 text-orange-800',
    SUSPENDED: 'bg-red-100 text-red-800',
    EARLY_ACCESS: 'bg-violet-100 text-violet-800',
    CLOSED: 'bg-slate-200 text-slate-700',
};

export default function AdminTenants() {
    const [query, setQuery] = useState<ListTenantsQuery>({});
    const [searchInput, setSearchInput] = useState('');
    const [items, setItems] = useState<TenantDirectoryRow[]>([]);
    const [total, setTotal] = useState(0);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Базовый загрузчик. Сбрасывает страницу — используется при изменении фильтров.
    const fetchFirstPage = async (q: ListTenantsQuery) => {
        setLoading(true);
        setError(null);
        try {
            const page = await adminTenantsApi.list(q);
            setItems(page.items);
            setTotal(page.total);
            setNextCursor(page.nextCursor);
        } catch {
            setError('Не удалось загрузить tenant directory');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFirstPage(query);
    }, [query.q, query.accessState, query.status]);

    const loadMore = async () => {
        if (!nextCursor) return;
        setLoadingMore(true);
        try {
            const page = await adminTenantsApi.list({ ...query, cursor: nextCursor });
            setItems((prev) => [...prev, ...page.items]);
            setNextCursor(page.nextCursor);
        } catch {
            setError('Не удалось подгрузить следующую страницу');
        } finally {
            setLoadingMore(false);
        }
    };

    const onSubmitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setQuery({ ...query, q: searchInput.trim() || undefined });
    };

    const setFilter = (patch: Partial<ListTenantsQuery>) => {
        setQuery({ ...query, ...patch, cursor: undefined });
    };

    return (
        <div className="space-y-4">
            <header className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Tenant directory</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Read-only diagnostics. Mutating actions — внутри tenant 360.
                    </p>
                </div>
                <div className="text-sm text-slate-500">
                    Найдено: <span className="font-semibold text-slate-900">{total}</span>
                </div>
            </header>

            {/* Filters */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <form onSubmit={onSubmitSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="UUID tenant'а, имя или email владельца"
                            className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="submit"
                        className="px-4 py-2 text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 rounded-md"
                    >
                        Искать
                    </button>
                    {(query.q || query.accessState || query.status) && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery({});
                                setSearchInput('');
                            }}
                            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
                        >
                            Сбросить
                        </button>
                    )}
                </form>

                <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                        <span className="text-slate-600">Access state:</span>
                        <select
                            value={query.accessState ?? ''}
                            onChange={(e) =>
                                setFilter({
                                    accessState: (e.target.value || undefined) as
                                        | AccessState
                                        | undefined,
                                })
                            }
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                        >
                            <option value="">все</option>
                            {ACCESS_STATES.map((s) => (
                                <option key={s} value={s}>
                                    {ACCESS_STATE_LABEL[s]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex items-center gap-2">
                        <span className="text-slate-600">Status:</span>
                        <select
                            value={query.status ?? ''}
                            onChange={(e) =>
                                setFilter({
                                    status: (e.target.value || undefined) as
                                        | TenantStatus
                                        | undefined,
                                })
                            }
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                        >
                            <option value="">все</option>
                            {TENANT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {loading ? (
                    <div className="p-12 flex items-center justify-center text-slate-500">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Загрузка…
                    </div>
                ) : error ? (
                    <div className="p-8 text-center text-red-600 text-sm">{error}</div>
                ) : items.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 text-sm">
                        Ничего не найдено по текущим фильтрам.
                    </div>
                ) : (
                    <>
                        <div className="hidden md:block">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        <th className="px-4 py-3">Tenant</th>
                                        <th className="px-4 py-3">Access</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Owner</th>
                                        <th className="px-4 py-3 text-center">Team</th>
                                        <th className="px-4 py-3 text-center">Active MP</th>
                                        <th className="px-4 py-3">Created</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100">
                                    {items.map((t) => (
                                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <Link
                                                    to={`/admin/tenants/${t.id}`}
                                                    className="block group"
                                                >
                                                    <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-600">
                                                        {t.name}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 font-mono">
                                                        {t.id}
                                                    </div>
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3">
                                                <AccessStateBadge state={t.accessState} />
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {t.status}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                {t.primaryOwner ? (
                                                    <span className="text-slate-700">
                                                        {t.primaryOwner.email}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center text-sm text-slate-700">
                                                {t.teamSize}
                                            </td>
                                            <td className="px-4 py-3 text-center text-sm text-slate-700">
                                                {t.marketplaceAccountsActive}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">
                                                {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link
                                                    to={`/admin/tenants/${t.id}`}
                                                    className="text-blue-600 hover:text-blue-800 inline-flex items-center text-sm"
                                                >
                                                    Открыть
                                                    <ExternalLink className="h-3.5 w-3.5 ml-1" />
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="md:hidden divide-y divide-slate-100">
                            {items.map((t) => (
                                <Link
                                    key={t.id}
                                    to={`/admin/tenants/${t.id}`}
                                    className="block p-4 hover:bg-slate-50"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-900 truncate">
                                                {t.name}
                                            </div>
                                            <div className="text-[11px] text-slate-400 font-mono truncate">
                                                {t.id}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1 truncate">
                                                {t.primaryOwner?.email ?? '—'}
                                            </div>
                                        </div>
                                        <AccessStateBadge state={t.accessState} />
                                    </div>
                                    <div className="text-xs text-slate-500 mt-2 flex gap-3">
                                        <span>Team: {t.teamSize}</span>
                                        <span>MP: {t.marketplaceAccountsActive}</span>
                                        <span>{t.status}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </>
                )}

                {nextCursor && (
                    <div className="border-t border-slate-200 p-3 text-center">
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
                        >
                            {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function AccessStateBadge({ state }: { state: AccessState }) {
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${ACCESS_STATE_TONE[state]}`}
        >
            {ACCESS_STATE_LABEL[state]}
        </span>
    );
}
