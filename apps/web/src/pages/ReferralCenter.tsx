import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    Gift, Copy, Check, Users, Wallet, Tag,
    Info, AlertCircle, CheckCircle, XCircle,
    ArrowUpCircle, ArrowDownCircle, ChevronDown, Loader,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface ReferralLink {
    id: string;
    code: string;
    isActive: boolean;
    createdAt: string;
}

interface ReferralStats {
    attributed: number;
    paid: number;
    rewarded: number;
    rejected: number;
    fraudReview: number;
    total: number;
}

interface StatusData {
    hasLink: boolean;
    link: ReferralLink | null;
    stats: ReferralStats;
}

interface BonusTransaction {
    id: string;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    reasonCode: string;
    createdAt: string;
}

type PromoResult =
    | { valid: true; discountType: 'PERCENT' | 'FIXED'; discountValue: number; stackPolicy: string }
    | { valid: false; conflictCode: string; conflictMessage: string }
    | null;

const PROMO_ERROR_MESSAGES: Record<string, string> = {
    PROMO_NOT_FOUND: 'Промокод не найден. Проверьте правильность написания.',
    PROMO_INACTIVE: 'Промокод деактивирован.',
    PROMO_EXPIRED: 'Срок действия промокода истёк.',
    PROMO_MAX_USES_REACHED: 'Промокод исчерпал лимит использований.',
    PROMO_NOT_APPLICABLE: 'Промокод не применим к вашему тарифному плану.',
    PROMO_BONUS_STACK_NOT_ALLOWED: 'Нельзя одновременно использовать промокод и бонусный баланс.',
    PROMO_INVALID: 'Промокод недействителен.',
};

const REASON_LABELS: Record<string, string> = {
    REFERRAL_REWARD: 'Реферальный бонус',
    BONUS_SPEND: 'Списание на оплату подписки',
};

