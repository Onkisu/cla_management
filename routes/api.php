<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
// [MODIFIKASI] Gunakan KpiController baru
use App\Http\Controllers\FlowStatsController;
use App\Http\Controllers\ForecastController;


// default test route
Route::get('/test', function () {
    return response()->json(['message' => 'API route working']);
});

// [MODIFIKASI] Endpoint lama '/flowstats' sekarang diganti dengan ini
Route::get('/kpi/stats-by-category', [FlowStatsController::class, 'getStatsByCategory']);

// [MODIFIKASI] Endpoint filter tetap, tapi ganti controller
Route::get('/filter-options', [FlowStatsController::class, 'getFilterOptions']);


Route::get('/forecast/data', [ForecastController::class, 'getForecastData']);
