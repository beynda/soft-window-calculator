<?php

declare(strict_types=1);

use BeyndaCalculator\QuoteApi\IdempotencyStore;
use BeyndaCalculator\QuoteApi\RateLimiter;

require_once dirname(__DIR__, 3) . '/server/api/bootstrap.php';

[$script, $mode, $path, $value] = $argv + [null, null, null, null];
if ($mode === 'rate') {
    echo (new RateLimiter($path, 'parallel-ip-hash-salt', 5, 600))->reserve('198.51.100.7') ? 'reserved' : 'blocked';
    exit;
}
if ($mode === 'claim') {
    $result = (new IdempotencyStore($path, 'parallel-claim-salt'))->claim($value, 'shared-project-fingerprint');
    echo $result['status'];
    exit;
}
fwrite(STDERR, "unknown mode\n");
exit(2);
