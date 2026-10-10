<?php
declare(strict_types=1);
namespace BeyndaCalculator\Config;

function normalizePresentation(mixed $value): array
{
    if (!is_array($value) || array_diff(array_keys($value), ['language', 'units', 'market']) !== []
        || !in_array($value['language'] ?? null, ['en', 'ru'], true)
        || !in_array($value['units'] ?? null, ['cm', 'in'], true)
        || !in_array($value['market'] ?? null, ['USD', 'EUR', 'RUB'], true)
        || ($value['language'] === 'ru' && ($value['units'] !== 'cm' || $value['market'] !== 'RUB'))) {
        throw new \BeyndaCalculator\QuoteApi\ApiException('Invalid language, unit or currency selection.', 'INVALID_PRESENTATION', 422);
    }
    return $value;
}

function presentText(string $text, array $presentation): string
{
    if (($presentation['units'] ?? 'cm') === 'in') {
        $text = preg_replace_callback('/([0-9]+(?:[.,][0-9]+)?)\s+CM\b/i', static function ($match): string {
            return rtrim(rtrim(number_format((float) str_replace(',', '.', $match[1]) / 2.54, 2, '.', ''), '0'), '.') . ' IN';
        }, $text) ?? $text;
    }
    if (($presentation['language'] ?? 'en') !== 'ru') return $text;
    static $dictionary;
    if ($dictionary === null) $dictionary = json_decode(file_get_contents(__DIR__ . '/translations.json'), true, 64, JSON_THROW_ON_ERROR);
    $pattern = '/(?<![\p{L}\p{N}_-])(?:' . implode('|', array_map(static fn ($key) => preg_quote($key, '/'), array_keys($dictionary))) . ')(?![\p{L}\p{N}_-])/u';
    return preg_replace_callback($pattern, static fn ($match): string => $dictionary[$match[0]], $text) ?? $text;
}
