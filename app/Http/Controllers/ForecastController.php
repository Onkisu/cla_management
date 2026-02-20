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
        return Carbon::parse($timestamp)
            ->setTimezone('Asia/Jakarta');
    }

    public function getForecastData(Request $request)
    {

        $range = $request->query('range', '1h');

        $rangeMap = [
            '10s' => [Carbon::now()->subSeconds(10), '1 second'],
            '1m'  => [Carbon::now()->subMinute(),  '10 seconds'],
            '5m'  => [Carbon::now()->subMinutes(5),  '10 seconds'],
            '15m' => [Carbon::now()->subMinutes(15), '1 minute'],
            '30m' => [Carbon::now()->subMinutes(30), '1 minute'],
            '1h'  => [Carbon::now()->subHour(),      '10 seconds'],
        ];

        [$fromTime, $groupInterval] = $rangeMap[$range] ?? $rangeMap['1h'];
        // 1. Get Latest Predicted Load (t+1)
        $latestPrediction = DB::table('forecast_1h')
            ->selectRaw('y_pred / 100000 as y_pred, ts')  // ← Bagi 1000
            ->orderBy('ts', 'desc')
            ->first();

        if ($latestPrediction) {
            $latestPrediction->ts = Carbon::parse($latestPrediction->ts)
                ->setTimezone('Asia/Jakarta')
                ->format('Y-m-d H:i:s');
        }

        // 2. Get Latest QoS Metrics (Delay, Jitter, Loss)
        $latestQoS = DB::table('traffic.itg_session_results')
            ->select('avg_delay_ms', 'avg_jitter_ms', 'loss_percent')
            ->orderBy('id', 'desc')
            ->first();

        // 2a. Get System Events (Automation Logs) - Last 50 events
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
            f.ts as prediction_ts,
            EXTRACT(EPOCH FROM (se.timestamp - f.ts)) * 1000 as time_diff_ms
        FROM traffic.system_events se
        LEFT JOIN LATERAL (
            SELECT ts
            FROM forecast_1h
            WHERE ts <= se.timestamp
            ORDER BY ts DESC
            LIMIT 1
        ) f ON true
        WHERE se.event_type = 'REROUTE'
        AND se.timestamp >= NOW() - INTERVAL '1 hour'
        ORDER BY se.timestamp DESC
    ");



        // 3. Get Chart Data - Actual Traffic (Last 1 hour, 10-second intervals)
        $actualTraffic = DB::select("
            WITH x AS (
                SELECT
                    date_trunc('second', timestamp) AS detik,
                    dpid,
                    sum(bytes_tx) AS total_bytes
                FROM traffic.flow_stats_
                WHERE timestamp >= NOW() - INTERVAL '1 hour'
                GROUP BY detik, dpid
            ),
            ten_sec_intervals AS (
                SELECT
                    date_trunc('second', detik - (EXTRACT(SECOND FROM detik)::int % 10) * INTERVAL '1 second') AS interval_ts,
                    dpid,
                    SUM(total_bytes) AS total_bytes
                FROM x
                GROUP BY interval_ts, dpid
            )
            SELECT
                interval_ts AS ts,
                MAX(CASE WHEN dpid = 5 THEN total_bytes * 8 / 10000000 END) AS actual_mbps
            FROM ten_sec_intervals
            GROUP BY interval_ts
            ORDER BY ts ASC
        ");

        // 4. Get Predicted Traffic (Last 1 hour)
        $predictedTraffic = DB::table('forecast_1h')
            ->selectRaw('ts, y_pred / 1000000 as predicted_mbps')  // ← Bagi 1000
            ->where('ts', '>=', $fromTime)
            ->orderBy('ts', 'asc')
            ->get();

        // 5. Merge Actual and Predicted Data with 10-second interval matching
        $chartData = [];
        $predictedMap = [];

        // Build predicted map with rounded 10-second keys
        foreach ($predictedTraffic as $pred) {
            $timestamp = Carbon::parse($pred->ts)->setTimezone('Asia/Jakarta');
            // Round to nearest 10 seconds: 19:28:42 → 19:28:40
            $roundedSecond = floor($timestamp->second / 10) * 10;
            $key = $timestamp->format('Y-m-d H:i:') . str_pad($roundedSecond, 2, '0', STR_PAD_LEFT);

            $predictedMap[$key] = $pred->predicted_mbps;
        }

        foreach ($actualTraffic as $actual) {
            $timestamp = Carbon::parse($actual->ts)->setTimezone('Asia/Jakarta');
            // Round to nearest 10 seconds to match with predicted
            $roundedSecond = floor($timestamp->second / 10) * 10;
            $key = $timestamp->format('Y-m-d H:i:') . str_pad($roundedSecond, 2, '0', STR_PAD_LEFT);

            $chartData[] = [
                'id' => count($chartData) + 1,
                'run_time' => $timestamp->format('H:i:s'),
                'actual_mbps' => round($actual->actual_mbps ?? 0, 2),
                'predicted_mbps' => round($predictedMap[$key] ?? 0, 2),
                'delay_ms' => round($latestQoS->avg_delay_ms ?? 0, 1),
                'jitter_ms' => round($latestQoS->avg_jitter_ms ?? 0, 2),
                'packet_loss' => round($latestQoS->loss_percent ?? 0, 2),
                'status' => $this->determineStatus($predictedMap[$key] ?? 0, $latestQoS),
                'mape' => rand(2, 8), // Placeholder - bisa diganti dengan nilai real jika ada
                'detection_time' => rand(20, 50),
                'convergence_time' => 0
            ];
        }

        // 6. Calculate System Metrics (TTR)
        $systemMetrics = $this->calculateSystemMetrics($rerouteEvents);

        // 6a. Calculate Model Performance Metrics (MAPE & RMSE)
        $modelMetrics = $this->calculateModelMetrics($chartData);

        // 7. Get Latest Status
        $latestStatus = end($chartData);

        return response()->json([
            'data' => $chartData,
            'system_events' => $systemEvents,
            'latest_status' => $latestStatus ?: [
                'predicted_mbps' => $latestPrediction->y_pred ?? 0,
                'delay_ms' => $latestQoS->avg_delay_ms ?? 0,
                'jitter_ms' => $latestQoS->avg_jitter_ms ?? 0,
                'packet_loss' => $latestQoS->loss_percent ?? 0,
                'status' => 'NORMAL',
                'mape' => 0
            ],
            'system_metrics' => $systemMetrics,
            'model_metrics' => $modelMetrics
        ]);
    }

    private function determineStatus($predictedMbps, $qos)
    {
        $status = 'NORMAL';

        // Check traffic threshold
        if ($predictedMbps > 900) {
            $status = 'WARNING';
        }
        if ($predictedMbps > 1100) {
            $status = 'CRITICAL (REROUTE)';
        }

        // Check QoS violations
        if ($qos) {
            if ($qos->avg_delay_ms > 150 || $qos->loss_percent > 1) {
                $status = ($status == 'NORMAL') ? 'WARNING' : 'CRITICAL (REROUTE)';
            }
        }

        return $status;
    }

   private function calculateSystemMetrics($rerouteEvents)
    {
        $totalTimeDiff = 0;
        $rerouteCount = count($rerouteEvents);

        foreach ($rerouteEvents as $event) {
            $totalTimeDiff += $event->time_diff_ms ?? 0;
        }

        $mttr = $rerouteCount > 0 ? round($totalTimeDiff / $rerouteCount, 2) : 0;

        return [
            'mttd' => 0, // bisa diisi nanti kalau ada logic MTTD
            'mttr' => $mttr,
            'reroute_count' => $rerouteCount
        ];
    }

    private function calculateModelMetrics($data)
    {
        $totalMape = 0;
        $totalSquaredError = 0;
        $validCount = 0;

        foreach ($data as $row) {
            $actual = $row['actual_mbps'];
            $predicted = $row['predicted_mbps'];

            // Skip jika actual = 0 atau null (avoid division by zero)
            if ($actual > 0 && $predicted > 0) {
                // MAPE: |actual - predicted| / actual * 100
                $mape = abs($actual - $predicted) / $actual * 100;
                $totalMape += $mape;

                // RMSE: (actual - predicted)^2
                $squaredError = pow($actual - $predicted, 2);
                $totalSquaredError += $squaredError;

                $validCount++;
            }
        }

        $avgMape = $validCount > 0 ? round($totalMape / $validCount, 2) : 0;
        $rmse = $validCount > 0 ? round(sqrt($totalSquaredError / $validCount), 2) : 0;

        return [
            'mape' => $avgMape,
            'rmse' => $rmse
        ];
    }

    public function storeIntent(Request $request)
    {
        return response()->json(['message' => 'Intent Simulated', 'count' => 1]);
    }
}

