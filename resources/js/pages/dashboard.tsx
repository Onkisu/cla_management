import { useEffect, useState, Fragment } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import AppLayout from '@/layouts/app-layout';
import { dashboard } from '@/routes';
import { type BreadcrumbItem } from '@/types';
import { Head } from '@inertiajs/react';

const breadcrumbs: BreadcrumbItem[] = [
  { title: 'Dashboard', href: dashboard().url },
];

// --- TIPE DATA ---
type KpiCategoryStats = {
  timestamp: string;
  category: string;
  throughput_bps: number | null;
  pps_tx: number | null;
  avg_latency_ms: number | null;
  avg_jitter_ms: number | null;
  active_flows: number | null;
};

type RawDataResponse = KpiCategoryStats[];

type ProcessedDataPoint = {
  timestamp: string;
  [key: string]: number | string | undefined;
};

type ChartDataPoint = {
  timestamp: string;
  [key: string]: number | string | undefined;
};

type CardStat = {
  totalMBps: number;
  percentageMBps: number;
  changeMBps: number;
  totalPPS: number;
  changePPS: number;
  avgLatency: number;
  changeLatency: number;
  avgJitter: number;
  changeJitter: number;
  totalFlows: number;
  changeFlows: number;
};

type SimpleStatCardProps = {
  title: string;
  value: string;
  change: number;
  unit: string;
  changeUnit: string;
};

const lineColors = ['#db1010ff', '#d2831bff', '#9146FF', '#1E88E5', '#00ACC1', '#43A047'];
const getColor = (index: number) => lineColors[index % lineColors.length];

// --- COMPONENTS ---
const CircularProgress = ({ percentage }: { percentage: number }) => {
  const clamped = Math.max(0, Math.min(100, percentage));
  return (
    <div className="relative flex h-20 w-20 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(#1E88E5 ${clamped}%, #E0E0E0 ${clamped}%)` }}>
      <div className="absolute h-[85%] w-[85%] rounded-full bg-white dark:bg-neutral-900"></div>
      <span className="z-10 text-lg font-bold text-black dark:text-white">{percentage.toFixed(1)}%</span>
    </div>
  );
};

