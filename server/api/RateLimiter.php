<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

use RuntimeException;

final class RateLimiter
{
    private readonly AtomicJsonState $state;

    public function __construct(
        private readonly string $path,
        private readonly string $salt,
        private readonly int $limit = 5,
        private readonly int $windowSeconds = 600,
    ) {
        if (strlen($salt) < 16) {
            throw new RuntimeException('QUOTE_IP_HASH_SALT must contain at least 16 characters.');
        }
        $this->state = new AtomicJsonState($path);
    }

    public function reserve(string $ip): bool
    {
        $key = hash_hmac('sha256', $ip, $this->salt);
        return $this->state->mutate(function (array &$state) use ($key): bool {
            $now = time();
            foreach ($state as $hash => $timestamps) {
                if (!is_array($timestamps)) { unset($state[$hash]); continue; }
                $fresh = array_values(array_filter($timestamps, fn ($at): bool => is_int($at) && $at > $now - $this->windowSeconds));
                if ($fresh === []) unset($state[$hash]); else $state[$hash] = $fresh;
            }
            $attempts = $state[$key] ?? [];
            $allowed = count($attempts) < $this->limit;
            if ($allowed) $state[$key] = [...$attempts, $now];
            return $allowed;
        });
    }
}