function StatCard({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
    return (
        <div className={`rounded-lg p-3 text-center ${colorClass}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs mt-0.5 font-medium">{label}</div>
        </div>
    );
}

export default function ReferralCenter() {
    const { activeTenant } = useAuth();
    const isOwner = activeTenant?.role === 'OWNER';

    const [loading, setLoading] = useState(true);
    const [link, setLink] = useState<ReferralLink | null>(null);
    const [status, setStatus] = useState<StatusData | null>(null);
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<BonusTransaction[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [copied, setCopied] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const [promoCode, setPromoCode] = useState('');
    const [promoLoading, setPromoLoading] = useState(false);
    const [promoResult, setPromoResult] = useState<PromoResult>(null);
    const promoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isOwner) {
            setLoading(false);
            return;
        }
        const load = async () => {
            try {
                const [linkRes, statusRes, balanceRes, txRes] = await Promise.all([
                    axios.get('/referrals/link'),
                    axios.get('/referrals/status'),
                    axios.get('/referrals/bonus-balance'),
                    axios.get('/referrals/bonus-transactions?limit=20'),
                ]);
                setLink(linkRes.data);
                setStatus(statusRes.data);
                setBalance(balanceRes.data.balance ?? 0);
                setTransactions(txRes.data.items ?? []);
                setNextCursor(txRes.data.nextCursor ?? null);
            } catch {
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [isOwner]);

    const handleCopy = async () => {
        if (!link) return;
        const url = `${window.location.origin}/register?ref=${link.code}`;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            // fallback: select text
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleLoadMore = async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const res = await axios.get(`/referrals/bonus-transactions?limit=20&cursor=${nextCursor}`);
            setTransactions(prev => [...prev, ...(res.data.items ?? [])]);
            setNextCursor(res.data.nextCursor ?? null);
        } catch {
            // ignore
        } finally {
            setLoadingMore(false);
        }
    };

    const handlePromoChange = (val: string) => {
        const upper = val.toUpperCase();
        setPromoCode(upper);
        setPromoResult(null);
        if (promoTimer.current) clearTimeout(promoTimer.current);
        if (!upper.trim()) return;
        promoTimer.current = setTimeout(async () => {
            setPromoLoading(true);
            try {
                const res = await axios.post('/promos/validate', { code: upper.trim(), planId: 'preview' });
                setPromoResult(res.data);
            } catch {
                setPromoResult({ valid: false, conflictCode: 'PROMO_INVALID', conflictMessage: 'Ошибка проверки промокода' });
            } finally {
                setPromoLoading(false);
            }
        }, 600);
    };

    const referralUrl = link ? `${window.location.origin}/register?ref=${link.code}` : '';

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-slate-400">
                <Loader className="animate-spin h-6 w-6 mr-2" />
                Загрузка...
            </div>
        );
    }

    if (!isOwner) {
        return (
            <div className="max-w-xl mx-auto mt-16 text-center space-y-3">
                <Gift className="h-12 w-12 text-slate-300 mx-auto" />
                <h2 className="text-lg font-bold text-slate-700">Реферальная программа</h2>
                <p className="text-sm text-slate-500">Эта страница доступна только владельцу аккаунта.</p>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="max-w-xl mx-auto mt-16 text-center space-y-3">
                <AlertCircle className="h-12 w-12 text-red-300 mx-auto" />
                <p className="text-sm text-red-600">Не удалось загрузить данные. Попробуйте перезагрузить страницу.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in pb-12">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Реферальная программа</h1>

            {/* Referral link */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center mb-4 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 rounded bg-blue-50 flex items-center justify-center mr-4 flex-shrink-0">
                        <Gift className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Ваша реферальная ссылка</h2>
                        <p className="text-sm text-slate-500">Поделитесь ссылкой — получите бонус после первой оплаты приглашённого.</p>
                    </div>
                </div>

                {link ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 font-mono truncate select-all">
                                {referralUrl}
                            </div>
                            <button
                                onClick={handleCopy}
                                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                {copied ? 'Скопировано' : 'Копировать'}
                            </button>
                        </div>
                        <p className="text-xs text-slate-400">
                            Код приглашения:{' '}
                            <span className="font-mono font-semibold text-slate-600">{link.code}</span>
                        </p>
                    </div>
                ) : (
                    <p className="text-sm text-slate-400">Ссылка не найдена.</p>
                )}
            </div>

            {/* Invitation funnel stats */}
            {status && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center mb-4 border-b border-slate-100 pb-4">
                        <div className="w-10 h-10 rounded bg-emerald-50 flex items-center justify-center mr-4 flex-shrink-0">
                            <Users className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Статистика приглашений</h2>
                            <p className="text-sm text-slate-500">Воронка от перехода по ссылке до начисления бонуса.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Зарегистрировались" value={status.stats.attributed} colorClass="bg-blue-50 text-blue-700" />
                        <StatCard label="Оплатили" value={status.stats.paid} colorClass="bg-amber-50 text-amber-700" />
                        <StatCard label="Бонус начислен" value={status.stats.rewarded} colorClass="bg-emerald-50 text-emerald-700" />
                        <StatCard label="Отклонено" value={status.stats.rejected} colorClass="bg-red-50 text-red-700" />
                    </div>
                </div>
            )}

            {/* Rules explanation */}
            <div className="bg-blue-50 border border-blue-100 p-5 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                    <Info className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    <h3 className="font-bold text-blue-900">Как работает реферальная программа</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-blue-800">
                    <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span>
                            Бонус начисляется только после{' '}
                            <strong>первой успешной оплаты любого платного тарифа</strong> приглашённого пользователя.
                            Одна лишь регистрация не даёт бонуса.
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span>
                            По каждому приглашённому бонус начисляется{' '}
                            <strong>только один раз</strong> — все последующие его оплаты бонус не увеличивают.
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span>
                            Атрибуция фиксируется в момент создания аккаунта приглашённым.
                            После этого ссылка не может быть заменена другим реферером.
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <XCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                        <span>
                            <strong>Self-referral заблокирован:</strong> нельзя пригласить самого себя или
                            пользователя, который уже является участником вашего аккаунта.
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>
                            <strong>Промокод и бонусный баланс не совмещаются</strong> в одном платеже.
                            Это правило MVP — выберите что-то одно при оформлении подписки.
                        </span>
                    </li>
                </ul>
            </div>

            {/* Bonus wallet */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center mb-4 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 rounded bg-violet-50 flex items-center justify-center mr-4 flex-shrink-0">
                        <Wallet className="h-5 w-5 text-violet-600" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-bold text-slate-900">Бонусный баланс</h2>
                        <p className="text-sm text-slate-500">История начислений и списаний.</p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-bold text-slate-900">
                            {balance.toLocaleString('ru-RU')} ₽
                        </div>
                        <div className="text-xs text-slate-400">доступно</div>
                    </div>
                </div>

                {transactions.length === 0 ? (
                    <p className="text-sm text-slate-400 py-6 text-center">
                        История операций пуста. Бонусы появятся после первой оплаты приглашённого.
                    </p>
                ) : (
                    <div>
                        {transactions.map(tx => (
                            <div
                                key={tx.id}
                                className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0"
                            >
                                <div className="flex items-center gap-3">
                                    {tx.type === 'CREDIT' ? (
                                        <ArrowUpCircle className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                                    ) : (
                                        <ArrowDownCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
                                    )}
                                    <div>
                                        <div className="text-sm font-medium text-slate-700">
                                            {REASON_LABELS[tx.reasonCode] ?? tx.reasonCode}
                                        </div>
                                        <div className="text-xs text-slate-400">
                                            {new Date(tx.createdAt).toLocaleDateString('ru-RU', {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric',
                                            })}
                                        </div>
                                    </div>
                                </div>
                                <span
                                    className={`text-sm font-bold tabular-nums ${
                                        tx.type === 'CREDIT' ? 'text-emerald-600' : 'text-red-500'
                                    }`}
                                >
                                    {tx.type === 'CREDIT' ? '+' : '−'}
                                    {tx.amount.toLocaleString('ru-RU')} ₽
                                </span>
                            </div>
                        ))}

                        {nextCursor && (
                            <div className="pt-3 flex justify-center">
                                <button
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                                >
                                    {loadingMore ? (
                                        <Loader className="animate-spin h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                    {loadingMore ? 'Загрузка...' : 'Показать больше'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Promo code validator */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center mb-4 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 rounded bg-amber-50 flex items-center justify-center mr-4 flex-shrink-0">
                        <Tag className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Проверить промокод</h2>
                        <p className="text-sm text-slate-500">
                            Узнайте размер скидки заранее. Промокод применяется при оплате подписки.
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={promoCode}
                            onChange={e => handlePromoChange(e.target.value)}
                            placeholder="Введите промокод..."
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono uppercase tracking-widest focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none"
                        />
                        {promoLoading && (
                            <Loader className="animate-spin h-5 w-5 text-slate-400 flex-shrink-0" />
                        )}
                    </div>

                    {promoResult && (
                        promoResult.valid ? (
                            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 flex items-start gap-3">
                                <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                    <p className="font-medium text-emerald-800">Промокод действителен</p>
                                    <p className="text-sm text-emerald-700">
                                        Скидка:{' '}
                                        <strong>
                                            {promoResult.discountType === 'PERCENT'
                                                ? `${promoResult.discountValue}%`
                                                : `${promoResult.discountValue.toLocaleString('ru-RU')} ₽`}
                                        </strong>
                                    </p>
                                    {promoResult.stackPolicy === 'EXCLUSIVE' && (
                                        <p className="text-xs text-amber-700 flex items-center gap-1.5">
                                            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                            Этот промокод нельзя совмещать с бонусным балансом в одном платеже.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-red-50 border border-red-100 rounded-lg p-4 flex items-start gap-3">
                                <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-medium text-red-800">Промокод не принят</p>
                                    <p className="text-sm text-red-700 mt-0.5">
                                        {PROMO_ERROR_MESSAGES[promoResult.conflictCode] ?? promoResult.conflictMessage}
                                    </p>
                                </div>
                            </div>
                        )
                    )}

                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700 leading-relaxed">
                        <strong>Правило совместимости (MVP):</strong> промокод и бонусный баланс{' '}
                        <strong>не совмещаются в одном платеже</strong>. Если хотите использовать
                        накопленные бонусы — не вводите промокод при оплате, и наоборот.
                    </div>
                </div>
            </div>
        </div>
    );
}
