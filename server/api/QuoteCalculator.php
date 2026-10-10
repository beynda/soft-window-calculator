<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

require_once dirname(__DIR__) . '/config/Presentation.php';

final class QuoteCalculator
{
    private int $moneyPrecision = 0;
    private const SHAPES = [
        'rectangle' => ['width', 'height'],
        'trapezoid-right' => ['width', 'height', 'wallHeight'],
        'trapezoid-left' => ['width', 'height', 'wallHeight'],
        'trapezoid-both' => ['width', 'height', 'leftWallHeight', 'rightWallHeight'],
        'triangle-left' => ['width', 'height'],
        'triangle-right' => ['width', 'height'],
        'hexagon-peak' => ['width', 'height', 'wallHeight', 'ridgeWidth'],
        't-shape' => ['width', 'height', 'stemWidth', 'crossbarHeight'],
        'octagon' => ['width', 'height', 'cutSize'],
    ];
    private const MATERIALS = ['clear-pvc-700', 'tinted-pvc-700', 'none'];
    private const HARDWARE = ['grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45', 'hook-strap-kit', 'weight-bar'];
    private const SIDE_HARDWARE = ['grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45'];

    /** @param array<string, mixed> $project @param array<string, mixed> $config @return array<string, mixed> */
    public function calculate(array $project, array $config): array
    {
        $products = $project['products'] ?? null;
        if (($project['version'] ?? null) !== 1 || !is_array($products) || !array_is_list($products) || $products === []) {
            $this->fail('Add at least one product.', 'project.products');
        }
        if (array_diff(array_keys($project), ['version', 'products', 'activeProductId', 'updatedAt', 'presentation']) !== []) {
            $this->fail('Project contains unknown fields.', 'project');
        }
        $presentation = null;
        if (isset($project['presentation'])) {
            $presentation = \BeyndaCalculator\Config\normalizePresentation($project['presentation']);
            if ($presentation['market'] !== $config['currency']) {
                $profile = $config['marketRates'][$presentation['market']] ?? null;
                if (!is_array($profile)) $this->fail('No tariff profile is configured for this currency.', 'project.presentation.market');
                $config['currency'] = $presentation['market']; $config['tariffs'] = $profile['tariffs']; $config['vat'] = $profile['vat'];
            }
        }
        $windows = count(array_filter($products, fn ($item): bool => is_array($item) && ($item['type'] ?? null) === 'window'));
        $doors = count(array_filter($products, fn ($item): bool => is_array($item) && ($item['type'] ?? null) === 'door'));
        if ($windows > 10 || $doors > 2 || count($products) > 12) $this->fail('Product limit exceeded.', 'project.products');

        $this->moneyPrecision = ($config['currency'] ?? 'RUB') === 'RUB' ? 0 : 2;
        $normalized = [];
        $ids = [];
        $missing = [];
        foreach ($products as $index => $product) {
            if (!is_array($product) || array_is_list($product)) $this->fail('Product is missing.', "project.products.$index");
            $item = $this->normalizeProduct($product, $config, $index, $missing);
            if (isset($ids[$item['id']])) $this->fail('Product identifiers must be unique.', "project.products.$index.id");
            $ids[$item['id']] = true;
            $normalized[] = $item;
        }
        $base = [
            'version' => 1,
            'quoteNumber' => 'Q-' . strtoupper(gmdate('ymd-His')) . '-' . strtoupper(bin2hex(random_bytes(3))),
            'createdAt' => gmdate('c'),
            'currency' => (string) ($config['currency'] ?? 'RUB'),
            'products' => $normalized,
        ];
        if ($presentation !== null) $base['presentation'] = $presentation;
        if ($missing !== []) {
            sort($missing);
            return $base + [
                'status' => 'configuration-required', 'statusText' => 'Pricing requires configuration',
                'missingTariffs' => array_values(array_unique($missing)), 'lineItems' => [], 'subtotal' => null,
                'tax' => ['mode' => $config['vat']['mode'] ?? 'off', 'ratePercent' => $config['vat']['ratePercent'] ?? 0, 'amount' => null],
                'total' => null,
            ];
        }
        return $this->price($base, $config);
    }

