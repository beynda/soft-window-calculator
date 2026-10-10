<?php

declare(strict_types=1);

use BeyndaCalculator\Admin\AdminAuth;
use BeyndaCalculator\Admin\LoginRateLimiter;
use BeyndaCalculator\Config\ConfigStore;
use BeyndaCalculator\Config\ConfigValidationException;
use function BeyndaCalculator\Config\publicConfig;

require_once __DIR__ . '/../../../server/admin/bootstrap.php';

function ensure(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$temporary = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'beynda-config-' . bin2hex(random_bytes(8));
ensure(mkdir($temporary, 0700), 'temporary directory was not created');

try {
    $fixturePath = __DIR__ . '/../../../storage/config.json';
    ensure(copy($fixturePath, $temporary . '/config.json'), 'fixture was not copied');
    $store = new ConfigStore($temporary);
    $initial = $store->loadConfig();
    ensure($initial['tariffs']['materials']['clear-pvc-700'] > 0, 'fixture tariff mismatch');
    $initialTariff = $initial['tariffs']['materials']['clear-pvc-700'];
    ensure($initial['ranges']['dimensions']['max'] === 1500, 'maximum dimension mismatch');
    ensure(!in_array('weight-bar', $initial['availableOptions']['hardware'], true), 'weight bar must not be selectable hardware');
    ensure($initial['companyAddress'] === '', 'company address placeholder mismatch');

    $invalid = $initial;
    $invalid['tariffs']['border']['perMeter'] = -1;
    $before = file_get_contents($temporary . '/config.json');
    try {
        $store->saveConfig($invalid);
        throw new RuntimeException('invalid configuration was accepted');
    } catch (ConfigValidationException) {
        ensure(file_get_contents($temporary . '/config.json') === $before, 'invalid save changed active config');
    }
    foreach ([
        ['companyAddress' => ['not-a-string']],
        ['recipientEmail' => 'quotes@example.invalid'],
    ] as $forbiddenChange) {
        try {
            $store->saveConfig(array_replace($initial, $forbiddenChange));
            throw new RuntimeException('forbidden configuration was accepted');
        } catch (ConfigValidationException) {
            ensure(file_get_contents($temporary . '/config.json') === $before, 'forbidden save changed active config');
        }
    }

    $valid = $initial;
    $valid['tariffs']['materials']['clear-pvc-700'] = 1250;
    $valid['companyAddress'] = 'Sample address';
    $saved = $store->saveConfig($valid);
    ensure($saved['tariffs']['materials']['clear-pvc-700'] === 1250, 'valid tariff was not saved');
    ensure(is_string($saved['savedAt']), 'savedAt was not recorded');
    ensure($saved['companyAddress'] === 'Sample address', 'company address was not saved');
    $backup = json_decode((string) file_get_contents($temporary . '/config.backup.json'), true, 64, JSON_THROW_ON_ERROR);
    ensure($backup['tariffs']['materials']['clear-pvc-700'] === $initialTariff, 'backup is not the previous valid config');

    $logPath = $temporary . '/diagnostics.log';
    ini_set('log_errors', '1');
    ini_set('error_log', $logPath);
    file_put_contents($temporary . '/config.json', '{broken-json');
    $recovered = $store->loadConfig();
    ensure($recovered['tariffs']['materials']['clear-pvc-700'] === $initialTariff, 'backup recovery failed');
    $log = (string) file_get_contents($logPath);
    ensure(str_contains($log, 'config_recovered_from_backup'), 'recovery diagnostic missing');
    ensure(!str_contains($log, 'broken-json'), 'diagnostic leaked file contents');

    $privateConfig = $initial + ['password' => 'not-a-real-secret'];
    $privateConfig['texts']['internalNote'] = 'private';
    $projected = publicConfig($privateConfig);
    ensure(!array_key_exists('password', $projected), 'public projection exposed private field');
    ensure(!array_key_exists('internalNote', $projected['texts']), 'public projection exposed nested private field');
    ensure(array_key_exists('companyAddress', $projected), 'public projection omitted company address');

    $limitPath = $temporary . '/attempts.json';
    $limiter = new LoginRateLimiter($limitPath, 'test-salt');
    for ($attempt = 0; $attempt < LoginRateLimiter::MAX_ATTEMPTS; $attempt++) {
        ensure($limiter->reserveAttempt('192.0.2.10'), 'valid attempt reservation failed');
    }
    ensure(!$limiter->reserveAttempt('192.0.2.10'), 'login limiter did not block');
    ensure(!str_contains((string) file_get_contents($limitPath), '192.0.2.10'), 'login limiter stored raw identifier');

    session_save_path($temporary);
    AdminAuth::startSession();
    $auth = new AdminAuth(new LoginRateLimiter($temporary . '/auth-attempts.json', 'test-salt'));
    $csrf = $auth->csrfToken();
    $auth->assertCsrf($csrf);
    try {
        $auth->assertCsrf('wrong-token');
        throw new RuntimeException('invalid CSRF token was accepted');
    } catch (RuntimeException $error) {
        ensure($error->getMessage() === 'Invalid CSRF-token.', 'unexpected CSRF failure');
    }
    putenv('ADMIN_PASSWORD_HASH=' . password_hash('local-test-password', PASSWORD_DEFAULT));
    ensure($auth->login('local-test-password', '198.51.100.20'), 'password_hash login failed');
    ensure($auth->isAuthenticated(), 'authenticated session flag missing');
    putenv('ADMIN_PASSWORD_HASH');

    echo "PHP_SMOKE_OK\n";
} finally {
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    foreach (glob($temporary . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
        if (is_file($file)) {
            unlink($file);
        }
    }
    rmdir($temporary);
}
