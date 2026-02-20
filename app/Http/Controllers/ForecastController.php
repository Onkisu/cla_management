<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;


class ForecastController extends Controller
{
    public function index()
    {
        return Inertia::render('forecast');
    }

    private function toWIB($timestamp)
    {
        return Carbon::parse($timestamp)->setTimezone('Asia/Jakarta');
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

    public function getForecastData(Request $request)
    {
        $range    = $request->query('range', '1h');
        $fromTime = $this->resolveTimeRange($range);

        // 1. Latest Predicted Load — pakai ts_created, satuan konsisten /1000000
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

        // Reroute events — pakai ts_created bukan ts
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

        // 3. Actual Traffic — per detik, filter bytes_tx > 0
        $fromTimeStr = $fromTime->toDateTimeString();

        $actualTraffic = DB::select("
            WITH x AS (
                SELECT
                    date_trunc('second', timestamp) AS detik,
                    dpid,
                    MAX(bytes_tx) AS total_bytes
                FROM traffic.flow_stats_
                WHERE timestamp >= ?
                  AND bytes_tx > 0
                GROUP BY detik, dpid
            )
            SELECT
                detik                        AS ts,
                total_bytes * 8 / 1000000.0  AS actual_mbps
            FROM x
            WHERE dpid = 5
            ORDER BY ts ASC
        ", [$fromTimeStr]);

        // 4. Predicted Traffic — pakai ts_created sebagai sumbu waktu
        $predictedTraffic = DB::table('forecast_1h')
            ->selectRaw('ts_created as ts, y_pred / 1000000.0 as predicted_mbps')
            ->where('ts_created', '>=', $fromTime)
            ->orderBy('ts_created', 'asc')
            ->get();

        // 5. Build predictedMap per detik (key = "Y-m-d H:i:s")
        //    Simpan nilai tertinggi jika ada duplikat di detik yang sama
        $predictedMap = [];
        foreach ($predictedTraffic as $pred) {
            $key = Carbon::parse($pred->ts)
                ->setTimezone('Asia/Jakarta')
                ->format('Y-m-d H:i:s');
            if (!isset($predictedMap[$key]) || $pred->predicted_mbps > $predictedMap[$key]) {
                $predictedMap[$key] = (float) $pred->predicted_mbps;
            }
        }

        // 6. Merge Actual & Predicted
        $chartData        = [];
        $lastValidPredMbps = null; // ← FIX: track nilai prediksi terakhir yang valid

        foreach ($actualTraffic as $actual) {
            $timestamp = Carbon::parse($actual->ts)->setTimezone('Asia/Jakarta');
            $key       = $timestamp->format('Y-m-d H:i:s');

            // Cari predicted: exact detik dulu, fallback ±2 detik
            $predMbps = $predictedMap[$key] ?? null;

            if ($predMbps === null) {
                for ($offset = 1; $offset <= 2; $offset++) {
                    $kPlus  = $timestamp->copy()->addSeconds($offset)->format('Y-m-d H:i:s');
                    $kMinus = $timestamp->copy()->subSeconds($offset)->format('Y-m-d H:i:s');
                    if (isset($predictedMap[$kPlus]))  { $predMbps = $predictedMap[$kPlus];  break; }
                    if (isset($predictedMap[$kMinus])) { $predMbps = $predictedMap[$kMinus]; break; }
                }
            }

            // FIX: Kalau masih null setelah ±2 detik fallback,
            // pakai nilai prediksi terakhir yang valid (forward fill)
            // Ini mencegah prediksi muncul sebagai 0 di chart
            // ketika ada gap insert dari forecast_2.py
            if ($predMbps === null) {
                $predMbps = $lastValidPredMbps; // bisa null kalau belum ada sama sekali
            }

            // Update last valid hanya kalau ada nilai dan nilainya > 0
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
