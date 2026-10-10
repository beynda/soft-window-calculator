<?php

declare(strict_types=1);

namespace BeyndaCalculator\Config;

require_once __DIR__ . '/ConfigValidationException.php';
require_once __DIR__ . '/ConfigValidator.php';
require_once __DIR__ . '/ConfigStore.php';
require_once __DIR__ . '/PublicConfig.php';

function configStore(): ConfigStore
{
    static $store;
    return $store ??= new ConfigStore(dirname(__DIR__, 2) . '/storage');
}

/** @return array<string, mixed> */
function loadConfig(): array
{
    return configStore()->loadConfig();
}

/** @param array<string, mixed> $config @return array<string, mixed> */
function saveConfig(array $config): array
{
    return configStore()->saveConfig($config);
}
