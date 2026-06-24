import { useEffect, useState, useMemo } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Head } from '@inertiajs/react';
import axios from 'axios';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ReferenceLine
} from 'recharts';

// --- TIPE DATA -----
type TrafficData = {
    id: number;
    run_time: string;
    actual_mbps: number | null;
    predicted_mbps: number | null;
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
    mae: number;
    r_squared: number;
};

// Warna per hub — urutan index 0..5 untuk dpid 1..6
const HUB_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const ThresholdAnnotation = (props: any) => {
    const { viewBox } = props;
    if (!viewBox) return null;

    const labelX = viewBox.x + viewBox.width - 150;
    const labelY = viewBox.y + 30;
    const arrowStartX = labelX + 10;
    const arrowStartY = labelY + 30;
    const arrowEndY = viewBox.y + viewBox.height * 0.73;

    return (
        <g>
            <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/>
                </filter>
            </defs>
            <rect x={labelX} y={labelY} width="95" height="30" fill="#10b981" rx="6" filter="url(#shadow)" />
            <text x={labelX + 8} y={labelY + 20} fontSize="14">⚡</text>
            <text x={labelX + 25} y={labelY + 12} fill="#ffffff" fontSize="9" fontWeight="600">Threshold</text>
            <text x={labelX + 25} y={labelY + 23} fill="#ffffff" fontSize="10" fontWeight="700">20 Mbps</text>
            <defs>
                <marker id="arrowhead-down" markerWidth="8" markerHeight="8" refX="4" refY="7" orient="auto">
                    <polygon points="0 0, 8 0, 4 8" fill="#10b981" />
                </marker>
            </defs>
            <line
                x1={arrowStartX} y1={arrowStartY}
                x2={arrowStartX} y2={arrowEndY}
                stroke="#10b981" strokeWidth="2.5"
                markerEnd="url(#arrowhead-down)"
            />
        </g>
    );
};

