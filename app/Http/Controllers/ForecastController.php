<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;


class ForecastController extends Controller
{
    // Resolusi bucket dalam detik — harus sama antara actual & predicted
    // Sesuaikan dengan LOOP_INTERVAL_SEC di forecast_2.py (saat ini 5 detik)
    const BUCKET_SEC = 5;

    public function index()
    {
        return Inertia::render('forecast');
    }

    private function resolveTimeRange(string $range): Carbon
    {
        return match ($range) {
            '10s' => Carbon::now()->subSeconds(10),
            '1m'  => Carbon::now()->subMinute(),
            '5m'  => Carbon::now()->subMinutes(5),
            '15m' => Carbon::now()->subMinutes(15),
            '30m' => Carbon::now()->subMinutes(30),
            default => Carbon::now()->subHour(),
        };
    }

    /**
     * Buat bucket key dengan resolusi BUCKET_SEC detik.
     * Contoh BUCKET_SEC=5: detik 0,1,2,3,4 → "14:22:00", detik 5,6,7,8,9 → "14:22:05"
     */
    private function bucketKey(Carbon $ts): string
    {
        $bucket = floor($ts->second / self::BUCKET_SEC) * self::BUCKET_SEC;
        return $ts->format('Y-m-d H:i:') . str_pad($bucket, 2, '0', STR_PAD_LEFT);
    }

