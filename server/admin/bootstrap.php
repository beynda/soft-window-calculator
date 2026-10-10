<?php

declare(strict_types=1);

namespace BeyndaCalculator\Admin;

require_once dirname(__DIR__) . '/config/bootstrap.php';
require_once __DIR__ . '/LoginRateLimiter.php';
require_once __DIR__ . '/AdminAuth.php';

function adminAuth(): AdminAuth
{
    static $auth;
    if ($auth instanceof AdminAuth) {
        return $auth;
    }
    $passwordHash = getenv('ADMIN_PASSWORD_HASH');
    $salt = is_string($passwordHash) && $passwordHash !== '' ? $passwordHash : 'admin-login-disabled';
    $configuredPath = getenv('ADMIN_RATE_LIMIT_PATH');
    $statePath = is_string($configuredPath) && $configuredPath !== ''
        ? $configuredPath
        : dirname(__DIR__, 2) . '/storage/admin-login-attempts.json';
    return $auth = new AdminAuth(new LoginRateLimiter($statePath, $salt));
}

function applySecurityHeaders(): void
{
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}

function clientIdentifier(): string
{
    return is_string($_SERVER['REMOTE_ADDR'] ?? null) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
}
