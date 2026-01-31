<?php

use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Fortify\Features;
use App\Http\Controllers\ForecastController;
use Illuminate\Support\Facades\DB;


Route::get('/', function () {
    return Inertia::render('welcome', [
        'canRegister' => Features::enabled(Features::registration()),
    ]);
})->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', function () {
        return Inertia::render('dashboard');
    })->name('dashboard');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('forecast', function () {
        return Inertia::render('forecast');
    })->name('forecast');
});

Route::get('/flowstats', function () {
    $data = DB::table('traffic.flow_stats')
        ->select('timestamp', 'bytes_tx')
        ->orderBy('timestamp')
        ->limit(50)
        ->get();

    return response()->json($data);
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::post('api/forecast/generate-intent', [ForecastController::class, 'storeIntent'])->name('forecast.storeIntent');
});

// Route::get('/forecast', [ForecastController::class, 'index'])->name('forecast.index');

Route::post('/forecast/intent', [ForecastController::class, 'storeIntent'])->name('forecast.intent');




require __DIR__.'/settings.php';
