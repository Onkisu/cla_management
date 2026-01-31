import { useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Head } from '@inertiajs/react';
import axios from 'axios';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line
} from 'recharts';

// --- TIPE DATA ---
type TrafficData = {
    id: number;
    run_time: string;
    actual_mbps: number;
    predicted_mbps: number;
    delay_ms: number;
    jitter_ms: number;
    packet_loss: number;
    status: string;
    mape: number;
    detection_time: number;
    convergence_time: number;
};

type SystemMetrics = {
    mttd: number;
    mttr: number;
    reroute_count: number;
};

export default function ForecastDashboard() {
    const [data, setData] = useState<TrafficData[]>([]);
    const [latest, setLatest] = useState<TrafficData | null>(null);
    const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

    const fetchData = async () => {
        try {
            const res = await axios.get('/forecast/data');
            setData(res.data.data);
            setLatest(res.data.latest_status);
            setMetrics(res.data.system_metrics);
        } catch (error) {
            console.error("Error fetching dummy data", error);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = (status: string) => {
        if (status?.includes('CRITICAL')) return 'text-red-600 bg-red-100 border-red-200';
        if (status?.includes('WARNING')) return 'text-yellow-600 bg-yellow-100 border-yellow-200';
        return 'text-green-600 bg-green-100 border-green-200';
    };

    return (
        <AppLayout breadcrumbs={[{ title: 'VoIP Traffic Intelligence', href: '/forecast' }]}>
            <Head title="VoIP Forecast & QoS" />

            <div className="p-4 md:p-8 space-y-6 bg-neutral-50 dark:bg-neutral-900 min-h-screen">

                {/* --- HEADER --- */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
                            SDN VoIP Controller
                        </h1>
                        <p className="text-sm text-gray-500">
                            Closed-Loop Automation • XGBoost Engine
                        </p>
                    </div>
                    {latest && (
                        <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 font-bold animate-pulse ${getStatusColor(latest.status)}`}>
                            <span className="text-xl">●</span>
                            STATUS: {latest.status}
                        </div>
                    )}
                </div>

                {/* --- NETWORK QoS CARDS --- */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <KpiCard title="Predicted Load (t+1)" value={`${latest?.predicted_mbps || 0} Mbps`} sub="Traffic Forecast" icon="📈" status="neutral" />
                    <KpiCard title="One-Way Delay" value={`${latest?.delay_ms || 0} ms`} sub="ITU-T G.114 Limit: <150 ms" icon="⏱️" status={(latest?.delay_ms || 0) > 150 ? 'danger' : 'safe'} />
                    <KpiCard title="Jitter" value={`${latest?.jitter_ms || 0} ms`} sub="ITU-T Limit: <30 ms" icon="〰️" status={(latest?.jitter_ms || 0) > 30 ? 'danger' : 'safe'} />
                    <KpiCard title="Packet Loss" value={`${latest?.packet_loss || 0} %`} sub="Threshold: <1%" icon="📉" status={(latest?.packet_loss || 0) > 1 ? 'danger' : 'safe'} />
                </div>

                {/* --- MAIN CONTENT GRID --- */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* --- LEFT: TRAFFIC CHART (2/3) --- */}
                    <div className="lg:col-span-2 bg-white dark:bg-neutral-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-700 h-[500px] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Real-time Traffic Forecasting</h3>
                            <div className="flex gap-4 text-xs">
                                <span className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-500 rounded-full"></div> Actual</span>
                                <span className="flex items-center gap-2"><div className="w-2 h-2 border border-orange-500 rounded-full"></div> Predicted</span>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data}>
                                    <defs>
                                        <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="run_time" stroke="#9ca3af" fontSize={11} tick={{dy: 10}} />
                                    <YAxis stroke="#9ca3af" fontSize={11} />
                                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', color: '#fff', fontSize: '12px' }} />
                                    <Area type="monotone" dataKey="actual_mbps" stroke="#3b82f6" fill="url(#colorActual)" strokeWidth={2} name="Actual" />
                                    <Line type="monotone" dataKey="predicted_mbps" stroke="#f97316" strokeDasharray="5 5" strokeWidth={2} dot={false} name="Forecast" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* --- RIGHT: LOGS & SYSTEM RELIABILITY (1/3) --- */}
                    <div className="flex flex-col gap-6 h-[500px]">

                        {/* 1. Automation Logs */}
                        <div className="flex-1 bg-white dark:bg-neutral-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-700 flex flex-col min-h-0 overflow-hidden">
                            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 border-b pb-2">📋 Automation Logs</h3>
                            <div className="overflow-y-auto flex-1 custom-scrollbar pr-2">
                                <table className="w-full text-xs text-left text-gray-500">
                                    <tbody className="divide-y divide-gray-100">
                                        {data.slice().reverse().map((row) => (
                                            <tr key={row.id}>
                                                <td className="py-2 font-mono text-[10px]">{row.run_time}</td>
                                                <td className="py-2">
                                                    {row.predicted_mbps > 1100 ?
                                                        <span className="text-red-600 font-bold flex items-center gap-1">⚡ REROUTE</span> :
                                                        <span className="text-blue-600 flex items-center gap-1">👁️ MONITOR</span>
                                                    }
                                                </td>
                                                <td className="py-2 text-right">{Math.round(row.predicted_mbps)} Mbps</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* 2. SYSTEM RELIABILITY METRICS (MTTD & MTTR) */}
                        <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg border border-slate-700 relative overflow-hidden">
                            {/* Background deco */}
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

                            <h3 className="text-sm font-bold text-slate-100 mb-4 flex items-center gap-2 relative z-10">
                                🛡️ System Reliability
                            </h3>

                            <div className="space-y-5 relative z-10">
                                {/* Metric: MTTD */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs text-slate-400 mb-1">MTTD (Mean Time to Detect)</div>
                                        <div className="text-lg font-mono font-bold text-green-400">
                                            {metrics?.mttd || '-'} <span className="text-xs text-slate-500">ms</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-slate-500">Target</div>
                                        <div className="text-xs text-slate-300">≤ 200 ms</div>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-1">
                                    <div className="bg-green-500 h-1 rounded-full transition-all duration-500" style={{ width: `${(metrics?.mttd || 0) / 2}%` }}></div>
                                </div>

                                {/* Metric: MTTR */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs text-slate-400 mb-1">MTTR (Mean Time to Recover)</div>
                                        <div className="text-lg font-mono font-bold text-orange-400">
                                            {metrics?.mttr ? metrics.mttr : <span className="text-gray-600 text-sm">No Incidents</span>}
                                            {metrics?.mttr ? <span className="text-xs text-slate-500"> ms</span> : ''}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-slate-500">Target</div>
                                        <div className="text-xs text-slate-300">{'< 10 sec'}</div>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-1">
                                    <div className="bg-orange-500 h-1 rounded-full transition-all duration-500" style={{ width: `${(metrics?.mttr || 0) / 10}%` }}></div>
                                </div>

                                {/* Accuracy Badge */}
                                <div className="mt-2 pt-3 border-t border-slate-700/50 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">Model Accuracy (RMSE)</span>
                                    <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs font-bold border border-purple-500/30">
                                        {latest?.mape}%
                                    </span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* --- CONTROL --- */}
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl shadow-sm border border-gray-100 flex gap-4 overflow-x-auto">
                     <button className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-xs font-bold whitespace-nowrap">⚡ Inject Burst</button>
                     <button className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-xs font-bold whitespace-nowrap">🛑 Cut Link S1-S2</button>
                     <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-xs font-bold ml-auto whitespace-nowrap">▶ Reset Env</button>
                </div>
            </div>
        </AppLayout>
    );
}

const KpiCard = ({ title, value, sub, icon, status }: any) => {
    const isDanger = status === 'danger';
    return (
        <div className={`rounded-xl p-4 shadow-sm border bg-white dark:bg-neutral-800 ${isDanger ? 'border-red-500 bg-red-50' : 'border-gray-100'}`}>
            <div className="flex justify-between">
                <div>
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</h3>
                    <div className={`mt-1 text-xl font-extrabold ${isDanger ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{value}</div>
                </div>
                <div className="text-xl opacity-60">{icon}</div>
            </div>
            <p className={`text-[10px] mt-2 font-medium ${isDanger ? 'text-red-500' : 'text-gray-400'}`}>{sub}</p>
        </div>
    );
};
