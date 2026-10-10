<?php

declare(strict_types=1);

use function BeyndaCalculator\Admin\adminAuth;
use function BeyndaCalculator\Admin\applySecurityHeaders;
use function BeyndaCalculator\Config\loadConfig;
use function BeyndaCalculator\Config\publicConfig;

require_once __DIR__ . '/bootstrap.php';

BeyndaCalculator\Admin\AdminAuth::startSession();
applySecurityHeaders();
$auth = adminAuth();
if (!$auth->isAuthenticated()) {
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'AUTH_REQUIRED']);
    exit;
}

try {
    $json = json_encode(publicConfig(loadConfig()), JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="calculator-config-' . gmdate('Ymd-His') . '.json"');
    echo $json . PHP_EOL;
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'CONFIG_UNAVAILABLE']);
}
