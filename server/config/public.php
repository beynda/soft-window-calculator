<?php

declare(strict_types=1);

use function BeyndaCalculator\Config\loadConfig;
use function BeyndaCalculator\Config\publicConfig;

require_once __DIR__ . '/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('X-Frame-Options: DENY');

try {
    echo json_encode(publicConfig(loadConfig()), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable) {
    http_response_code(503);
    echo json_encode(['error' => 'CONFIG_UNAVAILABLE'], JSON_UNESCAPED_UNICODE);
}