    public function getForecastData(Request $request)
    {
        $range    = $request->query('range', '1h');
        $fromTime = $this->resolveTimeRange($range);

        // 1. Latest Predicted Load
        $latestPrediction = DB::table('forecast_1h')
            ->selectRaw('y_pred / 1000000.0 as y_pred, ts_created as ts')
            ->orderBy('ts_created', 'desc')
            ->first();

        if ($latestPrediction) {
            $latestPrediction->ts = Carbon::parse($latestPrediction->ts)
                ->setTimezone('Asia/Jakarta')
                ->format('Y-m-d H:i:s');
        }

        // 2. Latest QoS Metrics
        $latestQoS = DB::table('traffic.itg_session_results')
            ->select('avg_delay_ms', 'avg_jitter_ms', 'loss_percent')
            ->orderBy('id', 'desc')
            ->first();

        // 2a. System Events
        $systemEvents = DB::table('traffic.system_events')
            ->select('id', 'timestamp', 'event_type', 'description', 'trigger_value')
            ->orderBy('timestamp', 'desc')
            ->limit(50)
            ->get()
            ->map(function ($event) {
                $event->timestamp = Carbon::parse($event->timestamp)
                    ->setTimezone('Asia/Jakarta')
                    ->format('Y-m-d H:i:s');
                return $event;
            });

        $rerouteEvents = DB::select("
            SELECT
                se.timestamp as event_ts,
                f.ts_created as prediction_ts,
                EXTRACT(EPOCH FROM (se.timestamp - f.ts_created)) * 1000 as time_diff_ms
            FROM traffic.system_events se
            LEFT JOIN LATERAL (
                SELECT ts_created
                FROM forecast_1h
                WHERE ts_created <= se.timestamp
                ORDER BY ts_created DESC
                LIMIT 1
            ) f ON true
            WHERE se.event_type = 'REROUTE'
            AND se.timestamp >= NOW() - INTERVAL '1 hour'
            ORDER BY se.timestamp DESC
        ");

        // 3. Actual Traffic — aggregate ke bucket BUCKET_SEC detik
        //    SUM bytes dalam satu bucket → total throughput per interval
        $fromTimeStr = $fromTime->toDateTimeString();
        $bucketSec   = self::BUCKET_SEC;

        $actualTraffic = DB::select("
            WITH per_second AS (
                SELECT
                    date_trunc('second', timestamp)  AS detik,
                    MAX(bytes_tx)                    AS total_bytes
                FROM traffic.flow_stats_
                WHERE timestamp >= ?
                  AND dpid = 5
                  AND bytes_tx > 0
                GROUP BY detik
            ),
            bucketed AS (
                SELECT
                    date_trunc('second',
                        detik - ((EXTRACT(SECOND FROM detik)::int % ?) * INTERVAL '1 second')
                    ) AS bucket_ts,
                    SUM(total_bytes) AS bucket_bytes
                FROM per_second
                GROUP BY bucket_ts
            )
            SELECT
                bucket_ts                              AS ts,
                bucket_bytes * 8 / 1000000.0 / ?      AS actual_mbps
            FROM bucketed
            ORDER BY ts ASC
        ", [$fromTimeStr, $bucketSec, $bucketSec]);
        // ÷ BUCKET_SEC untuk dapat rata-rata Mbps per detik dalam bucket

        // 4. Predicted Traffic — pakai ts_created sebagai sumbu waktu
        $predictedTraffic = DB::table('forecast_1h')
            ->selectRaw('ts_created as ts, y_pred / 1000000.0 as predicted_mbps')
            ->where('ts_created', '>=', $fromTime)
            ->orderBy('ts_created', 'asc')
            ->get();

        // 5. Build predictedMap — bucket ke BUCKET_SEC detik, ambil rata-rata per bucket
        //    (karena forecast_2.py insert tiap 5s, dalam 1 bucket idealnya 1 baris)
        $predictedBuckets = []; // key => [sum, count]
        foreach ($predictedTraffic as $pred) {
            $ts  = Carbon::parse($pred->ts)->setTimezone('Asia/Jakarta');
            $key = $this->bucketKey($ts);
            if (!isset($predictedBuckets[$key])) {
                $predictedBuckets[$key] = ['sum' => 0, 'count' => 0];
            }
            $predictedBuckets[$key]['sum']   += (float) $pred->predicted_mbps;
            $predictedBuckets[$key]['count'] += 1;
        }

        $predictedMap = [];
        foreach ($predictedBuckets as $key => $val) {
            $predictedMap[$key] = $val['sum'] / $val['count']; // rata-rata per bucket
        }

        // 6. Merge Actual & Predicted
        $chartData         = [];
        $lastValidPredMbps = null; // forward-fill untuk gap

        foreach ($actualTraffic as $actual) {
            $timestamp = Carbon::parse($actual->ts)->setTimezone('Asia/Jakarta');
            $key       = $this->bucketKey($timestamp);

            $predMbps = $predictedMap[$key] ?? null;

            // Fallback: cari bucket ±1 (±BUCKET_SEC detik)
            if ($predMbps === null) {
                $keyNext = $this->bucketKey($timestamp->copy()->addSeconds(self::BUCKET_SEC));
                $keyPrev = $this->bucketKey($timestamp->copy()->subSeconds(self::BUCKET_SEC));
                $predMbps = $predictedMap[$keyNext] ?? $predictedMap[$keyPrev] ?? null;
            }

            // Forward-fill: pakai nilai terakhir yang valid kalau masih null
            if ($predMbps === null) {
                $predMbps = $lastValidPredMbps;
            }

            // Update last valid
            if ($predMbps !== null && $predMbps > 0) {
                $lastValidPredMbps = $predMbps;
            }

            $chartData[] = [
                'id'               => count($chartData) + 1,
                'run_time'         => $timestamp->format('H:i:s'),
                'actual_mbps'      => round((float)($actual->actual_mbps ?? 0), 3),
                'predicted_mbps'   => round((float)($predMbps ?? 0), 3),
                'delay_ms'         => round($latestQoS->avg_delay_ms ?? 0, 1),
                'jitter_ms'        => round($latestQoS->avg_jitter_ms ?? 0, 2),
                'packet_loss'      => round($latestQoS->loss_percent ?? 0, 2),
                'status'           => $this->determineStatus($predMbps ?? 0, $latestQoS),
                'mape'             => 0,
                'detection_time'   => 0,
                'convergence_time' => 0,
            ];
        }

        $systemMetrics = $this->calculateSystemMetrics($rerouteEvents);
        $modelMetrics  = $this->calculateModelMetrics($chartData);
        $latestStatus  = end($chartData);

        return response()->json([
            'data'           => $chartData,
            'system_events'  => $systemEvents,
            'latest_status'  => $latestStatus ?: [
                'predicted_mbps' => $latestPrediction->y_pred ?? 0,
                'delay_ms'       => $latestQoS->avg_delay_ms ?? 0,
                'jitter_ms'      => $latestQoS->avg_jitter_ms ?? 0,
                'packet_loss'    => $latestQoS->loss_percent ?? 0,
                'status'         => 'NORMAL',
                'mape'           => 0,
            ],
            'system_metrics' => $systemMetrics,
            'model_metrics'  => $modelMetrics,
        ]);
    }

    private function determineStatus($predictedMbps, $qos)
    {
        $status = 'NORMAL';
        if ($predictedMbps > 900)  $status = 'WARNING';
        if ($predictedMbps > 1100) $status = 'CRITICAL (REROUTE)';

        if ($qos) {
            if ($qos->avg_delay_ms > 150 || $qos->loss_percent > 1) {
                $status = ($status === 'NORMAL') ? 'WARNING' : 'CRITICAL (REROUTE)';
            }
        }
        return $status;
    }

    private function calculateSystemMetrics($rerouteEvents)
    {
        $totalTimeDiff = 0;
        $rerouteCount  = count($rerouteEvents);
        foreach ($rerouteEvents as $event) {
            $totalTimeDiff += $event->time_diff_ms ?? 0;
        }
        return [
            'mttd'          => 0,
            'mttr'          => $rerouteCount > 0 ? round($totalTimeDiff / $rerouteCount, 2) : 0,
            'reroute_count' => $rerouteCount,
        ];
    }

    private function calculateModelMetrics($data)
    {
        $totalMape         = 0;
        $totalSquaredError = 0;
        $validCount        = 0;

        foreach ($data as $row) {
            $actual    = $row['actual_mbps'];
            $predicted = $row['predicted_mbps'];
            if ($actual > 0 && $predicted > 0) {
                $totalMape         += abs($actual - $predicted) / $actual * 100;
                $totalSquaredError += pow($actual - $predicted, 2);
                $validCount++;
            }
        }

        return [
            'mape' => $validCount > 0 ? round($totalMape / $validCount, 2) : 0,
            'rmse' => $validCount > 0 ? round(sqrt($totalSquaredError / $validCount), 4) : 0,
        ];
    }

    public function storeIntent(Request $request)
    {
        return response()->json(['message' => 'Intent Simulated', 'count' => 1]);
    }
}
