import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    AreaChart, Area, PieChart, Pie, Cell,
    ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
    TrendingUp, AlertCircle, CheckCircle2,
    Info, ArrowRight, Star
} from 'lucide-react';

export default function Analytics() {
    const [data, setData] = useState<any[]>([]);
    const [geoData, setGeoData] = useState<any[]>([]);
    const [revenueDynamics, setRevenueDynamics] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [recRes, geoRes, dynRes] = await Promise.all([
                    axios.get('/analytics/recommendations'),
                    axios.get('/analytics/geo'),
                    axios.get('/analytics/revenue-dynamics')
                ]);
                setData(recRes.data);
                setGeoData(geoRes.data);
                setRevenueDynamics(dynRes.data);
            } catch (err) {
                console.error('Failed to fetch analytics', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    if (loading) return <div className="p-8 text-center text-slate-500">Загрузка аналитики...</div>;

    // Using live dynamics data

    const abcDistribution = [
        { name: 'Группа A', value: data.filter(p => p.abcClass === 'A').length, color: '#3b82f6' },
        { name: 'Группа B', value: data.filter(p => p.abcClass === 'B').length, color: '#f59e0b' },
        { name: 'Группа C', value: data.filter(p => p.abcClass === 'C').length, color: '#ef4444' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Аналитика и рекомендации</h1>
                    <p className="text-slate-500 text-sm">Умные советы по управлению ассортиментом и продажами</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200">
                    <Info className="h-3.5 w-3.5" />
                    Обновлено сегодня в {new Date().toLocaleTimeString().slice(0, 5)}
                </div>
            </div>

            {/* Top Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <TrendingUp className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Группа A (ТОП)</p>
                            <h2 className="text-2xl font-bold text-slate-900">{abcDistribution[0].value} тов.</h2>
                        </div>
                    </div>
                    <div className="mt-4 text-xs text-blue-600 font-medium flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" /> Приносят 80% вашей выручки
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-50 text-orange-600 rounded-xl">
                            <AlertCircle className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Out-of-Stock риск</p>
                            <h2 className="text-2xl font-bold text-slate-900">
                                {data.filter(p => p.daysRemaining < 7).length} тов.
                            </h2>
                        </div>
                    </div>
                    <div className="mt-4 text-xs text-orange-600 font-medium">
                        Срочно пополните, чтобы не потерять позиции
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-yellow-50 text-yellow-600 rounded-xl">
                            <Star className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Средний рейтинг</p>
                            <h2 className="text-2xl font-bold text-slate-900">4.82</h2>
                        </div>
                    </div>
                    <div className="mt-4 text-xs text-yellow-600 font-medium">
                        +0.1 за прошлую неделю
                    </div>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                        Динамика выручки (30д)
                    </h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={revenueDynamics}>
                                <defs>
                                    <linearGradient id="colorWB" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorOzon" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                                <Tooltip />
                                <Legend verticalAlign="top" align="right" height={36} />
                                <Area name="Wildberries" type="monotone" dataKey="wb" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorWB)" />
                                <Area name="Ozon" type="monotone" dataKey="ozon" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorOzon)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                        ABC-анализ ассортимента
                    </h3>
                    <div className="h-64 flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={abcDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {abcDistribution.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend layout="vertical" align="right" verticalAlign="middle" />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Recommendations Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Умные рекомендации</h3>
                    <button className="text-blue-600 text-sm font-bold flex items-center gap-1 hover:underline" title="Открыть подробный список всех рекомендаций">
                        Весь список советов <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                                <th className="px-6 py-4 w-10">МП</th>
                                <th className="px-6 py-4">Товар</th>
                                <th className="px-6 py-4">Анализ</th>
                                <th className="px-6 py-4">Остаток (дн)</th>
                                <th className="px-6 py-4">Рекомендация</th>
                                <th className="px-6 py-4 text-right">Действие</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {data.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4">
                                        {p.marketplace === 'WB' ? (
                                            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center font-black text-purple-700 text-[10px]" title="Wildberries">WB</div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center font-black text-blue-700 text-[10px]" title="Ozon">OZ</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">{p.sku}</div>
                                        <div className="text-xs text-slate-500 truncate max-w-[200px]">{p.name}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold ${p.abcClass === 'A' ? 'bg-blue-50 text-blue-700' :
                                            p.abcClass === 'B' ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600'
                                            }`}>
                                            Класс {p.abcClass}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className={`text-sm font-bold ${p.daysRemaining < 7 ? 'text-red-600' : 'text-slate-700'}`}>
                                            {p.daysRemaining} дн.
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            {p.priority === 'high' ? <AlertCircle className="h-4 w-4 text-red-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                            <span className="text-sm font-medium text-slate-700">{p.recommendation}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            className="text-blue-600 hover:text-blue-800 font-bold text-sm"
                                            title="Добавить товар в план закупок на основе рекомендации"
                                        >
                                            В план
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
