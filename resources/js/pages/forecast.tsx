import { useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Head } from '@inertiajs/react';
import axios from 'axios';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line,ReferenceLine
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

type SystemEvent = {
    id: number;
    timestamp: string;
    event_type: string;
    description: string;
    trigger_value: number;
};

type ModelMetrics = {
    mape: number;
    rmse: number;
};


// Tambahin di luar component ForecastDashboard, sebelum export default
const ThresholdAnnotation = (props: any) => {
    const { viewBox } = props;
    if (!viewBox) return null;
    
    // Fixed position di kanan atas chart area
    const labelX = viewBox.x + viewBox.width - 150;
    const labelY = viewBox.y + 30;
    const arrowStartX = labelX + 10;
    const arrowStartY = labelY + 30;
    const arrowEndY = viewBox.y + viewBox.height * 0.73; // nunjuk ke threshold line (sekitar 0.2 di Y axis)
    
    return (
        <g>
            {/* Background Box with shadow */}
            <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/>
                </filter>
            </defs>
            
            <rect
                x={labelX}
                y={labelY}
                width="95"
                height="30"
                fill="#10b981"
                rx="6"
                filter="url(#shadow)"
            />
            
            {/* Icon */}
            <text
                x={labelX + 8}
                y={labelY + 20}
                fontSize="14"
            >
                ⚡
            </text>
            
            {/* Text */}
            <text
                x={labelX + 25}
                y={labelY + 12}
                fill="#ffffff"
                fontSize="9"
                fontWeight="600"
            >
                Threshold
            </text>
            <text
                x={labelX + 25}
                y={labelY + 23}
                fill="#ffffff"
                fontSize="10"
                fontWeight="700"
            >
                40 Mbps
            </text>
            
            {/* Vertical Arrow */}
            <defs>
                <marker
                    id="arrowhead-down"
                    markerWidth="8"
                    markerHeight="8"
                    refX="4"
                    refY="7"
                    orient="auto"
                >
                    <polygon points="0 0, 8 0, 4 8" fill="#10b981" />
                </marker>
            </defs>
            
            <line
                x1={arrowStartX}
                y1={arrowStartY}
                x2={arrowStartX}
                y2={arrowEndY}
                stroke="#10b981"
                strokeWidth="2.5"
                markerEnd="url(#arrowhead-down)"
            />
        </g>
    );
};

