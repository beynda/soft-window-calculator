<?php

declare(strict_types=1);

namespace BeyndaCalculator\Admin;

use RuntimeException;

final class AdminAuth
{
    private const SESSION_AUTHENTICATED = 'admin_authenticated';
    private const SESSION_CSRF = 'admin_csrf';

    public function __construct(private readonly LoginRateLimiter $limiter)
    {
    }

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('tent_admin');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => self::isHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        if (!session_start()) {
            throw new RuntimeException('Could not open a secure session.');
        }
    }

    public function login(string $password, string $identifier): bool
    {
        if (!$this->limiter->reserveAttempt($identifier)) {
            return false;
        }
        $passwordHash = getenv('ADMIN_PASSWORD_HASH');
        if (!is_string($passwordHash) || $passwordHash === '' || !password_verify($password, $passwordHash)) {
            return false;
        }
        $this->limiter->clearAfterSuccess($identifier);
        session_regenerate_id(true);
        $_SESSION[self::SESSION_AUTHENTICATED] = true;
        $_SESSION[self::SESSION_CSRF] = bin2hex(random_bytes(32));
        return true;
    }

    public function isAuthenticated(): bool
    {
        return ($_SESSION[self::SESSION_AUTHENTICATED] ?? false) === true;
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => 'Strict',
            ]);
        }
        session_destroy();
    }

    public function csrfToken(): string
    {
        if (!isset($_SESSION[self::SESSION_CSRF])) {
            $_SESSION[self::SESSION_CSRF] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION[self::SESSION_CSRF];
    }

    public function assertCsrf(?string $token): void
    {
        $expected = $_SESSION[self::SESSION_CSRF] ?? '';
        if (!is_string($token) || !is_string($expected) || $expected === '' || !hash_equals($expected, $token)) {
            throw new RuntimeException('Invalid CSRF-token.');
        }
    }

    public function retryAfter(string $identifier): int
    {
        return $this->limiter->retryAfter($identifier);
    }

    private static function isHttps(): bool
    {
        return ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
    }
}