export default function ForecastDashboard() {
    // --- STATE ---
    const [hubData, setHubData] = useState<Record<number, TrafficData[]>>({});
    const [predictedData, setPredictedData] = useState<{ run_time: string; predicted_mbps: number | null }[]>([]);
    const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
    const [latest, setLatest] = useState<TrafficData | null>(null);
    const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [modelMetrics, setModelMetrics] = useState<ModelMetrics | null>(null);

    // Sumbu X dikunci 1 jam = 360 sample @ interval 10 detik
    const TIME_RANGE = '1h';
    const MAX_SAMPLES = 360;

    const [selectedDpids, setSelectedDpids] = useState<number[]>([5]);
    const [showPredicted, setShowPredicted] = useState(true);
    const [logScale, setLogScale] = useState(false);

    const [selectedScript, setSelectedScript] = useState<'bursty' | 'bursty_2'>('bursty');
    const [scriptRunning, setScriptRunning] = useState(false);
    const [scriptLoading, setScriptLoading] = useState(false);
    const [scriptError, setScriptError] = useState<string | null>(null);
    const [forecastRunning, setForecastRunning] = useState(false);
    const [forecastLoading, setForecastLoading] = useState(false);
    const [forecastError, setForecastError] = useState<string | null>(null);

    // --- FETCH DATA ---
    const fetchData = async () => {
        if (selectedDpids.length === 0) return;
        try {
            // Fetch actual traffic parallel untuk setiap hub yang dipilih
            const hubResults = await Promise.all(
                selectedDpids.map(id =>
                    axios.get('/api/forecast/data', { params: { range: TIME_RANGE, dpid: id } })
                )
            );

            const newHubData: Record<number, TrafficData[]> = {};
            hubResults.forEach((res, i) => {
                const dpid = selectedDpids[i];
                const raw = (res.data.data || []).map((d: TrafficData) => ({
                    ...d,
                    actual_mbps: d.actual_mbps != null && d.actual_mbps > 0 ? d.actual_mbps : null,
                    predicted_mbps: null, // predicted diambil terpisah dari endpoint dpid 5
                }));
                newHubData[dpid] = raw.slice(-MAX_SAMPLES);
            });
            setHubData(newHubData);

            // Predicted hanya dari hasil fetch pertama (forecast_1h tidak terikat dpid tampilan)
            const firstRes = hubResults[0]?.data;
            if (firstRes) {
                const pred = (firstRes.data || []).map((d: any) => ({
                    run_time: d.run_time,
                    predicted_mbps: d.predicted_mbps != null && d.predicted_mbps > 0
                        ? d.predicted_mbps
                        : null,
                })).slice(-MAX_SAMPLES);
                setPredictedData(pred);

                setSystemEvents(firstRes.system_events || []);
                setLatest(firstRes.latest_status || null);
                setMetrics(firstRes.system_metrics || null);
                setModelMetrics(firstRes.model_metrics || null);
            }
            setLoading(false);
        } catch (error) {
            console.error('Error fetching forecast data', error);
            setLoading(false);
        }
    };

    // --- MERGE DATA UNTUK CHART ---
    // Gabungkan semua hub ke satu timeline berdasarkan run_time
    const mergedData = useMemo(() => {
        const allTimes = [...new Set(
            Object.values(hubData).flatMap(rows => rows.map(r => r.run_time))
        )].sort();

        return allTimes.slice(-MAX_SAMPLES).map(t => {
            const row: Record<string, any> = { run_time: t };
            selectedDpids.forEach(id => {
                const found = hubData[id]?.find(r => r.run_time === t);
                row[`hub_${id}`] = found?.actual_mbps ?? null;
            });
            const pred = predictedData.find(p => p.run_time === t);
            row['predicted'] = pred?.predicted_mbps ?? null;
            return row;
        });
    }, [hubData, predictedData, selectedDpids]);

    const handleScriptToggle = async () => {
        setScriptLoading(true);
        setScriptError(null);
        try {
            if (scriptRunning) {
                await axios.post('/api/forecast/script/stop');
                setScriptRunning(false);
            } else {
                await axios.post('/api/forecast/script/start', { script: selectedScript });
                setScriptRunning(true);
            }
        } catch (err: any) {
            setScriptError(err?.response?.data?.message || 'Failed to control script');
        } finally {
            setScriptLoading(false);
        }
    };

    const handleForecastToggle = async () => {
        setForecastLoading(true);
        setForecastError(null);
        try {
            if (forecastRunning) {
                await axios.post('/api/forecast/ai/stop');
                setForecastRunning(false);
            } else {
                await axios.post('/api/forecast/ai/start');
                setForecastRunning(true);
            }
        } catch (err: any) {
            setForecastError(err?.response?.data?.message || 'Failed to control forecast script');
        } finally {
            setForecastLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [selectedDpids]); // re-fetch saat pilihan hub berubah

    useEffect(() => {
        const checkScriptStatus = async () => {
            try {
                const res = await axios.get('/api/forecast/script/status');
                setScriptRunning(res.data.running);
            } catch { /* biarkan default false */ }
        };
        const checkForecastStatus = async () => {
            try {
                const res = await axios.get('/api/forecast/ai/status');
                setForecastRunning(res.data.running);
            } catch { /* biarkan default false */ }
        };
        checkScriptStatus();
        checkForecastStatus();
    }, []);

    const getStatusColor = (status: string) => {
        if (status?.includes('CRITICAL')) return 'text-red-600 bg-red-100 border-red-200';
        if (status?.includes('WARNING')) return 'text-yellow-600 bg-yellow-100 border-yellow-200';
        return 'text-green-600 bg-green-100 border-green-200';
    };

    const formatNumber = (num: number | undefined, decimals: number = 2) =>
        num !== undefined && num !== null ? Number(num).toFixed(decimals) : '0';

    const formatTime = (timestamp: string) =>
        new Date(timestamp).toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });

    const getEventStyle = (eventType: string) => {
        if (eventType === 'REROUTE') return { icon: '⚡', color: 'text-red-600', bg: 'bg-red-50' };
        if (eventType === 'REVERT')  return { icon: '↩️', color: 'text-green-600', bg: 'bg-green-50' };
        return { icon: '👁️', color: 'text-blue-600', bg: 'bg-blue-50' };
    };

    return (
        <AppLayout breadcrumbs={[{ title: 'VoIP Traffic Intelligence', href: '/forecast' }]}>
            <Head title="VoIP Forecast & QoS" />

            <div className="p-4 md:p-8 space-y-6 bg-neutral-50 dark:bg-neutral-900 min-h-screen">

                {/* --- HEADER --- */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">SDN VoIP Controller</h1>
                        <p className="text-sm text-gray-500">Closed-Loop Automation • XGBoost Engine</p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap justify-end">
                        {/* Script Injector */}
                        <div className="flex items-center gap-2 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl px-3 py-2 shadow-sm">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${scriptRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-neutral-600'}`}></span>
                            <select
                                value={selectedScript}
                                onChange={(e) => setSelectedScript(e.target.value as 'bursty' | 'bursty_2')}
                                disabled={scriptRunning || scriptLoading}
                                className="text-xs border border-gray-200 dark:border-neutral-600 rounded-lg px-2 py-1 bg-white dark:bg-neutral-700 text-gray-700 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <option value="bursty">congestion type 1</option>
                                <option value="bursty_2">congestion type 2</option>
                            </select>
                            <button
                                onClick={handleScriptToggle}
                                disabled={scriptLoading}
                                className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
                                    scriptRunning
                                        ? 'bg-red-500 hover:bg-red-600 text-white border-red-600'
                                        : 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600'
                                }`}
                            >
                                {scriptLoading ? (
                                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                ) : scriptRunning ? <>⏹ Stop</> : <>▶ Run</>}
                            </button>
                        </div>

                        {scriptError && (
                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg max-w-xs truncate">
                                ⚠️ {scriptError}
                            </div>
                        )}

                        {/* Forecast Engine */}
                        <div className="flex items-center gap-2 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl px-3 py-2 shadow-sm">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${forecastRunning ? 'bg-blue-500 animate-pulse' : 'bg-gray-300 dark:bg-neutral-600'}`}></span>
                            <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">forecast engine</span>
                            <button
                                onClick={handleForecastToggle}
                                disabled={forecastLoading}
                                className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all duration-200 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
                                    forecastRunning
                                        ? 'bg-red-500 hover:bg-red-600 text-white border-red-600'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white border-blue-600'
                                }`}
                            >
                                {forecastLoading ? (
                                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                ) : forecastRunning ? <>⏹ Stop</> : <>▶ Run</>}
                            </button>
                        </div>

                        {forecastError && (
                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg max-w-xs truncate">
                                ⚠️ {forecastError}
                            </div>
                        )}

                        {latest && (
                            <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 font-bold animate-pulse ${getStatusColor(latest.status)}`}>
                                <span className="text-xl">●</span>
                                STATUS: {latest.status}
                            </div>
                        )}
                    </div>
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
                        title="Predicted Load (t+10)"
                        value={
                            latest?.predicted_mbps != null && latest.predicted_mbps > 0
                                ? `${formatNumber(latest.predicted_mbps, 3)} Mbps`
                                : '— Mbps'
                        }
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

                        {/* Chart Header */}
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Traffic Forecasting</h3>
                                <span className="text-[10px] text-gray-400">Window: 1 jam · {MAX_SAMPLES} sample · interval 10s</span>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                {/* Hub checkboxes */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-gray-500 font-medium">Hub:</span>
                                    {[1, 2, 3, 4, 5, 6].map((id, i) => (
                                        <label key={id} className="flex items-center gap-1 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={selectedDpids.includes(id)}
                                                onChange={(e) => {
                                                    setSelectedDpids(prev =>
                                                        e.target.checked
                                                            ? [...prev, id]
                                                            : prev.filter(d => d !== id)
                                                    );
                                                }}
                                                style={{ accentColor: HUB_COLORS[i] }}
                                            />
                                            <span className="text-xs font-medium" style={{ color: HUB_COLORS[i] }}>
                                                {id}
                                            </span>
                                        </label>
                                    ))}
                                </div>

                                {/* Predicted toggle */}
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={showPredicted}
                                        onChange={(e) => setShowPredicted(e.target.checked)}
                                        style={{ accentColor: '#f97316' }}
                                    />
                                    <span className="text-xs font-medium text-orange-500">Predicted</span>
                                </label>

                                {/* Log/Linear toggle */}
                                <button
                                    onClick={() => setLogScale(prev => !prev)}
                                    className={`text-xs border rounded-lg px-2 py-1 transition-colors ${
                                        logScale
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white dark:bg-neutral-700 text-gray-700 dark:text-white border-gray-200 dark:border-neutral-600'
                                    }`}
                                >
                                    {logScale ? 'Log' : 'Linear'}
                                </button>
                            </div>
                        </div>

                        {/* Chart Body */}
                        <div className="flex-1 w-full min-h-0">
                            {mergedData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={mergedData}>
                                        <defs>
                                        {selectedDpids.map((id) => (
    <linearGradient key={id} id={`colorHub${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={HUB_COLORS[(id - 1) % HUB_COLORS.length]} stopOpacity={0.18} />
        <stop offset="95%" stopColor={HUB_COLORS[(id - 1) % HUB_COLORS.length]} stopOpacity={0} />
    </linearGradient>
))}
                                        </defs>

                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />

                                        <XAxis
                                            dataKey="run_time"
                                            stroke="#9ca3af"
                                            fontSize={11}
                                            tick={{ dy: 10 }}
                                            // ~6 label untuk 360 sample
                                            interval={Math.floor(MAX_SAMPLES / 6)}
                                        />

                                        <YAxis
                                            stroke="#9ca3af"
                                            fontSize={11}
                                            scale={logScale ? 'log' : 'auto'}
                                            domain={logScale ? ['auto', 'auto'] : [0, 'auto']}
                                            tickFormatter={(v) => Number(v).toFixed(1)}
                                            label={{ value: 'Mbps', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                                        />

                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1f2937', color: '#fff', fontSize: '12px', borderRadius: '8px' }}
                                            formatter={(value: any, name: string) => [
                                                value != null ? `${Number(value).toFixed(2)} Mbps` : '—',
                                                name
                                            ]}
                                        />

                                        {/* Area per hub (actual traffic) */}
                                        {selectedDpids.map((id) => (
    <Area
        key={`hub_${id}`}
        type="monotone"
        dataKey={`hub_${id}`}
        stroke={HUB_COLORS[(id - 1) % HUB_COLORS.length]} // <--- Berubah di sini
        fill={`url(#colorHub${id})`}
        strokeWidth={2}
        dot={false}
        connectNulls={false}
        name={`Hub ${id}`}
    />
))}

                                        {/* Predicted line — toggle via checkbox, tanpa dpid */}
                                        {showPredicted && (
                                            <Line
                                                type="monotone"
                                                dataKey="predicted"
                                                stroke="#f97316"
                                                strokeWidth={2}
                                                dot={false}
                                                connectNulls={false}
                                                name="Predicted"
                                                strokeDasharray="5 3"
                                            />
                                        )}

                                        <ReferenceLine
                                            y={20}
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

                        {/* 2. SYSTEM RELIABILITY METRICS */}
                        <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg border border-slate-700 relative overflow-hidden">
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
                                                <>{formatNumber(metrics.mttr, 0)} <span className="text-xs text-slate-500">ms</span></>
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

                                <div className="mt-2 pt-3 border-t border-slate-700/50 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">RMSE</span>
                                    <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-xs font-bold border border-purple-500/30">
                                        {formatNumber(modelMetrics?.rmse, 2)} Mbps
                                    </span>
                                </div>
                                <div className="pt-2 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">MAE</span>
                                    <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded text-xs font-bold border border-cyan-500/30">
                                        {formatNumber(modelMetrics?.mae, 2)} Mbps
                                    </span>
                                </div>
                                <div className="pt-2 flex justify-between items-center">
                                    <span className="text-xs text-slate-400">R²</span>
                                    <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded text-xs font-bold border border-green-500/30">
                                        {formatNumber(modelMetrics?.r_squared, 4)}
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