const SimpleStatCard = ({ title, value, change, unit, changeUnit }: SimpleStatCardProps) => {
  const changeColor = change >= 0 ? 'text-green-500' : 'text-red-500';
  const icon = change >= 0 ? '▲' : '▼';
  return (
    <div className="rounded-xl border border-sidebar-border/70 dark:border-sidebar-border bg-white dark:bg-neutral-900 p-4">
      <div className="flex flex-col h-full justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 capitalize">{title}</h3>
        <span className="text-2xl font-bold text-black dark:text-white my-1">
          {value} <span className="text-base font-normal">{unit}</span>
        </span>
        <span className={`text-sm font-medium ${changeColor}`}>
          {icon} {change.toFixed(1)} {changeUnit} (vs 5s ago)
        </span>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const [rawData, setRawData] = useState<ProcessedDataPoint[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartMetric, setChartMetric] = useState<'throughput' | 'pps' | 'latency' | 'jitter'>('throughput');
  const [chartKeys, setChartKeys] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [cardStats, setCardStats] = useState<Record<string, CardStat>>({});

  // --- FETCH DATA ---
  const fetchData = async () => {
    try {
      const res = await fetch('/api/kpi/stats-by-category');
      const latestArray = (await res.json()) as RawDataResponse;

      if (!Array.isArray(latestArray) || latestArray.length === 0) return;

      const apiTimestampStr = latestArray[0].timestamp;
      // [REAL-TIME] Gunakan detik agar grafik bergerak
      const apiTimeLabel = new Date(apiTimestampStr).toLocaleTimeString();

      setRawData(prev => {
        const lastIndex = prev.length - 1;
        const lastPoint = prev[lastIndex];

        // Merge Logic
        const isSameMoment = lastPoint && lastPoint.timestamp === apiTimeLabel;

        const targetPoint: ProcessedDataPoint = isSameMoment
          ? { ...lastPoint }
          : { timestamp: apiTimeLabel };

        latestArray.forEach(stats => {
          const cat = stats.category;

          targetPoint[`${cat}_mbps`] = (stats.throughput_bps !== null)
            ? (stats.throughput_bps * 8) / 1_000_000
            : undefined;

          targetPoint[`${cat}_pps`] = (stats.pps_tx !== null) ? stats.pps_tx : undefined;
          targetPoint[`${cat}_latency`] = (stats.avg_latency_ms !== null) ? stats.avg_latency_ms : undefined;
          targetPoint[`${cat}_jitter`] = (stats.avg_jitter_ms !== null) ? stats.avg_jitter_ms : undefined;
          targetPoint[`${cat}_flows`] = (stats.active_flows !== null) ? stats.active_flows : undefined;
        });

        if (isSameMoment) {
          const newData = [...prev];
          newData[lastIndex] = targetPoint;
          return newData;
        } else {
          return [...prev, targetPoint].slice(-20); // 20 Detik terakhir
        }
      });
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  // --- PROSES CHART & CARD ---
  useEffect(() => {
    if (rawData.length === 0) return;

    // 1. Chart Processing
    let suffix = '';
    switch (chartMetric) {
        case 'throughput': suffix = '_mbps'; break;
        case 'pps': suffix = '_pps'; break;
        case 'latency': suffix = '_latency'; break;
        case 'jitter': suffix = '_jitter'; break;
    }

    const newKeys = new Set<string>();

    const processed = rawData.map(point => {
      const chartPoint: ChartDataPoint = { timestamp: point.timestamp };
      availableCategories.forEach(cat => {
        const key = `${cat}${suffix}`;
        newKeys.add(cat);
        chartPoint[cat] = point[key] as number | undefined;
      });
      return chartPoint;
    });

    setChartData(processed);
    setChartKeys(Array.from(newKeys));

    // 2. Card Logic (Smart Look-Back)
    const newStats: Record<string, CardStat> = {};
    let totalAllMBps = 0;

    const findLastValidPoint = (field: string): ProcessedDataPoint | null => {
      for (let i = rawData.length - 1; i >= 0; i--) {
        if (typeof rawData[i][field] === 'number') return rawData[i];
      }
      return null;
    };

    const findPrevValidPoint = (field: string, latestIdx: number): ProcessedDataPoint | null => {
      for (let i = latestIdx - 1; i >= 0; i--) {
        if (typeof rawData[i][field] === 'number') return rawData[i];
      }
      return null;
    };

    availableCategories.forEach(cat => {
        const validPoint = findLastValidPoint(`${cat}_mbps`);
        if (validPoint) totalAllMBps += (validPoint[`${cat}_mbps`] as number);
    });

    availableCategories.forEach(cat => {
      let latestIdx = -1;
      for (let i = rawData.length - 1; i >= 0; i--) {
        if (typeof rawData[i][`${cat}_mbps`] === 'number') {
          latestIdx = i;
          break;
        }
      }

      if (latestIdx === -1) {
         newStats[cat] = {
             totalMBps: 0, percentageMBps: 0, changeMBps: 0,
             totalPPS: 0, changePPS: 0, avgLatency: 0, changeLatency: 0,
             avgJitter: 0, changeJitter: 0, totalFlows: 0, changeFlows: 0
         };
         return;
      }

      const latestPoint = rawData[latestIdx];
      const prevPoint = findPrevValidPoint(`${cat}_mbps`, latestIdx) || latestPoint;

      const curMBps = (latestPoint[`${cat}_mbps`] as number) || 0;
      const prvMBps = (prevPoint[`${cat}_mbps`] as number) || 0;

      newStats[cat] = {
        totalMBps: curMBps,
        percentageMBps: totalAllMBps > 0 ? (curMBps / totalAllMBps) * 100 : 0,
        changeMBps: curMBps - prvMBps,
        totalPPS: (latestPoint[`${cat}_pps`] as number) || 0,
        changePPS: ((latestPoint[`${cat}_pps`] as number) || 0) - ((prevPoint[`${cat}_pps`] as number) || 0),
        avgLatency: (latestPoint[`${cat}_latency`] as number) || 0,
        changeLatency: ((latestPoint[`${cat}_latency`] as number) || 0) - ((prevPoint[`${cat}_latency`] as number) || 0),
        avgJitter: (latestPoint[`${cat}_jitter`] as number) || 0,
        changeJitter: ((latestPoint[`${cat}_jitter`] as number) || 0) - ((prevPoint[`${cat}_jitter`] as number) || 0),
        totalFlows: (latestPoint[`${cat}_flows`] as number) || 0,
        changeFlows: ((latestPoint[`${cat}_flows`] as number) || 0) - ((prevPoint[`${cat}_flows`] as number) || 0),
      };
    });

    setCardStats(newStats);

  }, [rawData, availableCategories, chartMetric]);

  // --- INTERVAL ---
  useEffect(() => {
    fetchData();
    // [REAL-TIME] Refresh setiap 3 Detik
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  // --- FETCH FILTER ---
  useEffect(() => {
    fetch('/api/filter-options')
      .then(res => res.json())
      .then(data => setAvailableCategories(data.categories || []));
  }, []);

  return (
    <AppLayout breadcrumbs={breadcrumbs}>
      <Head title="Real-Time Dashboard" />
      <div className="flex h-full flex-1 flex-col gap-4 overflow-x-auto rounded-xl p-4">

        {/* CARDS */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Object.entries(cardStats).map(([cat, stats]) => (
            <Fragment key={cat}>
              <div className="rounded-xl border border-sidebar-border/70 dark:border-sidebar-border bg-white dark:bg-neutral-900 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 capitalize">{cat} Throughput</h3>
                    <span className="text-xl font-bold text-black dark:text-white">{stats.totalMBps.toFixed(2)} Mbps</span>
                    <span className={`text-sm font-medium ${stats.changeMBps >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {stats.changeMBps >= 0 ? '▲' : '▼'} {stats.changeMBps.toFixed(2)}
                    </span>
                  </div>
                  <CircularProgress percentage={stats.percentageMBps} />
                </div>
              </div>
              <SimpleStatCard title={`${cat} PPS`} value={stats.totalPPS.toFixed(0)} unit="PPS" change={stats.changePPS} changeUnit="" />
              <SimpleStatCard title={`${cat} Latency`} value={stats.avgLatency.toFixed(1)} unit="ms" change={stats.changeLatency} changeUnit="ms" />
              <SimpleStatCard title={`${cat} Jitter`} value={stats.avgJitter.toFixed(2)} unit="ms" change={stats.changeJitter} changeUnit="ms" />
              <SimpleStatCard title={`${cat} Flows`} value={stats.totalFlows.toFixed(0)} unit="" change={stats.changeFlows} changeUnit="" />
            </Fragment>
          ))}
        </div>

        {/* CHART CONTROL */}
        <div className="rounded-xl border p-4 bg-white dark:bg-neutral-900">
          <select
            value={chartMetric}
            onChange={(e) => setChartMetric(e.target.value as any)}
            className="rounded border p-2 bg-white dark:bg-neutral-800"
          >
            <option value="throughput">Throughput (Mbps)</option>
            <option value="pps">Packet Rate (PPS)</option>
            <option value="latency">Latency (ms)</option>
            <option value="jitter">Jitter (ms)</option>
          </select>
        </div>

        {/* CHART */}
        <div className="h-[400px] w-full rounded-xl border p-4 bg-white dark:bg-neutral-900">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend verticalAlign="top" />
              {chartKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={getColor(i)}
                  strokeWidth={2}
                  dot={false} // Realtime biasanya tanpa dot biar rapi
                  connectNulls={true}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppLayout>
  );
}
