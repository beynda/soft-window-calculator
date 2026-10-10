<?php

declare(strict_types=1);

namespace BeyndaCalculator\Config;

const PUBLIC_KEYS = [
    'version', 'currency', 'companyAddress', 'savedAt', 'ranges', 'availableOptions', 'tariffs', 'vat', 'texts',
];

/** @param array<string, mixed> $config @return array<string, mixed> */
function publicConfig(array $config): array
{
    $public = array_intersect_key($config, array_flip(PUBLIC_KEYS));
    $public['ranges'] = allowedRecord($public['ranges'] ?? null, ['dimensions', 'borderWidthCm']);
    $public['ranges']['dimensions'] = allowedRecord($public['ranges']['dimensions'] ?? null, ['min', 'max', 'minSegment']);
    $public['ranges']['borderWidthCm'] = allowedRecord($public['ranges']['borderWidthCm'] ?? null, ['min', 'max']);
    $public['availableOptions'] = allowedRecord($public['availableOptions'] ?? null, ['materials', 'hardware']);
    $public['tariffs'] = allowedRecord($public['tariffs'] ?? null, [
        'materials', 'hardware', 'zipperPerMeter', 'weightBarPerMeter',
        'flashingPerMeter', 'surcharges',
    ]);
    $public['tariffs']['materials'] = allowedRecord($public['tariffs']['materials'] ?? null, ['clear-pvc-700', 'tinted-pvc-700', 'none']);
    $public['tariffs']['hardware'] = allowedRecord($public['tariffs']['hardware'] ?? null, [
        'grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit',
    ]);
    $surcharges = allowedRecord($public['tariffs']['surcharges'] ?? null, ['shapes', 'products']);
    foreach (['shapes', 'products'] as $group) {
        $items = is_array($surcharges[$group] ?? null) ? $surcharges[$group] : [];
        foreach ($items as $key => $item) {
            $items[$key] = allowedRecord($item, ['type', 'value', 'label']);
        }
        $surcharges[$group] = $items;
    }
    $public['tariffs']['surcharges'] = $surcharges;
    $public['vat'] = allowedRecord($public['vat'] ?? null, ['mode', 'ratePercent']);
    $public['texts'] = allowedRecord($public['texts'] ?? null, ['intro', 'configurationRequired', 'privacy']);
    if (isset($config['marketRates']) && is_array($config['marketRates'])) {
        $public['marketRates'] = [];
        foreach ($config['marketRates'] as $currency => $profile) {
            if (!in_array($currency, ['USD', 'EUR'], true) || !is_array($profile)) continue;
            $candidate = $config; unset($candidate['marketRates']);
            $candidate['currency'] = $currency; $candidate['tariffs'] = $profile['tariffs']; $candidate['vat'] = $profile['vat'];
            $clean = publicConfig($candidate);
            $public['marketRates'][$currency] = ['tariffs' => $clean['tariffs'], 'vat' => $clean['vat']];
        }
    }
    return $public;
}

/** @param mixed $value @param list<string> $keys @return array<string, mixed> */
function allowedRecord(mixed $value, array $keys): array
{
    return is_array($value) ? array_intersect_key($value, array_flip($keys)) : [];
}
