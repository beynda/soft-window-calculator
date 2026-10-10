<?php

declare(strict_types=1);

use BeyndaCalculator\Admin\LoginRateLimiter;
use BeyndaCalculator\Config\ConfigStore;

require_once __DIR__ . '/../../../server/admin/bootstrap.php';

$operation = $argv[1] ?? '';
$directory = $argv[2] ?? '';
$value = $argv[3] ?? '';

if ($directory === '' || $value === '') {
    fwrite(STDERR, "missing worker arguments\n");
    exit(2);
}

if ($operation === 'config') {
    $store = new ConfigStore($directory);
    $config = $store->loadConfig();
    $config['texts']['intro'] = $value;
    $store->saveConfig($config);
    echo $value;
    exit(0);
}

if ($operation === 'limiter') {
    $limiter = new LoginRateLimiter($directory . '/attempts.json', 'test-salt');
    echo $limiter->reserveAttempt($value) ? 'reserved' : 'blocked';
    exit(0);
}

fwrite(STDERR, "unknown worker operation\n");
exit(2);
