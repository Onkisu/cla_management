<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Carbon\Carbon;

class ForecastController extends Controller
{
    public function index()
    {
        return Inertia::render('forecast');
    }

    public function getForecastData()
    {
        $data = [];
        $now = Carbon::now();

        // Variabel untuk menghitung rata-rata (Mean)
        $totalInference = 0;
        $totalConvergence = 0;
        $rerouteCount = 0;

        for ($i = 0; $i < 30; $i++) {
            $time = $now->copy()->subSeconds((30 - $i) * 5)->format('H:i:s');

            // 1. Traffic Logic
            $baseTraffic = 500 + (200 * sin($i / 5));
            if ($i > 20) $baseTraffic += ($i - 20) * 50;

            $actual = $baseTraffic + rand(-20, 20);
            $prediction = $baseTraffic + rand(-10, 50);

            // 2. QoS Metrics
            $delay = 20 + ($actual / 1000 * 80) + rand(-5, 5);
            $jitter = 2 + ($actual / 1000 * 10) + rand(-1, 2);
            $loss = ($actual > 1000) ? rand(0, 20) / 100 : 0;

            // 3. Status Logic
            $status = 'NORMAL';
            if ($prediction > 900) $status = 'WARNING';
            if ($prediction > 1100) $status = 'CRITICAL (REROUTE)';

            // 4. METRICS CALCULATION (MTTD & MTTR Components)

            // Detection Time (Inference + Latency)
            $inferenceTime = rand(15, 45);
            $controllerLatency = rand(3, 9);
            $detectionTime = $inferenceTime + $controllerLatency; // Total waktu deteksi

            // Recovery Time (Convergence) - Hanya ada nilainya jika terjadi Reroute
            $convergenceTime = 0;
            if ($status == 'CRITICAL (REROUTE)') {
                $convergenceTime = rand(120, 350); // ms
                $totalConvergence += $convergenceTime;
                $rerouteCount++;
            }

            $totalInference += $detectionTime;

            $data[] = [
                'id' => $i + 1,
                'run_time' => $time,
                'actual_mbps' => round($actual, 2),
                'predicted_mbps' => round($prediction, 2),
                'delay_ms' => round($delay, 1),
                'jitter_ms' => round($jitter, 2),
                'packet_loss' => $loss,
                'status' => $status,
                // Raw metrics per second
                'detection_time' => $detectionTime,
                'convergence_time' => $convergenceTime,
                'mape' => rand(2, 8)
            ];
        }

        // HITUNG MEAN (Rata-rata)
        $mttd = round($totalInference / 30, 2); // Mean Time To Detect (Avg of all detections)

        // Mean Time To Recovery (Avg of convergence times when reroute happened)
        // Jika belum ada reroute, kasih nilai default dummy kecil agar tidak 0/error
        $mttr = $rerouteCount > 0 ? round($totalConvergence / $rerouteCount, 2) : 0;

        return response()->json([
            'data' => $data,
            'latest_status' => end($data),
            'system_metrics' => [
                'mttd' => $mttd,
                'mttr' => $mttr,
                'reroute_count' => $rerouteCount
            ]
        ]);
    }

    public function storeIntent(Request $request)
    {
        return response()->json(['message' => 'Intent Simulated', 'count' => 1]);
    }
}
