<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

use JsonException;
use RuntimeException;
use Throwable;

final class AtomicJsonState
{
    public function __construct(private readonly string $path)
    {
    }

    public function mutate(callable $callback): mixed
    {
        $directory = dirname($this->path);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) throw new RuntimeException('Directory is unavailable state.');
        $lock = fopen($this->path . '.lock', 'c');
        if ($lock === false) throw new RuntimeException('Could not open state lock.');
        try {
            if (!flock($lock, LOCK_EX)) throw new RuntimeException('Could not lock state.');
            $state = $this->read();
            $result = $callback($state);
            $this->write($state);
            flock($lock, LOCK_UN);
            return $result;
        } finally {
            fclose($lock);
        }
    }

    /** @return array<string, mixed> */
    private function read(): array
    {
        if (!is_file($this->path)) return [];
        $raw = file_get_contents($this->path);
        if ($raw === false || $raw === '') throw new RuntimeException('State is unavailable or empty.');
        try {
            $state = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('State JSON is corrupted.', 0, $error);
        }
        if (!is_array($state) || ($state !== [] && array_is_list($state))) throw new RuntimeException('State must be JSON-an object.');
        return $state;
    }

    /** @param array<string, mixed> $state */
    private function write(array $state): void
    {
        try {
            $json = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $error) {
            throw new RuntimeException('Could not serialize state.', 0, $error);
        }
        $temporary = $this->path . '.tmp-' . bin2hex(random_bytes(8));
        $handle = fopen($temporary, 'xb');
        if ($handle === false) throw new RuntimeException('Could not create temp state.');
        try {
            $written = 0;
            $length = strlen($json);
            while ($written < $length) {
                $chunk = fwrite($handle, substr($json, $written));
                if ($chunk === false || $chunk === 0) throw new RuntimeException('Incomplete record state.');
                $written += $chunk;
            }
            if ($written !== $length || !fflush($handle)) throw new RuntimeException('Could not flush state.');
            if (function_exists('fsync') && !fsync($handle)) throw new RuntimeException('Could not synchronize state.');
        } catch (Throwable $error) {
            fclose($handle);
            @unlink($temporary);
            throw $error;
        }
        fclose($handle);
        $this->atomicReplace($temporary);
    }

    private function atomicReplace(string $temporary): void
    {
        if (@rename($temporary, $this->path)) return;
        if (DIRECTORY_SEPARATOR === '\\' && is_file($this->path)) {
            $old = $this->path . '.old-' . bin2hex(random_bytes(6));
            if (@rename($this->path, $old) && @rename($temporary, $this->path)) { @unlink($old); return; }
            if (is_file($old) && !is_file($this->path)) @rename($old, $this->path);
        }
        @unlink($temporary);
        throw new RuntimeException('Could not atomically replace state.');
    }
}
