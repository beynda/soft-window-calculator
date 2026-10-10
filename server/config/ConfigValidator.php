<?php

declare(strict_types=1);

namespace BeyndaCalculator\Config;

final class ConfigValidator
{
    private const FIXED_RECIPIENT = 'quotes@example.invalid';
    private const ALLOWED_TOP_LEVEL_KEYS = [
        'version', 'currency', 'companyAddress', 'savedAt', 'ranges', 'availableOptions', 'tariffs', 'vat', 'texts',
    ];
    private const MATERIALS = ['clear-pvc-700', 'tinted-pvc-700', 'none'];
    private const HARDWARE = [
        'grommet', 'plastic-turn-button', 'metal-turn-button',
        'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit',
    ];
    private const PIECE_HARDWARE = [
        'grommet', 'plastic-turn-button', 'metal-turn-button',
        'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit',
    ];
    private const SHAPES = [
        'rectangle', 'trapezoid-right', 'trapezoid-left', 'trapezoid-both',
        'triangle-left', 'triangle-right', 'hexagon-peak', 't-shape', 'octagon',
    ];
    private const PRODUCTS = ['window', 'door'];

    /** @param array<string, mixed> $config @return array<string, mixed> */
    public function validate(array $config, bool $currencyProfile = false): array
    {
        $errors = [];
        foreach (array_diff(array_keys($config), [...self::ALLOWED_TOP_LEVEL_KEYS, 'marketRates']) as $key) {
            $errors[(string) $key] = $key === 'recipientEmail'
                ? 'Address ' . self::FIXED_RECIPIENT . ' is fixed and cannot be edited.'
                : 'Unknown configuration field.';
        }
        foreach (self::ALLOWED_TOP_LEVEL_KEYS as $key) {
            if (!array_key_exists($key, $config)) {
                $errors[$key] = 'A required field is missing.';
            }
        }

        if (($config['version'] ?? null) !== 1) {
            $errors['version'] = 'Only version is supported: 1.';
        }
        if (!in_array($config['currency'] ?? null, $currencyProfile ? ['USD', 'EUR'] : ['RUB'], true)) {
            $errors['currency'] = $currencyProfile ? 'Profile currency must be USD or EUR.' : 'Currency must be RUB.';
        }
        $companyAddress = $config['companyAddress'] ?? null;
        if (!is_string($companyAddress) || $this->unicodeLength($companyAddress) > 500) {
            $errors['companyAddress'] = 'Company address must be a string of at most 500 characters.';
        } elseif (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $companyAddress) === 1) {
            $errors['companyAddress'] = 'Company address contains unsupported control characters.';
        }
        $savedAt = $config['savedAt'] ?? null;
        if ($savedAt !== null && (!is_string($savedAt) || strtotime($savedAt) === false)) {
            $errors['savedAt'] = 'Save time must be a date ISO 8601 or null.';
        }

        $ranges = $this->record($config['ranges'] ?? null, 'ranges', $errors);
        $this->rejectUnknownKeys($ranges, ['dimensions', 'borderWidthCm'], 'ranges', $errors);
        $dimensions = $this->record($ranges['dimensions'] ?? null, 'ranges.dimensions', $errors);
        $this->rejectUnknownKeys($dimensions, ['min', 'max', 'minSegment'], 'ranges.dimensions', $errors);
        $min = $this->number($dimensions['min'] ?? null, 'ranges.dimensions.min', $errors, 1, 10000);
        $max = $this->number($dimensions['max'] ?? null, 'ranges.dimensions.max', $errors, 1, 1500);
        $minSegment = $this->number($dimensions['minSegment'] ?? null, 'ranges.dimensions.minSegment', $errors, 1, 1000);
        if ($min !== null && $max !== null && $min > $max) {
            $errors['ranges.dimensions'] = 'Minimum dimension must not exceed maximum dimension.';
        }
        if ($min !== null && $minSegment !== null && $minSegment > $min) {
            $errors['ranges.dimensions.minSegment'] = 'Minimum segment length must not exceed the minimum dimension.';
        }
        $borderRange = $this->record($ranges['borderWidthCm'] ?? null, 'ranges.borderWidthCm', $errors);
        $this->rejectUnknownKeys($borderRange, ['min', 'max'], 'ranges.borderWidthCm', $errors);
        $borderMin = $this->number($borderRange['min'] ?? null, 'ranges.borderWidthCm.min', $errors, 1, 100);
        $borderMax = $this->number($borderRange['max'] ?? null, 'ranges.borderWidthCm.max', $errors, 1, 100);
        if ($borderMin !== null && $borderMax !== null && $borderMin > $borderMax) {
            $errors['ranges.borderWidthCm'] = 'Minimum width must not exceed maximum width.';
        }