    /** @param array<string, mixed> $product @param array<string, mixed> $config @param list<string> $missing @return array<string, mixed> */
    private function normalizeProduct(array $product, array $config, int $index, array &$missing): array
    {
        $allowed = ['id', 'type', 'shape', 'position', 'dimensions', 'material', 'purpose', 'hardware', 'hardwareBySide', 'zipperMode', 'zipperSide', 'installation', 'border', 'extras'];
        if (array_diff(array_keys($product), $allowed) !== []) $this->fail('Product contains unknown fields.', "project.products.$index");
        $type = $product['type'] ?? null;
        if (!in_array($type, ['window', 'door'], true)) $this->fail('Invalid product type.', "project.products.$index.type");
        $id = $product['id'] ?? null;
        if (!is_string($id) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/', $id) !== 1) $this->fail('Invalid product identifier.', "project.products.$index.id");
        $shape = $product['shape'] ?? null;
        if (!is_string($shape) || !isset(self::SHAPES[$shape]) || ($type === 'door' && $shape !== 'rectangle')) $this->fail('Shape is unavailable.', "project.products.$index.shape");
        $positions = $type === 'door' ? ['left', 'right'] : ['right', 'left', 'top', 'bottom', 'extension-45'];
        if (!in_array($product['position'] ?? null, $positions, true)) $this->fail('Invalid position.', "project.products.$index.position");
        $material = $product['material'] ?? null;
        if (!in_array($material, self::MATERIALS, true) || !in_array($material, $config['availableOptions']['materials'] ?? self::MATERIALS, true)) $this->fail('Material is unavailable.', "project.products.$index.material");
        $purpose = $type === 'door' ? 'opening' : ($product['purpose'] ?? null);
        if (!in_array($purpose, ['opening', 'fixed'], true)) $this->fail('Window purpose is not selected.', "project.products.$index.purpose");
        $hasSideHardware = isset($product['hardwareBySide']) && is_array($product['hardwareBySide']) && !array_is_list($product['hardwareBySide']);
        $hardware = $product['hardware'] ?? null;
        $compatibleHardware = $purpose === 'fixed' ? array_slice(self::SIDE_HARDWARE, 0, 4) : self::SIDE_HARDWARE;
        if (!$hasSideHardware && (!in_array($hardware, $compatibleHardware, true) || !in_array($hardware, $config['availableOptions']['hardware'] ?? self::HARDWARE, true))) $this->fail('Hardware is unavailable.', "project.products.$index.hardware");
        $zipperMode = $product['zipperMode'] ?? (isset($product['zipperSide']) ? 'center' : null);
        if ($type === 'door' && !in_array($zipperMode, ['center', 'both-sides'], true)) $this->fail('Zipper layout is not selected.', "project.products.$index.zipperMode");

        $geometry = $this->geometry($product, $config, $index);
        $border = $product['border'] ?? null;
        if (!is_array($border) || array_is_list($border)) $this->fail('Edging is missing.', "project.products.$index.border");
        if (array_diff(array_keys($border), ['widthCm', 'color', 'customColor', 'perSide', 'widthsBySide', 'segmentWidths']) !== []) $this->fail('Edging contains unknown fields.', "project.products.$index.border");
        if (array_key_exists('segmentWidths', $border) && array_key_exists('widthsBySide', $border)) $this->fail('Provide only one per-side edging field.', "project.products.$index.border");
        if (isset($border['perSide']) && !is_bool($border['perSide'])) $this->fail('Per-side edging must be a boolean.', "project.products.$index.border.perSide");
        $width = $this->number($border['widthCm'] ?? null, "project.products.$index.border.widthCm");
        $range = $config['ranges']['borderWidthCm'] ?? ['min' => 7, 'max' => 15];
        if ($width < ($range['min'] ?? 7) || $width > ($range['max'] ?? 15)) $this->fail('Edging width is out of range.', "project.products.$index.border.widthCm");
        $color = $border['color'] ?? null;
        if ($color === 'custom') $color = $border['customColor'] ?? null;
        if (!in_array($color, ['white', 'brown', 'gray'], true) && (!is_string($color) || preg_match('/^#[0-9a-f]{6}$/i', $color) !== 1)) $this->fail('Invalid edging color.', "project.products.$index.border.color");
        $normalizedBorder = ['widthCm' => $width, 'color' => $color];
        if (isset($border['perSide'])) $normalizedBorder['perSide'] = $border['perSide'];
        $sourceField = array_key_exists('segmentWidths', $border) ? 'segmentWidths' : (array_key_exists('widthsBySide', $border) ? 'widthsBySide' : null);
        if ($sourceField !== null) {
            if (!is_array($border[$sourceField]) || ($border[$sourceField] !== [] && array_is_list($border[$sourceField]))) $this->fail('Per-side edging is not allowed.', "project.products.$index.border.$sourceField");
            $sideIds = array_column($geometry['sides'], 'id');
            $normalizedBorder['segmentWidths'] = [];
            foreach ($border[$sourceField] as $side => $value) {
                if (!in_array((string) $side, $sideIds, true)) $this->fail('Unknown edging segment.', "project.products.$index.border.$sourceField.$side");
                $sideWidth = $this->number($value, "project.products.$index.border.$sourceField.$side");
                if ($sideWidth < ($range['min'] ?? 7) || $sideWidth > ($range['max'] ?? 15)) $this->fail('Segment width is out of range.', "project.products.$index.border.$sourceField.$side");
                $normalizedBorder['segmentWidths'][(string) $side] = $sideWidth;
            }
        }
        if (($border['color'] ?? null) === 'custom') $normalizedBorder['colorPreset'] = 'custom';
        $extras = $product['extras'] ?? [];
        if (!is_array($extras) || array_is_list($extras)) $this->fail('Invalid extra options.', "project.products.$index.extras");
        if (array_diff(array_keys($extras), ['weightBar', 'flashing', 'hookStrapKits']) !== []) $this->fail('Extra options contain unknown fields.', "project.products.$index.extras");
        foreach (['weightBar', 'flashing'] as $field) if (isset($extras[$field]) && !is_bool($extras[$field])) $this->fail('The extra option must be a boolean.', "project.products.$index.extras.$field");
        $hookStrapKits = $this->number($extras['hookStrapKits'] ?? 0, "project.products.$index.extras.hookStrapKits");
        if ($hookStrapKits !== floor($hookStrapKits) || $hookStrapKits < 0 || $hookStrapKits === 1.0 || $hookStrapKits > 1000) $this->fail('Hook and strap kits require a minimum of 2 kits.', "project.products.$index.extras.hookStrapKits");
        if ($hookStrapKits > 0 && !in_array('hook-strap-kit', $config['availableOptions']['hardware'] ?? self::HARDWARE, true)) $this->fail('Hook and strap kit is currently unavailable.', "project.products.$index.extras.hookStrapKits");
        $normalizedExtras = ['weightBar' => (!$hasSideHardware && $hardware === 'weight-bar') || ($extras['weightBar'] ?? false) === true, 'flashing' => ($extras['flashing'] ?? false) === true, 'hookStrapKits' => (int) $hookStrapKits];

        $this->requireTariff($config, "materials.$material", $missing);
        foreach (array_keys($geometry['fasteners']['byHardware']) as $kind) $this->requireTariff($config, "hardware.$kind", $missing);
        if ($type === 'door') $this->requireTariff($config, 'zipperPerMeter', $missing);
        if ($normalizedExtras['weightBar']) $this->requireTariff($config, 'weightBarPerMeter', $missing);
        if ($normalizedExtras['flashing']) $this->requireTariff($config, 'flashingPerMeter', $missing);
        if ($normalizedExtras['hookStrapKits'] > 0) $this->requireTariff($config, 'hardware.hook-strap-kit', $missing);
        if (in_array($config['vat']['mode'] ?? 'off', ['additive', 'included'], true) && (float) ($config['vat']['ratePercent'] ?? 0) <= 0) $missing[] = 'vat.ratePercent';

        $normalizedProduct = array_replace($product, [
            'purpose' => $purpose, 'border' => $normalizedBorder, 'extras' => $normalizedExtras, 'geometry' => $geometry,
        ], $type === 'door' ? ['zipperMode' => $zipperMode] : []);
        unset($normalizedProduct['zipperSide']);
        return $normalizedProduct;
    }

    /** @param array<string, mixed> $product @param array<string, mixed> $config @return array<string, mixed> */
    private function geometry(array $product, array $config, int $index): array
    {
        $shape = (string) $product['shape'];
        $input = $product['dimensions'] ?? null;
        if (!is_array($input) || array_is_list($input)) $this->fail('Dimensions are missing.', "project.products.$index.dimensions");
        if (array_diff(array_keys($input), self::SHAPES[$shape]) !== []) $this->fail('Dimensions contain unknown fields.', "project.products.$index.dimensions");
        $d = [];
        foreach (self::SHAPES[$shape] as $name) $d[$name] = $this->number($input[$name] ?? null, "project.products.$index.dimensions.$name");
        $limits = $config['ranges']['dimensions'] ?? ['min' => 20, 'max' => 1500, 'minSegment' => 5];
        foreach (['width', 'height'] as $name) if ($d[$name] < $limits['min'] || $d[$name] > $limits['max']) $this->fail('Dimension is out of range.', "project.products.$index.dimensions.$name");
        $min = (float) $limits['minSegment'];
        $between = function (string $name, float $low, float $high) use ($d, $index): void {
            if ($d[$name] < $low || $d[$name] > $high) $this->fail('Product geometry is invalid.', "project.products.$index.dimensions.$name");
        };
        if (in_array($shape, ['trapezoid-right', 'trapezoid-left'], true)) $between('wallHeight', $min, $d['height']);
        if ($shape === 'trapezoid-both') { $between('leftWallHeight', $min, $d['height']); $between('rightWallHeight', $min, $d['height']); }
        if ($shape === 'hexagon-peak') { $between('wallHeight', $min, $d['height'] - $min); $between('ridgeWidth', $min, $d['width'] - 2 * $min); }
        if ($shape === 't-shape') { $between('stemWidth', $min, $d['width'] - 2 * $min); $between('crossbarHeight', $min, $d['height'] - $min); }
        if ($shape === 'octagon') $between('cutSize', $min, (min($d['width'], $d['height']) - $min) / 2);
        [$points, $roles] = $this->polygon($shape, $d);
        $closed = [...$points, $points[0]];
        $sides = [];
        foreach ($roles as $i => $role) {
            $start = $closed[$i]; $end = $closed[$i + 1];
            $sides[] = ['id' => "$role-" . ($i + 1), 'role' => $role, 'start' => ['x' => $start[0], 'y' => $start[1]], 'end' => ['x' => $end[0], 'y' => $end[1]], 'lengthCm' => $this->decimal(hypot($end[0] - $start[0], $end[1] - $start[1]), 4)];
        }
        $area = 0.0;
        foreach ($points as $i => $point) { $next = $points[($i + 1) % count($points)]; $area += $point[0] * $next[1] - $next[0] * $point[1]; }
        if (abs($area) <= 0) $this->fail('Degenerate shape.', "project.products.$index.dimensions");
        return [
            'shape' => $shape,
            'polygon' => array_map(fn ($p): array => ['x' => $p[0], 'y' => $p[1]], $closed),
            'sides' => $sides,
            'areaM2' => $this->decimal(abs($area / 2) / 10000, 4),
            'perimeterM' => $this->decimal(array_sum(array_column($sides, 'lengthCm')) / 100, 4),
            'fasteners' => $this->fasteners($sides, $product, $config, $index),
        ];
    }

    /** @param array<string, float> $d @return array{0: list<array{0: float, 1: float}>, 1: list<string>} */
    private function polygon(string $shape, array $d): array
    {
        $w = $d['width']; $h = $d['height'];
        return match ($shape) {
            'rectangle' => [[[0, 0], [$w, 0], [$w, $h], [0, $h]], ['top', 'right', 'bottom', 'left']],
            'trapezoid-right' => [[[0, 0], [$w, $h - $d['wallHeight']], [$w, $h], [0, $h]], ['top', 'right', 'bottom', 'left']],
            'trapezoid-left' => [[[0, $h - $d['wallHeight']], [$w, 0], [$w, $h], [0, $h]], ['top', 'right', 'bottom', 'left']],
            'trapezoid-both' => [[[0, $h - $d['leftWallHeight']], [$w, $h - $d['rightWallHeight']], [$w, $h], [0, $h]], ['top', 'right', 'bottom', 'left']],
            'triangle-left' => [[[0, 0], [$w, $h], [0, $h]], ['top', 'bottom', 'left']],
            'triangle-right' => [[[$w, 0], [$w, $h], [0, $h]], ['right', 'bottom', 'top']],
            'hexagon-peak' => [[[0, $h], [0, $h - $d['wallHeight']], [($w - $d['ridgeWidth']) / 2, 0], [($w + $d['ridgeWidth']) / 2, 0], [$w, $h - $d['wallHeight']], [$w, $h]], ['left', 'top', 'top', 'top', 'right', 'bottom']],
            't-shape' => (function () use ($w, $h, $d): array { $l = ($w - $d['stemWidth']) / 2; $r = $l + $d['stemWidth']; return [[[0, 0], [$w, 0], [$w, $d['crossbarHeight']], [$r, $d['crossbarHeight']], [$r, $h], [$l, $h], [$l, $d['crossbarHeight']], [0, $d['crossbarHeight']]], ['top', 'right', 'bottom', 'right', 'bottom', 'left', 'bottom', 'left']]; })(),
            'octagon' => [[[$d['cutSize'], 0], [$w - $d['cutSize'], 0], [$w, $d['cutSize']], [$w, $h - $d['cutSize']], [$w - $d['cutSize'], $h], [$d['cutSize'], $h], [0, $h - $d['cutSize']], [0, $d['cutSize']]], ['top', 'top', 'right', 'right', 'bottom', 'bottom', 'left', 'left']],
        };
    }

    /** @param list<array<string, mixed>> $sides @param array<string, mixed> $product @return array<string, mixed> */
    private function fasteners(array $sides, array $product, array $config, int $index): array
    {
        $installation = $product['installation'] ?? null;
        if (!is_array($installation) || array_is_list($installation)) $this->fail('Installation is missing.', "project.products.$index.installation");
        if (array_diff(array_keys($installation), ['mode', 'edgeOffsetCm', 'spacingCm', 'replaceTopWithGrommets']) !== []) $this->fail('Installation contains unknown fields.', "project.products.$index.installation");
        if (isset($product['hardwareBySide'])) return $this->sideFasteners($sides, $product, $config, $installation, $index);
        if (isset($installation['replaceTopWithGrommets']) && !is_bool($installation['replaceTopWithGrommets'])) $this->fail('Top fastener replacement must be a boolean.', "project.products.$index.installation.replaceTopWithGrommets");
        $mode = $installation['mode'] ?? null;
        $allowedModes = ($product['type'] ?? null) === 'door' ? ['top', 'top-bottom'] : ['none', 'top', 'top-sides', 'top-bottom', 'all'];
        if (!in_array($mode, $allowedModes, true)) $this->fail('Invalid installation mode.', "project.products.$index.installation.mode");
        if ($mode === 'none' || ($product['hardware'] ?? null) === 'weight-bar') return ['total' => 0, 'positions' => [], 'bySide' => [], 'byHardware' => []];
        $spacing = $this->number($installation['spacingCm'] ?? null, "project.products.$index.installation.spacingCm");
        if (!in_array($spacing, [20.0, 30.0, 40.0], true)) $this->fail('Invalid fastener spacing.', "project.products.$index.installation.spacingCm");
        $automatic = ($installation['edgeOffsetCm'] ?? null) === 'auto';
        $offset = $automatic ? null : $this->number($installation['edgeOffsetCm'] ?? null, "project.products.$index.installation.edgeOffsetCm");
        if (!$automatic && ($offset < 3 || $offset > 15)) $this->fail('Invalid fastener offset.', "project.products.$index.installation.edgeOffsetCm");
        $roleMap = ['top' => ['top'], 'top-sides' => ['top', 'left', 'right'], 'top-bottom' => ['top', 'bottom'], 'all' => ['top', 'right', 'bottom', 'left']];
        $selected = $roleMap[$mode]; $bySide = []; $unique = [];
        foreach ($sides as $side) {
            if (!in_array($side['role'], $selected, true)) continue;
            $length = $side['lengthCm'];
            $count = $automatic ? max(1, (int) ceil($length / $spacing)) : ($length < 2 * $offset ? 0 : (int) ceil(($length - 2 * $offset) / $spacing) + 1);
            $hardware = (($installation['replaceTopWithGrommets'] ?? false) === true && $side['role'] === 'top') ? 'grommet' : $product['hardware'];
            $positions = [];
            for ($i = 0; $i < $count; $i++) {
                $distance = $automatic ? $length / $count * ($i + .5) : ($count === 1 ? $length / 2 : $offset + ($length - 2 * $offset) / ($count - 1) * $i);
                $ratio = $length === 0.0 ? 0.0 : $distance / $length;
                $position = ['sideId' => $side['id'], 'role' => $side['role'], 'hardware' => $hardware, 'distanceCm' => $this->decimal($distance, 4), 'x' => $this->decimal($side['start']['x'] + ($side['end']['x'] - $side['start']['x']) * $ratio, 4), 'y' => $this->decimal($side['start']['y'] + ($side['end']['y'] - $side['start']['y']) * $ratio, 4)];
                $positions[] = $position; $unique[$position['x'] . ':' . $position['y']] ??= $position;
            }
            $bySide[] = ['sideId' => $side['id'], 'role' => $side['role'], 'lengthCm' => $length, 'count' => count($positions), 'hardware' => $hardware, 'positions' => $positions];
        }
        $byHardware = [];
        foreach ($unique as $position) $byHardware[$position['hardware']] = ($byHardware[$position['hardware']] ?? 0) + 1;
        return ['total' => count($unique), 'positions' => array_values($unique), 'bySide' => $bySide, 'byHardware' => $byHardware];
    }

    /** @param list<array<string, mixed>> $sides @param array<string, mixed> $product @param array<string, mixed> $config @param array<string, mixed> $installation @return array<string, mixed> */
    private function sideFasteners(array $sides, array $product, array $config, array $installation, int $index): array
    {
        $map = $product['hardwareBySide'];
        if (!is_array($map) || array_is_list($map)) $this->fail('Per-side hardware is missing.', "project.products.$index.hardwareBySide");
        $spacing = $this->number($installation['spacingCm'] ?? null, "project.products.$index.installation.spacingCm");
        if (!in_array($spacing, [20.0, 30.0, 40.0], true)) $this->fail('Invalid fastener spacing.', "project.products.$index.installation.spacingCm");
        $automatic = ($installation['edgeOffsetCm'] ?? null) === 'auto';
        $offset = $automatic ? null : $this->number($installation['edgeOffsetCm'] ?? null, "project.products.$index.installation.edgeOffsetCm");
        if (!$automatic && ($offset < 3 || $offset > 15)) $this->fail('Invalid fastener offset.', "project.products.$index.installation.edgeOffsetCm");
        $known = array_column($sides, 'id');
        foreach (array_keys($map) as $sideId) if (!in_array((string) $sideId, $known, true)) $this->fail('Unknown product side.', "project.products.$index.hardwareBySide.$sideId");
        $purpose = ($product['type'] ?? null) === 'door' ? 'opening' : ($product['purpose'] ?? null);
        $compatible = $purpose === 'fixed' ? array_slice(self::SIDE_HARDWARE, 0, 4) : self::SIDE_HARDWARE;
        $available = array_values(array_intersect($compatible, $config['availableOptions']['hardware'] ?? $compatible));
        $positions = []; $bySide = []; $byHardware = [];
        foreach ($sides as $side) {
            $selected = $map[$side['id']] ?? [];
            if (!is_array($selected) || !array_is_list($selected)) $this->fail('Side hardware must be a list.', "project.products.$index.hardwareBySide." . $side['id']);
            $selected = array_values(array_unique($selected));
            foreach ($selected as $hardware) if (!is_string($hardware) || !in_array($hardware, $available, true)) $this->fail('Hardware is unavailable.', "project.products.$index.hardwareBySide." . $side['id']);
            $length = (float) $side['lengthCm'];
            $count = $automatic ? max(1, (int) ceil($length / $spacing)) : ($length < 2 * $offset ? 0 : (int) ceil(($length - 2 * $offset) / $spacing) + 1);
            foreach ($selected as $laneIndex => $hardware) {
                $lanePositions = [];
                for ($i = 0; $i < $count; $i++) {
                    $distance = $automatic ? $length / $count * ($i + .5) : ($count === 1 ? $length / 2 : $offset + ($length - 2 * $offset) / ($count - 1) * $i);
                    $ratio = $length === 0.0 ? 0.0 : $distance / $length;
                    $position = ['sideId' => $side['id'], 'role' => $side['role'], 'hardware' => $hardware, 'laneIndex' => $laneIndex, 'laneCount' => count($selected), 'distanceCm' => $this->decimal($distance, 4), 'x' => $this->decimal($side['start']['x'] + ($side['end']['x'] - $side['start']['x']) * $ratio, 4), 'y' => $this->decimal($side['start']['y'] + ($side['end']['y'] - $side['start']['y']) * $ratio, 4)];
                    $lanePositions[] = $position; $positions[] = $position;
                }
                $byHardware[$hardware] = ($byHardware[$hardware] ?? 0) + count($lanePositions);
                $bySide[] = ['sideId' => $side['id'], 'role' => $side['role'], 'lengthCm' => $length, 'count' => count($lanePositions), 'hardware' => $hardware, 'positions' => $lanePositions];
            }
        }
        return ['total' => count($positions), 'positions' => $positions, 'bySide' => $bySide, 'byHardware' => $byHardware];
    }

    /** @param array<string, mixed> $base @param array<string, mixed> $config @return array<string, mixed> */
    private function price(array $base, array $config): array
    {
        $lines = []; $priced = [];
        foreach ($base['products'] as $product) {
            $productLines = [];
            $this->addLine($productLines, $product, 'material', 'Material including edging', $product['geometry']['areaM2'], 'm2', $this->tariff($config, 'materials.' . $product['material']));
            foreach ($product['geometry']['fasteners']['byHardware'] as $hardware => $count) $this->addLine($productLines, $product, 'fastener', 'Fasteners - ' . $this->hardwareLabel((string) $hardware), $count, 'piece', $this->tariff($config, "hardware.$hardware"), ['option' => $hardware]);
            if ($product['type'] === 'door') $this->addLine($productLines, $product, 'zipper', 'Zipper', $this->zipperLength($product), 'm', $this->tariff($config, 'zipperPerMeter'));
            if ($product['extras']['weightBar']) $this->addLine($productLines, $product, 'weight-bar', 'Weight bar', $this->sideLength($product, 'bottom'), 'm', $this->tariff($config, 'weightBarPerMeter'));
            if ($product['extras']['flashing']) $this->addLine($productLines, $product, 'flashing', 'Bottom flashing, 20 cm', $this->sideLength($product, 'bottom'), 'm', $this->tariff($config, 'flashingPerMeter'));
            if ($product['extras']['hookStrapKits'] > 0) $this->addLine($productLines, $product, 'hook-strap-kit', 'Hook and strap', $product['extras']['hookStrapKits'], 'kit', $this->tariff($config, 'hardware.hook-strap-kit'));
            $surchargeBase = array_sum(array_column($productLines, 'amount'));
            foreach ([$config['tariffs']['surcharges']['shapes'][$product['shape']] ?? null, $config['tariffs']['surcharges']['products'][$product['type']] ?? null] as $surcharge) {
                if (!is_array($surcharge)) continue;
                $amount = ($surcharge['type'] ?? null) === 'percent' ? $this->money($surchargeBase * (float) $surcharge['value'] / 100) : $this->money((float) $surcharge['value']);
                $productLines[] = ['id' => $product['id'] . ':surcharge:' . (count($productLines) + 1), 'productId' => $product['id'], 'component' => 'surcharge', 'label' => $surcharge['label'] ?? 'Surcharge', 'quantity' => (float) $surcharge['value'], 'unit' => ($surcharge['type'] ?? null) === 'percent' ? 'percent' : 'fixed', 'unitPrice' => ($surcharge['type'] ?? null) === 'percent' ? $surchargeBase : null, 'amount' => $amount];
            }
            $subtotal = $this->money(array_sum(array_column($productLines, 'amount')));
            $priced[] = array_replace($product, ['subtotal' => $subtotal]);
            array_push($lines, ...$productLines);
        }
        $subtotal = $this->money(array_sum(array_column($lines, 'amount')));
        $mode = $config['vat']['mode'] ?? 'off'; $rate = (float) ($config['vat']['ratePercent'] ?? 0);
        $taxAmount = $mode === 'additive' ? $this->money($subtotal * $rate / 100) : ($mode === 'included' ? $this->money($subtotal * $rate / (100 + $rate)) : 0);
        if ($taxAmount > 0) $lines[] = ['id' => 'vat', 'productId' => null, 'component' => 'vat', 'label' => 'VAT', 'quantity' => $rate, 'unit' => 'percent', 'unitPrice' => null, 'amount' => $taxAmount, 'included' => $mode === 'included'];
        return array_replace($base, ['products' => $priced, 'status' => 'ready', 'statusText' => null, 'missingTariffs' => [], 'lineItems' => $lines, 'subtotal' => $subtotal, 'tax' => ['mode' => $mode, 'ratePercent' => $rate, 'amount' => $taxAmount], 'total' => $mode === 'additive' ? $this->money($subtotal + $taxAmount) : $subtotal]);
    }

    /** @param list<array<string, mixed>> $lines @param array<string, mixed> $product @param array<string, mixed> $extra */
    private function addLine(array &$lines, array $product, string $component, string $label, float|int $quantity, string $unit, float $unitPrice, array $extra = []): void
    {
        $lines[] = ['id' => $product['id'] . ":$component:" . (count($lines) + 1), 'productId' => $product['id'], 'component' => $component, 'label' => $label, 'quantity' => $this->decimal((float) $quantity, 4), 'unit' => $unit, 'unitPrice' => $unitPrice, 'amount' => $this->money((float) $quantity * $unitPrice)] + $extra;
    }

    private function money(float|int $value): float|int { return $this->moneyPrecision === 0 ? (int) round($value) : round($value, 2); }

    private function hardwareLabel(string $hardware): string
    {
        return [
            'grommet' => 'Grommets',
            'plastic-turn-button' => 'Plastic turn button',
            'metal-turn-button' => 'Metal turn button',
            'black-metal-turn-button' => 'Black metal turn button',
            'strap-bracket-45' => 'Bracket and strap',
            'hook-strap-kit' => 'Hook and strap',
        ][$hardware] ?? $hardware;
    }

    /** @param array<string, mixed> $product */
    private function sideLength(array $product, string $role): float
    {
        return array_sum(array_map(fn ($side): float => $side['role'] === $role ? $side['lengthCm'] / 100 : 0, $product['geometry']['sides']));
    }

    /** @param array<string, mixed> $product */
    private function zipperLength(array $product): float
    {
        return ((float) $product['dimensions']['height'] / 100) * ($product['zipperMode'] === 'both-sides' ? 2 : 1);
    }

    /** @param array<string, mixed> $config @param list<string> $missing */
    private function requireTariff(array $config, string $path, array &$missing): void
    {
        $value = $this->tariff($config, $path);
        if (!is_finite($value) || $value <= 0) $missing[] = $path;
    }

    /** @param array<string, mixed> $config */
    private function tariff(array $config, string $path): float
    {
        $value = $config['tariffs'] ?? [];
        foreach (explode('.', $path) as $key) $value = is_array($value) ? ($value[$key] ?? null) : null;
        return is_int($value) || is_float($value) ? (float) $value : NAN;
    }

    private function number(mixed $value, string $field): float
    {
        if (!is_int($value) && !is_float($value) || !is_finite((float) $value)) $this->fail('A number is required.', $field);
        return (float) $value;
    }

    private function decimal(float $value, int $precision): float
    {
        return round($value, $precision);
    }

    private function fail(string $message, string $field): never
    {
        throw new ApiException($message, 'INVALID_PROJECT', 422, [$field => $message]);
    }
}
