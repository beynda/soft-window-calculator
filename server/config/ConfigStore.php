<?php

declare(strict_types=1);

namespace BeyndaCalculator\Config;

use JsonException;
use RuntimeException;
use Throwable;

final class ConfigStore
{
    private readonly string $configPath;
    private readonly string $backupPath;
    private readonly string $lockPath;

    public function __construct(
        private readonly string $storageDirectory,
        private readonly ConfigValidator $validator = new ConfigValidator(),
    ) {
        $directory = rtrim($storageDirectory, DIRECTORY_SEPARATOR);
        $this->configPath = $directory . DIRECTORY_SEPARATOR . 'config.json';
        $this->backupPath = $directory . DIRECTORY_SEPARATOR . 'config.backup.json';
        $this->lockPath = $directory . DIRECTORY_SEPARATOR . 'config.lock';
    }

    /** @return array<string, mixed> */
    public function loadConfig(): array
    {
        $this->ensureStorageDirectory();
        return $this->withLock(LOCK_SH, function (): array {
            try {
                return $this->readValid($this->configPath);
            } catch (Throwable $primaryError) {
                try {
                    $backup = $this->readValid($this->backupPath);
                    error_log('config_recovered_from_backup: active configuration was invalid');
                    return $backup;
                } catch (Throwable) {
                    error_log('config_load_failed: active and backup configurations were invalid');
                    throw new RuntimeException('Could not load a valid configuration.', 0, $primaryError);
                }
            }
        });
    }

    /** @param array<string, mixed> $config @return array<string, mixed> */
    public function saveConfig(array $config): array
    {
        $config['savedAt'] = gmdate('c');
        $valid = $this->validator->validate($config);
        $json = $this->encode($valid);
        $this->ensureStorageDirectory();

        $this->withLock(LOCK_EX, function () use ($json): void {
            $temporary = $this->temporaryPath('config');
            try {
                if (file_put_contents($temporary, $json) === false) {
                    throw new RuntimeException('Could not write the temporary configuration file.');
                }
                $this->readValid($temporary);
                $this->preserveCurrentAsBackup();
                $this->atomicReplace($temporary, $this->configPath);
            } finally {
                if (is_file($temporary)) {
                    @unlink($temporary);
                }
            }
        });
        return $valid;
    }

    /** @return array<string, mixed> */
    private function readValid(string $path): array
    {
        $contents = @file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException('Configuration file is unavailable.');
        }
        try {
            $decoded = json_decode($contents, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('JSON configuration is corrupted.', 0, $error);
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new RuntimeException('Configuration root must be JSON-an object.');
        }
        return $this->validator->validate($decoded);
    }

    private function preserveCurrentAsBackup(): void
    {
        if (!is_file($this->configPath)) {
            return;
        }
        try {
            $current = $this->readValid($this->configPath);
        } catch (Throwable) {
            return;
        }
        $temporary = $this->temporaryPath('backup');
        try {
            if (file_put_contents($temporary, $this->encode($current)) === false) {
                throw new RuntimeException('Could not write the backup configuration.');
            }
            $this->readValid($temporary);
            $this->atomicReplace($temporary, $this->backupPath);
        } finally {
            if (is_file($temporary)) {
                @unlink($temporary);
            }
        }
    }

    private function atomicReplace(string $source, string $destination): void
    {
        if (@rename($source, $destination)) {
            return;
        }
        if (DIRECTORY_SEPARATOR === '\\' && is_file($destination)) {
            $old = $destination . '.old-' . bin2hex(random_bytes(6));
            if (@rename($destination, $old) && @rename($source, $destination)) {
                @unlink($old);
                return;
            }
            if (is_file($old) && !is_file($destination)) {
                @rename($old, $destination);
            }
        }
        throw new RuntimeException('Could not atomically replace the configuration file.');
    }

    private function ensureStorageDirectory(): void
    {
        if (!is_dir($this->storageDirectory) && !mkdir($this->storageDirectory, 0770, true) && !is_dir($this->storageDirectory)) {
            throw new RuntimeException('Could not create the configuration directory.');
        }
        if (!is_writable($this->storageDirectory)) {
            throw new RuntimeException('The configuration directory is not writable.');
        }
    }

    private function temporaryPath(string $kind): string
    {
        return $this->storageDirectory . DIRECTORY_SEPARATOR . "$kind." . bin2hex(random_bytes(8)) . '.tmp';
    }

    /** @template T @param callable(): T $callback @return T */
    private function withLock(int $operation, callable $callback): mixed
    {
        $handle = fopen($this->lockPath, 'c');
        if ($handle === false) {
            throw new RuntimeException('Could not open the configuration lock.');
        }
        try {
            if (!flock($handle, $operation)) {
                throw new RuntimeException('Could not lock the configuration.');
            }
            try {
                return $callback();
            } finally {
                flock($handle, LOCK_UN);
            }
        } finally {
            fclose($handle);
        }
    }

    /** @param array<string, mixed> $value */
    private function encode(array $value): string
    {
        try {
            return json_encode($value, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } catch (JsonException $error) {
            throw new RuntimeException('Could not serialize the configuration.', 0, $error);
        }
    }
}