        $options = $this->record($config['availableOptions'] ?? null, 'availableOptions', $errors);
        $this->rejectUnknownKeys($options, ['materials', 'hardware'], 'availableOptions', $errors);
        $this->enumList($options['materials'] ?? null, self::MATERIALS, 'availableOptions.materials', $errors);
        $this->enumList($options['hardware'] ?? null, self::HARDWARE, 'availableOptions.hardware', $errors);

        $tariffs = $this->record($config['tariffs'] ?? null, 'tariffs', $errors);
        $this->rejectUnknownKeys($tariffs, [
            'materials', 'border', 'hardware', 'zipperPerMeter', 'weightBarPerMeter',
            'flashingPerMeter', 'surcharges',
        ], 'tariffs', $errors);
        $materials = $this->record($tariffs['materials'] ?? null, 'tariffs.materials', $errors);
        $this->rejectUnknownKeys($materials, self::MATERIALS, 'tariffs.materials', $errors);
        foreach (self::MATERIALS as $material) {
            if (array_key_exists($material, $materials) || $material !== 'none') {
                $this->number($materials[$material] ?? null, "tariffs.materials.$material", $errors, 0, 100000000);
            }
        }
        if (array_key_exists('border', $tariffs)) {
            $border = $this->record($tariffs['border'], 'tariffs.border', $errors);
            $this->rejectUnknownKeys($border, ['perMeter', 'baseWidthCm'], 'tariffs.border', $errors);
            $this->number($border['perMeter'] ?? null, 'tariffs.border.perMeter', $errors, 0, 100000000);
            $this->number($border['baseWidthCm'] ?? null, 'tariffs.border.baseWidthCm', $errors, 1, 100);
        }
        $hardware = $this->record($tariffs['hardware'] ?? null, 'tariffs.hardware', $errors);
        $this->rejectUnknownKeys($hardware, self::PIECE_HARDWARE, 'tariffs.hardware', $errors);
        foreach (self::PIECE_HARDWARE as $item) {
            if (array_key_exists($item, $hardware) || $item !== 'hook-strap-kit') {
                $this->number($hardware[$item] ?? null, "tariffs.hardware.$item", $errors, 0, 100000000);
            }
        }
        foreach (['zipperPerMeter', 'weightBarPerMeter', 'flashingPerMeter'] as $key) {
            $this->number($tariffs[$key] ?? null, "tariffs.$key", $errors, 0, 100000000);
        }
        $surcharges = $this->record($tariffs['surcharges'] ?? null, 'tariffs.surcharges', $errors);
        $this->rejectUnknownKeys($surcharges, ['shapes', 'products'], 'tariffs.surcharges', $errors);
        $this->surchargeMap($surcharges['shapes'] ?? null, self::SHAPES, 'tariffs.surcharges.shapes', $errors);
        $this->surchargeMap($surcharges['products'] ?? null, self::PRODUCTS, 'tariffs.surcharges.products', $errors);

        $vat = $this->record($config['vat'] ?? null, 'vat', $errors);
        $this->rejectUnknownKeys($vat, ['mode', 'ratePercent'], 'vat', $errors);
        $mode = $vat['mode'] ?? null;
        if (!is_string($mode) || !in_array($mode, ['off', 'included', 'additive'], true)) {
            $errors['vat.mode'] = 'VAT mode must be off, included or additive.';
        }
        $rate = $this->number($vat['ratePercent'] ?? null, 'vat.ratePercent', $errors, 0, 100);
        if ($mode === 'off' && $rate !== null && $rate !== 0.0) {
            $errors['vat.ratePercent'] = 'When VAT is disabled, the rate must equal 0.';
        }
        if (in_array($mode, ['included', 'additive'], true) && $rate !== null && $rate <= 0) {
            $errors['vat.ratePercent'] = 'The VAT rate for the selected mode must be greater than 0.';
        }

