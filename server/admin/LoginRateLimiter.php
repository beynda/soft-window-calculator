<?php

declare(strict_types=1);

namespace BeyndaCalculator\Admin;

use JsonException;
use RuntimeException;

final class LoginRateLimiter
{
    public const MAX_ATTEMPTS = 5;
    private const WINDOW_SECONDS = 900;

    public function __construct(
        private readonly string $statePath,
        private readonly string $salt,
    ) {
    }

    public function reserveAttempt(string $identifier): bool
    {
        return $this->withState(function (array &$state) use ($identifier): bool {
            $key = $this->key($identifier);
            $attempts = $this->recentAttempts($state[$key] ?? []);
            if (count($attempts) >= self::MAX_ATTEMPTS) {
                $state[$key] = $attempts;
                return false;
            }
            $attempts[] = time();
            $state[$key] = $attempts;
            return true;
        });
    }

    public function clearAfterSuccess(string $identifier): void
    {
        $this->withState(function (array &$state) use ($identifier): bool {
            unset($state[$this->key($identifier)]);
            return true;
        });
    }

    public function retryAfter(string $identifier): int
    {
        return $this->withState(function (array &$state) use ($identifier): int {
            $key = $this->key($identifier);
            $attempts = $this->recentAttempts($state[$key] ?? []);
            $state[$key] = $attempts;
            if (count($attempts) < self::MAX_ATTEMPTS) {
                return 0;
            }
            return max(1, self::WINDOW_SECONDS - (time() - min($attempts)));
        });
    }

    private function key(string $identifier): string
    {
        return hash_hmac('sha256', $identifier, $this->salt);
    }

    /** @param mixed $attempts @return list<int> */
    private function recentAttempts(mixed $attempts): array
    {
        if (!is_array($attempts)) {
            return [];
        }
        $threshold = time() - self::WINDOW_SECONDS;
        return array_values(array_filter($attempts, static fn (mixed $at): bool => is_int($at) && $at >= $threshold));
    }

    /** @template T @param callable(array<string, list<int>>&): T $callback @return T */
    private function withState(callable $callback): mixed
    {
        $directory = dirname($this->statePath);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new RuntimeException('Could not create the login rate limiter directory.');
        }
        $handle = fopen($this->statePath, 'c+');
        if ($handle === false) {
            throw new RuntimeException('Could not open the login rate limiter state.');
        }
        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Could not lock the login rate limiter state.');
            }
            rewind($handle);
            $contents = stream_get_contents($handle);
            $state = [];
            if (is_string($contents) && trim($contents) !== '') {
                try {
                    $decoded = json_decode($contents, true, 16, JSON_THROW_ON_ERROR);
                    if (is_array($decoded) && !array_is_list($decoded)) {
                        $state = $decoded;
                    }
                } catch (JsonException) {
                    error_log('admin_rate_limit_state_reset: invalid state');
                }
            }
            $result = $callback($state);
            $json = json_encode($state, JSON_THROW_ON_ERROR);
            rewind($handle);
            if (!ftruncate($handle, 0) || fwrite($handle, $json) === false || !fflush($handle)) {
                throw new RuntimeException('Could not update the login rate limiter.');
            }
            flock($handle, LOCK_UN);
            return $result;
        } finally {
            fclose($handle);
        }
    }
}
