<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FlowStatsController extends Controller
{
    // Interval koleksi data raw (5 detik)
    const COLLECT_INTERVAL = 5;

    public function getStatsByCategory(): JsonResponse
    {
        // 1. Ambil 2 Timestamp Terakhir dari tabel RAW
        $timestamps = DB::table('traffic.flow_stats')
            ->select('timestamp')
            ->distinct()
            ->orderBy('timestamp', 'desc')
            ->limit(2)
            ->pluck('timestamp');

        if ($timestamps->count() < 1) {
            return response()->json([]);
        }

        $ts_now = $timestamps[0];
        $ts_prev = $timestamps->count() > 1 ? $timestamps[1] : null;

        // Hitung Interval Aktual (Detik)
        $intervalSeconds = self::COLLECT_INTERVAL;
        if ($ts_prev) {
            $diff = strtotime($ts_now) - strtotime($ts_prev);
            if ($diff > 0) $intervalSeconds = $diff;
        }

        // 2. Query Data T_NOW
        $stats_now = DB::table('traffic.flow_stats')
            ->select('category',
                DB::raw('SUM(bytes_tx) as total_bytes_tx'),
                DB::raw('SUM(pkts_tx) as total_pkts_tx'),
                DB::raw('AVG(latency_ms) as avg_latency'),
                // Kolom jitter tidak ada di raw, jadi tidak di-query
                DB::raw('COUNT(id) as active_flows')
            )
            ->where('timestamp', $ts_now)
            ->whereNotNull('category')
            ->where('category', '!=', 'unknown')
            ->groupBy('category')
            ->get()
            ->keyBy('category');

        // 3. Query Data T_PREV (Penting untuk hitung Delta & Jitter)
        $stats_prev = collect();
        if ($ts_prev) {
            $stats_prev = DB::table('traffic.flow_stats')
                ->select('category',
                    DB::raw('SUM(bytes_tx) as total_bytes_tx'),
                    DB::raw('SUM(pkts_tx) as total_pkts_tx'),
                    DB::raw('AVG(latency_ms) as avg_latency') // Ambil latency lama
                )
                ->where('timestamp', $ts_prev)
                ->whereNotNull('category')
                ->where('category', '!=', 'unknown')
                ->groupBy('category')
                ->get()
                ->keyBy('category');
        }

        // 4. Susun Hasil
        $allCategories = $stats_now->keys()->merge($stats_prev->keys())->unique();
        $results = [];

        foreach ($allCategories as $category) {
            $now = $stats_now->get($category);

            // [ANTI 0] Jika data belum masuk, kirim NULL agar grafik putus (tidak drop ke 0)
            if (!$now) {
                $results[] = [
                    'timestamp' => $ts_now,
                    'category' => $category,
                    'throughput_bps' => null,
                    'pps_tx' => null,
                    'avg_latency_ms' => null,
                    'avg_jitter_ms' => null,
                    'active_flows' => null,
                ];
                continue;
            }

            // Data Prev (Default 0 atau samakan latency agar jitter 0 jika prev tidak ada)
            $prev = $stats_prev->get($category) ?? (object)[
                'total_bytes_tx' => 0,
                'total_pkts_tx' => 0,
                'avg_latency' => $now->avg_latency
            ];

            // 1. Hitung Throughput (Delta Bytes / Interval)
            $delta_bytes = $now->total_bytes_tx - $prev->total_bytes_tx;
            $delta_pkts = $now->total_pkts_tx - $prev->total_pkts_tx;

            // Fallback: Jika negatif (counter reset), pakai nilai raw
            if ($delta_bytes < 0) $delta_bytes = $now->total_bytes_tx;
            if ($delta_pkts < 0) $delta_pkts = $now->total_pkts_tx;

            $throughput_bps = $delta_bytes / $intervalSeconds;
            $pps_tx = $delta_pkts / $intervalSeconds;

            // 2. Hitung Jitter Manual
            // Rumus: | Latency Sekarang - Latency Sebelumnya |
            $latency_now = (float)$now->avg_latency;
            $latency_prev = (float)$prev->avg_latency;
            $jitter_manual = abs($latency_now - $latency_prev);

            $results[] = [
                'timestamp' => $ts_now,
                'category' => $category,
                'throughput_bps' => $throughput_bps,
                'pps_tx' => $pps_tx,
                'avg_latency_ms' => $latency_now,
                'avg_jitter_ms' => $jitter_manual, // <--- Hasil Hitungan
                'active_flows' => (int)$now->active_flows,
            ];
        }

        return response()->json(array_values($results));
    }

    public function getFilterOptions(): JsonResponse
    {
        $categories = DB::table('traffic.flow_stats')
            ->select('category')
            ->whereNotNull('category')
            ->where('category', '!=', 'unknown')
            ->distinct()
            ->pluck('category');

        return response()->json(['categories' => $categories]);
    }
}