        $texts = $this->record($config['texts'] ?? null, 'texts', $errors);
        $this->rejectUnknownKeys($texts, ['intro', 'configurationRequired', 'privacy'], 'texts', $errors);
        foreach (['intro', 'configurationRequired', 'privacy'] as $key) {
            $value = $texts[$key] ?? null;
            if (!is_string($value) || $this->unicodeLength($value) > 2000) {
                $errors["texts.$key"] = 'Text must be a string of at most 2000 characters.';
            }
        }
        if (isset($texts['configurationRequired']) && trim((string) $texts['configurationRequired']) === '') {
            $errors['texts.configurationRequired'] = 'The pricing configuration message must not be empty.';
        }

        if (isset($config['marketRates'])) {
            if (!is_array($config['marketRates']) || array_is_list($config['marketRates'])) $errors['marketRates'] = 'Expected a currency profile object.';
            else foreach ($config['marketRates'] as $currency => $profile) {
                if (!in_array($currency, ['USD', 'EUR'], true) || !is_array($profile) || array_diff(array_keys($profile), ['tariffs', 'vat']) !== [] || !isset($profile['tariffs'], $profile['vat'])) { $errors['marketRates.' . $currency] = 'Invalid tariff profile.'; continue; }
                $candidate = $config; unset($candidate['marketRates']);
                $candidate['currency'] = $currency; $candidate['tariffs'] = $profile['tariffs']; $candidate['vat'] = $profile['vat'];
                try { $this->validate($candidate, true); } catch (ConfigValidationException $exception) { $errors['marketRates.' . $currency] = 'Invalid tariff or tax settings.'; }
            }
        }
        if ($errors !== []) {
            throw new ConfigValidationException($errors);
        }
        return $config;
    }

    /** @param mixed $value @param array<string, string> $errors @return array<string, mixed> */
    private function record(mixed $value, string $path, array &$errors): array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            $errors[$path] = 'Expected JSON-an object.';
            return [];
        }
        return $value;
    }

    /** @param mixed $value @param array<string, string> $errors */
    private function number(mixed $value, string $path, array &$errors, float $minimum, float $maximum): ?float
    {
        if (!is_int($value) && !is_float($value)) {
            $errors[$path] = 'A number is required.';
            return null;
        }
        $number = (float) $value;
        if (!is_finite($number) || $number < $minimum || $number > $maximum) {
            $errors[$path] = "Number must be between $minimum and $maximum.";
            return null;
        }
        return $number;
    }

    /** @param mixed $value @param list<string> $allowed @param array<string, string> $errors */
    private function enumList(mixed $value, array $allowed, string $path, array &$errors): void
    {
        if (!is_array($value) || !array_is_list($value)) {
            $errors[$path] = 'Expected JSON-an array.';
            return;
        }
        if (count(array_unique($value, SORT_REGULAR)) !== count($value)) {
            $errors[$path] = 'Values must be unique.';
        }
        foreach ($value as $index => $item) {
            if (!is_string($item) || !in_array($item, $allowed, true)) {
                $errors["$path.$index"] = 'Invalid option.';
            }
        }
    }

    /** @param mixed $value @param list<string> $allowedKeys @param array<string, string> $errors */
    private function surchargeMap(mixed $value, array $allowedKeys, string $path, array &$errors): void
    {
        $map = $this->record($value, $path, $errors);
        foreach ($map as $key => $surcharge) {
            $itemPath = "$path.$key";
            if (!in_array((string) $key, $allowedKeys, true)) {
                $errors[$itemPath] = 'Unknown surcharge type.';
                continue;
            }
            $item = $this->record($surcharge, $itemPath, $errors);
            $this->rejectUnknownKeys($item, ['type', 'value', 'label'], $itemPath, $errors);
            if (!in_array($item['type'] ?? null, ['fixed', 'percent'], true)) {
                $errors["$itemPath.type"] = 'Surcharge type must be fixed or percent.';
            }
            $this->number($item['value'] ?? null, "$itemPath.value", $errors, 0, 100000000);
            if (isset($item['label']) && (!is_string($item['label']) || $this->unicodeLength($item['label']) > 120)) {
                $errors["$itemPath.label"] = 'Surcharge name must be a string of at most 120 characters.';
            }
        }
    }

    /** @param array<string, mixed> $value @param list<string> $allowed @param array<string, string> $errors */
    private function rejectUnknownKeys(array $value, array $allowed, string $path, array &$errors): void
    {
        foreach (array_diff(array_keys($value), $allowed) as $key) {
            $errors["$path.$key"] = 'Unknown configuration field.';
        }
    }

    private function unicodeLength(string $value): int
    {
        $length = preg_match_all('/./us', $value);
        return $length === false ? PHP_INT_MAX : $length;
    }
}