export default function ForecastDashboard() {
    const [data, setData] = useState<TrafficData[]>([]);
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [latest, setLatest] = useState<TrafficData | null>(null);
    const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [modelMetrics, setModelMetrics] = useState<ModelMetrics | null>(null);

    const fetchData = async () => {
        try {
            const res = await axios.get('/api/forecast/data');
            setData(res.data.data || []);
            setSystemEvents(res.data.system_events || []);
            setLatest(res.data.latest_status || null);
            setMetrics(res.data.system_metrics || null);
            setModelMetrics(res.data.model_metrics || null);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching forecast data", error);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = (status: string) => {
        if (status?.includes('CRITICAL')) return 'text-red-600 bg-red-100 border-red-200';
        if (status?.includes('WARNING')) return 'text-yellow-600 bg-yellow-100 border-yellow-200';
        return 'text-green-600 bg-green-100 border-green-200';
    };

    // Format number with proper decimals
    const formatNumber = (num: number | undefined, decimals: number = 2) => {
        return num !== undefined && num !== null ? Number(num).toFixed(decimals) : '0';
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false
        });
    };


      // Get event icon and color based on type
    const getEventStyle = (eventType: string) => {
        if (eventType === 'REROUTE') {
            return { icon: '⚡', color: 'text-red-600', bg: 'bg-red-50' };
        } else if (eventType === 'REVERT') {
            return { icon: '↩️', color: 'text-green-600', bg: 'bg-green-50' };
        }
        return { icon: '👁️', color: 'text-blue-600', bg: 'bg-blue-50' };
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

                {/* Loading State */}
                {loading && (
                    <div className="text-center py-8">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                        <p className="mt-2 text-gray-600">Loading real-time data...</p>
                    </div>
                )}

                {/* --- NETWORK QoS CARDS --- */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <KpiCard 
                        title="Predicted Load (t+10s)" 
                        value={`${formatNumber(latest?.predicted_mbps, 3)} Mbps`} 
                        sub="Traffic Forecast" 
                        icon="📈" 
                        status="neutral" 
                    />
                    <KpiCard 
                        title="One-Way Delay" 
                        value={`${formatNumber(latest?.delay_ms, 1)} ms`} 
                        sub="ITU-T G.114 Limit: <150 ms" 
                        icon="⏱️" 
                        status={(latest?.delay_ms || 0) > 150 ? 'danger' : 'safe'} 
                    />
                    <KpiCard 
                        title="Jitter" 
                        value={`${formatNumber(latest?.jitter_ms, 2)} ms`} 
                        sub="ITU-T Limit: <30 ms" 
                        icon="〰️" 
                        status={(latest?.jitter_ms || 0) > 30 ? 'danger' : 'safe'} 
                    />
                    <KpiCard 
                        title="Packet Loss" 
                        value={`${formatNumber(latest?.packet_loss, 2)} %`} 
                        sub="Threshold: <1%" 
                        icon="📉" 
                        status={(latest?.packet_loss || 0) > 1 ? 'danger' : 'safe'} 
                    />
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
                            {data.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data}>
                                        <defs>
                                            <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                        <XAxis 
                                            dataKey="run_time" 
                                            stroke="#9ca3af" 
                                            fontSize={11} 
                                            tick={{dy: 10}}
                                            interval="preserveStartEnd"
                                        />
                                        <YAxis 
                                            stroke="#9ca3af" 
                                            fontSize={11}
                                            label={{ value: 'Mbps', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                                        />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#1f2937', color: '#fff', fontSize: '12px', borderRadius: '8px' }}
                                            formatter={(value: any) => [`${Number(value).toFixed(2)} Mbps`, '']}
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="actual_mbps" 
                                            stroke="#3b82f6" 
                                            fill="url(#colorActual)" 
                                            strokeWidth={2} 
                                            name="Actual" 
                                        />
                                        <Line 
                                            type="monotone" 
                                            dataKey="predicted_mbps" 
                                            stroke="#f97316"  
                                            strokeWidth={2} 
                                            dot={false} 
                                            name="Forecast" 
                                        />
                                        {/* Threshold Line */}
                       <ReferenceLine 
            y={40} 
            stroke="#10b981" 
            strokeDasharray="8 4" 
            strokeWidth={2}
            label={<ThresholdAnnotation />}
        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-400">
                                    No data available
                                </div>
                            )}
                        </div>
                    </div>

                    {/* --- RIGHT: LOGS & SYSTEM RELIABILITY (1/3) --- */}
                    <div className="flex flex-col gap-6 h-[500px]">

                        {/* 1. Automation Logs */}
                        <div className="flex-1 bg-white dark:bg-neutral-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-700 flex flex-col min-h-0 overflow-hidden">
                            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 border-b pb-2">📋 Automation Logs</h3>
                            <div className="overflow-y-auto flex-1 custom-scrollbar pr-2">
                              {systemEvents.length > 0 ? (
                                    <div className="space-y-2">
                                        {systemEvents.map((event) => {
                                            const style = getEventStyle(event.event_type);
                                            return (
                                                <div 
                                                    key={event.id} 
                                                    className={`${style.bg} border border-gray-200 dark:border-neutral-600 rounded-lg p-2.5 transition-all hover:shadow-sm`}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                                            <span className="text-base flex-shrink-0">{style.icon}</span>
                                                            <div className="flex-1 min-w-0">
                                                                <div className={`text-xs font-bold ${style.color} uppercase tracking-wide`}>
                                                                    {event.event_type}
                                                                </div>
                                                                <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 truncate">
                                                                    {event.description}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right flex-shrink-0">
                                                            <div className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                                                {formatTime(event.timestamp)}
                                                            </div>
                                                            <div className="text-[10px] font-bold text-gray-700 dark:text-gray-200 mt-0.5">
                                                                {formatNumber(event.trigger_value / 1000000, 3)} Mbps
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center text-gray-400 py-4">No logs available</div>
                                )}
                            </div>
                        </div>

                        {/* 2. SYSTEM RELIABILITY METRICS (TTR) */}
                        <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg border border-slate-700 relative overflow-hidden">
                            {/* Background deco */}
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

                            <h3 className="text-sm font-bold text-slate-100 mb-4 flex items-center gap-2 relative z-10">
                                🛡️ System Reliability
                            </h3>

                            <div className="space-y-5 relative z-10">                     
                              

                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs text-slate-400 mb-1">Time to Reroute</div>
                                        <div className="text-lg font-mono font-bold text-orange-400">
                                            {metrics?.mttr && metrics.mttr > 0 ? (
                                                <>
                                                    {formatNumber(metrics.mttr, 0)} <span className="text-xs text-slate-500">ms</span>
                                                </>
                                            ) : (
                                                <span className="text-gray-600 text-sm">No Incidents</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-slate-500">Target</div>
                                        <div className="text-xs text-slate-300">{'< 10 sec'}</div>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-1">
                                    <div 
                                        className="bg-orange-500 h-1 rounded-full transition-all duration-500" 
                                        style={{ width: `${Math.min((metrics?.mttr || 0) / 10000 * 100, 100)}%` }}
                                    ></div>
                                </div>

                                {/* Accuracy Badge */}
                                <div className="mt-2 pt-3 border-t border-slate-700/50 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">MAPE</span>
                                    <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs font-bold border border-purple-500/30">
                                        {formatNumber(modelMetrics?.mape, 1)}%
                                    </span>
                                </div>

                    
                                <div className="mt-2 pt-3 border-t border-slate-700/50 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">RMSE</span>
                                    <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs font-bold border border-purple-500/30">
                                        {formatNumber(modelMetrics?.rmse, 2)} Mbps
                                    </span>
                                </div>


                            </div>
                        </div>

                    </div>
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