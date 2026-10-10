<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

use RuntimeException;

final class IdempotencyStore
{
    private readonly AtomicJsonState $state;

    public function __construct(private readonly string $path, private readonly string $salt, private readonly int $ttlSeconds = 900)
    {
        if (strlen($salt) < 16) {
            throw new RuntimeException('QUOTE_IDEMPOTENCY_SALT must contain at least 16 characters.');
        }
        $this->state = new AtomicJsonState($path);
    }

    /** @return array{status: 'new'|'cached'|'conflict'|'pending'|'resume', response?: array<string, mixed>, sentKinds?: list<string>} */
    public function claim(string $key, string $projectFingerprint): array
    {
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/', $key) !== 1) {
            throw new ApiException('Invalid idempotency key.', 'INVALID_IDEMPOTENCY_KEY');
        }
        return $this->state->mutate(function (array &$state) use ($key, $projectFingerprint): array {
            $id = hash_hmac('sha256', $key, $this->salt);
            $existing = $state[$id] ?? null;
            if (is_array($existing)) {
                if (!hash_equals((string) ($existing['fingerprint'] ?? ''), $projectFingerprint)) return ['status' => 'conflict'];
                if (($existing['status'] ?? null) === 'complete' && is_array($existing['response'] ?? null)) {
                    return ['status' => 'cached', 'response' => $existing['response']];
                }
                if (($existing['status'] ?? null) === 'retryable' && is_array($existing['response'] ?? null)) {
                    $state[$id]['status'] = 'pending';
                    return ['status' => 'resume', 'response' => $existing['response'], 'sentKinds' => is_array($existing['sentKinds'] ?? null) ? $existing['sentKinds'] : []];
                }
                return ['status' => 'pending'];
            }
            $state[$id] = ['fingerprint' => $projectFingerprint, 'status' => 'pending', 'createdAt' => time()];
            return ['status' => 'new'];
        });
    }

    /** @param array<string, mixed> $response */
    public function checkpoint(string $key, string $projectFingerprint, array $response): void
    {
        $this->state->mutate(function (array &$state) use ($key, $projectFingerprint, $response) {
            $id = hash_hmac('sha256', $key, $this->salt);
            $state[$id] = ['fingerprint' => $projectFingerprint, 'status' => 'pending', 'createdAt' => time(), 'response' => $response, 'sentKinds' => []];
            return null;
        });
    }

    public function markSent(string $key, string $kind): void
    {
        $this->state->mutate(function (array &$state) use ($key, $kind) {
            $id = hash_hmac('sha256', $key, $this->salt);
            if (isset($state[$id]) && is_array($state[$id])) {
                $sent = is_array($state[$id]['sentKinds'] ?? null) ? $state[$id]['sentKinds'] : [];
                if (!in_array($kind, $sent, true)) $sent[] = $kind;
                $state[$id]['sentKinds'] = $sent;
            }
            return null;
        });
    }

    public function pause(string $key): void
    {
        $this->state->mutate(function (array &$state) use ($key) {
            $id = hash_hmac('sha256', $key, $this->salt);
            if (isset($state[$id]) && is_array($state[$id]) && is_array($state[$id]['response'] ?? null)) $state[$id]['status'] = 'retryable';
            return null;
        });
    }

    /** @param array<string, mixed> $response */
    public function complete(string $key, string $projectFingerprint, array $response): void
    {
        $this->state->mutate(function (array &$state) use ($key, $projectFingerprint, $response) {
            $id = hash_hmac('sha256', $key, $this->salt);
            $state[$id] = [
                'fingerprint' => $projectFingerprint,
                'status' => 'complete',
                'createdAt' => time(),
                'response' => $response,
            ];
            return null;
        });
    }

    public function release(string $key): void
    {
        $this->state->mutate(function (array &$state) use ($key) {
            unset($state[hash_hmac('sha256', $key, $this->salt)]);
            return null;
        });
    }

}
