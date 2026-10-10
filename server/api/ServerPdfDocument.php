<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

require_once dirname(__DIR__) . '/config/Presentation.php';

final class ServerPdfDocument
{
    private array $presentation = ['language'=>'en', 'units'=>'cm', 'market'=>'RUB'];
    /** @param array<string, mixed> $quote */
    public function build(array $quote): string
    {
        $this->presentation = $quote['presentation'] ?? ['language'=>'en', 'units'=>'cm', 'market'=>$quote['currency']];
        $body = $this->quoteLines($quote);
        $chunks = [[]];
        foreach ($body as $line) {
            $pageIndex = count($chunks) - 1;
            $remaining = 43 - count($chunks[$pageIndex]);
            if ((str_starts_with($line, '[[THUMBNAIL:') && $remaining < 10) || $remaining < 1) {
                $chunks[] = [];
                $pageIndex++;
            }
            $chunks[$pageIndex][] = $line;
        }
        $pages = [];
        foreach ($chunks as $index => $chunk) {
            $pages[] = ['BEYNDA', 'QUOTE ' . $quote['quoteNumber'] . '   DATE: ' . substr((string) $quote['createdAt'], 0, 10), '', ...$chunk, '', 'PAGE ' . ($index + 1) . ' OF ' . count($chunks)];
        }
        foreach ($pages as &$page) { foreach ($page as &$line) { if (!str_starts_with($line, '[[THUMBNAIL:')) $line = \BeyndaCalculator\Config\presentText($line, $this->presentation); } unset($line); } unset($page);
        return $this->serialize($pages, $quote);
    }

    /** @param array<string, mixed> $quote @return list<string> */
    private function quoteLines(array $quote): array
    {
        $lines = [];
        foreach ($quote['products'] as $index => $product) {
            $lines[] = '[[THUMBNAIL:' . $index . ']]';
            $lines[] = sprintf('PRODUCT %d: %s; POSITION: %s; SHAPE: %s', $index + 1, $product['type'] === 'door' ? 'SOFT DOOR' : 'SOFT WINDOW', $this->value($product['position']), $this->value($product['shape']));
            $dimensions = [];
            foreach ($product['dimensions'] as $name => $value) $dimensions[] = $this->value((string) $name) . ': ' . $this->number($value) . ' CM';
            $lines[] = 'DIMENSIONS: ' . implode(', ', $dimensions);
            $lines[] = 'AREA: ' . $this->number($product['geometry']['areaM2']) . ' M2; PERIMETER: ' . $this->number($product['geometry']['perimeterM']) . ' M';
            $sides = [];
            foreach ($product['geometry']['sides'] as $sideIndex => $side) $sides[] = $this->sideDescription($product, (string) $side['id']) . '=' . $this->number($side['lengthCm']) . ' CM';
            $lines[] = 'SIDE GEOMETRY: ' . implode(', ', $sides);
            $purpose = $product['type'] === 'door' ? 'DOOR' : $this->value($product['purpose']);
            $lines[] = 'PURPOSE: ' . $purpose . '; MATERIAL: ' . $this->value($product['material']);
            $hardwareRows = [];
            if (isset($product['hardwareBySide']) && is_array($product['hardwareBySide'])) {
                $sideNumbers = [];
                foreach ($product['geometry']['sides'] as $sideIndex => $side) $sideNumbers[$side['id']] = $sideIndex + 1;
                foreach ($product['hardwareBySide'] as $sideId => $selected) {
                    if (!is_array($selected) || $selected === []) continue;
                    $hardwareRows[] = 'SIDE №' . ($sideNumbers[$sideId] ?? $sideId) . ': ' . implode(', ', array_map(fn ($hardware): string => $this->value((string) $hardware), $selected));
                }
            } else {
                $hardwareRows[] = $this->value((string) $product['hardware']);
            }
            $lines[] = 'HARDWARE: ' . ($hardwareRows === [] ? 'NO FASTENERS' : implode('; ', $hardwareRows)) . '; QUANTITY: ' . $this->fastenerCountText($product['geometry']['fasteners']);
            $install = $product['installation'];
            $offset = $install['edgeOffsetCm'] === 'auto' ? 'AUTO' : $this->number($install['edgeOffsetCm']) . ' CM';
            $lines[] = 'SPACING: ' . $this->number($install['spacingCm']) . ' CM; OFFSET: ' . $offset;
            $border = $product['border'];
            $hasSegmentWidths = isset($border['segmentWidths']) && is_array($border['segmentWidths']) && $border['segmentWidths'] !== [];
            $borderLine = $hasSegmentWidths
                ? 'EDGING COLOR: ' . $this->value($border['color'])
                : 'EDGING: ' . $this->number($border['widthCm']) . ' CM; COLOR: ' . $this->value($border['color']);
            if ($hasSegmentWidths) {
                $parts = [];
                foreach ($border['segmentWidths'] as $side => $width) $parts[] = $this->sideDescription($product, (string) $side) . ': ' . $this->number($width) . ' CM';
                $borderLine .= '; EDGING BY SIDE: ' . implode(', ', $parts);
            }
            $lines[] = $borderLine;
            if ($product['type'] === 'door') $lines[] = 'ZIPPER LAYOUT: ' . $this->zipperMode((string) $product['zipperMode']);
            $lines[] = 'BOTTOM SIDE: WEIGHT BAR: ' . ($product['extras']['weightBar'] ? 'YES' : 'NO') . '; FLASHING 20 CM: ' . ($product['extras']['flashing'] ? 'YES' : 'NO');
            $lines[] = 'HOOK AND STRAP: ' . (($product['extras']['hookStrapKits'] ?? 0) > 0 ? ((int) $product['extras']['hookStrapKits']) . ' KITS.' : 'NO');
            foreach ($quote['lineItems'] as $item) {
                if ($item['productId'] !== $product['id']) continue;
                $lines[] = $this->priceLine($item, (string) $quote['currency']);
            }
            $lines[] = 'PRODUCT SUBTOTAL: ' . $this->number($product['subtotal']) . ' ' . $quote['currency'];
            $lines[] = '';
        }
        foreach ($quote['lineItems'] as $item) if ($item['productId'] === null) $lines[] = $this->priceLine($item, (string) $quote['currency']);
        $lines[] = 'VAT: ' . $this->value((string) $quote['tax']['mode']) . '; RATE: ' . $this->number($quote['tax']['ratePercent']) . '%; AMOUNT: ' . $this->number($quote['tax']['amount']) . ' ' . $quote['currency'];
        $lines[] = 'GRAND TOTAL: ' . $this->number($quote['total']) . ' ' . $quote['currency'];
        $wrapped = [];
        foreach ($lines as $line) {
            if (str_starts_with($line, '[[THUMBNAIL:')) { $wrapped[] = $line; continue; }
            array_push($wrapped, ...$this->wrap($this->upper(\BeyndaCalculator\Config\presentText($line, $this->presentation)), 88));
        }
        return $wrapped;
    }

    /** @param list<list<string>> $pages @param array<string, mixed> $quote */
    private function serialize(array $pages, array $quote): string
    {
        $objects = [];
        $reserve = function () use (&$objects): int { $objects[] = null; return count($objects); };
        $set = function (int $id, string $value) use (&$objects): void { $objects[$id - 1] = $value; };
        $add = function (string $value) use (&$objects): int { $objects[] = $value; return count($objects); };
        $catalog = $reserve(); $pagesRoot = $reserve(); $font = $reserve(); $descendant = $reserve(); $descriptor = $reserve(); $fontFile = $reserve(); $cidMap = $reserve(); $toUnicode = $reserve();
        $chars = $this->characters($pages);
        $metrics = ServerPdfFont::metrics();
        $fontBytes = ServerPdfFont::bytes();
        $set($fontFile, $this->stream($fontBytes, '/Length1 ' . strlen($fontBytes)));
        $set($cidMap, $this->stream(base64_decode((string) $metrics['cidToGid'], true) ?: ''));
        $set($toUnicode, $this->stream($this->cmap($chars)));
        $set($descriptor, '<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [' . implode(' ', $metrics['bbox']) . '] /ItalicAngle 0 /Ascent ' . $metrics['ascent'] . ' /Descent ' . $metrics['descent'] . ' /CapHeight ' . $metrics['capHeight'] . ' /StemV 80 /FontFile2 ' . $fontFile . ' 0 R >>');
        $widths = [];
        foreach ($chars as $char) { $code = $this->codePoint($char); $widths[] = $code . ' [' . ($metrics['widths'][(string) $code] ?? $metrics['widths']['63'] ?? 600) . ']'; }
        $set($descendant, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' . $descriptor . ' 0 R /W [' . implode(' ', $widths) . '] /CIDToGIDMap ' . $cidMap . ' 0 R >>');
        $set($font, '<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [' . $descendant . ' 0 R] /ToUnicode ' . $toUnicode . ' 0 R >>');
        $pageIds = [];
        foreach ($pages as $lines) {
            $content = ''; $indentUntil = -1;
            foreach ($lines as $index => $line) {
                $y = 805 - $index * 16;
                if (preg_match('/^\[\[THUMBNAIL:(\d+)\]\]$/', $line, $thumbnail) === 1) {
                    $product = $quote['products'][(int) $thumbnail[1]] ?? null;
                    if (is_array($product)) $content .= $this->schematicPath($product, 42, $y + 5, 145, 125);
                    $indentUntil = $index + 8;
                    continue;
                }
                $hex = '';
                foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $char) $hex .= sprintf('%04X', isset($metrics['widths'][(string) $this->codePoint($char)]) ? $this->codePoint($char) : 63);
                $size = $index === 0 ? 15 : ($index === 1 ? 10 : 7.4);
                $x = $index <= $indentUntil ? 210 : 42;
                $content .= "BT /F1 $size Tf $x $y Td <$hex> Tj ET\n";
            }
            $contentId = $add($this->stream($content));
            $pageIds[] = $add('<< /Type /Page /Parent ' . $pagesRoot . ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' . $font . ' 0 R >> >> /Contents ' . $contentId . ' 0 R >>');
        }
        $set($pagesRoot, '<< /Type /Pages /Count ' . count($pageIds) . ' /Kids [' . implode(' ', array_map(fn ($id): string => "$id 0 R", $pageIds)) . '] >>');
        $set($catalog, '<< /Type /Catalog /Pages ' . $pagesRoot . ' 0 R >>');
        $pdf = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"; $offsets = [0];
        foreach ($objects as $index => $object) { $offsets[] = strlen($pdf); $pdf .= ($index + 1) . " 0 obj\n$object\nendobj\n"; }
        $xref = strlen($pdf); $pdf .= "xref\n0 " . (count($objects) + 1) . "\n0000000000 65535 f \n";
        foreach (array_slice($offsets, 1) as $offset) $pdf .= sprintf("%010d 00000 n \n", $offset);
        return $pdf . 'trailer << /Size ' . (count($objects) + 1) . ' /Root ' . $catalog . " 0 R >>\nstartxref\n$xref\n%%EOF\n";
    }

    /** @param list<list<string>> $pages @return list<string> */
    private function characters(array $pages): array { $set = ['?' => true, ' ' => true]; foreach ($pages as $page) foreach ($page as $line) foreach (preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $char) $set[$char] = true; return array_map(static fn ($char): string => (string) $char, array_keys($set)); }
    private function stream(string $data, string $extra = ''): string { return '<< /Length ' . strlen($data) . ($extra === '' ? '' : ' ' . $extra) . ">>\nstream\n$data\nendstream"; }

    private function glyph(string $char): string
    {
        $patterns = self::patterns(); $upper = $this->upper($char); $pattern = $patterns[$upper] ?? $patterns['?']; $result = "600 0 d0\n";
        foreach (explode('/', $pattern) as $row => $bits) foreach (str_split($bits) as $column => $bit) if ($bit === '1') $result .= ($column * 100 + 40) . ' ' . ((6 - $row) * 100) . " 84 84 re f\n";
        return $result;
    }

    /** @param array<string, mixed> $product */
    private function schematicPath(array $product, float $x, float $top, float $width, float $height): string
    {
        $geometry = is_array($product['geometry'] ?? null) ? $product['geometry'] : [];
        $polygon = $geometry['polygon'] ?? null;
        if (!is_array($polygon)) return '';
        $points = array_values(array_filter($polygon, fn ($point): bool => is_array($point) && is_numeric($point['x'] ?? null) && is_numeric($point['y'] ?? null)));
        if (count($points) > 1 && $points[0]['x'] === $points[count($points) - 1]['x'] && $points[0]['y'] === $points[count($points) - 1]['y']) array_pop($points);
        if (count($points) < 3) return '';

        $xs = array_map(fn ($point): float => (float) $point['x'], $points); $ys = array_map(fn ($point): float => (float) $point['y'], $points);
        $minX = min($xs); $maxX = max($xs); $minY = min($ys); $maxY = max($ys);
        $scale = min($width / max($maxX - $minX, 1.0), $height / max($maxY - $minY, 1.0));
        $originX = $x + ($width - ($maxX - $minX) * $scale) / 2;
        $originTop = $top - ($height - ($maxY - $minY) * $scale) / 2;
        $map = fn (array $point): array => [$originX + ((float) $point['x'] - $minX) * $scale, $originTop - ((float) $point['y'] - $minY) * $scale];
        $mapped = array_map($map, $points);

        $polygonPath = sprintf('%.2F %.2F m ', $mapped[0][0], $mapped[0][1]);
        foreach (array_slice($mapped, 1) as $point) $polygonPath .= sprintf('%.2F %.2F l ', $point[0], $point[1]);
        $path = "% WC_SCHEMATIC_START\nq 0.91 0.96 0.94 rg $polygonPath" . "h f Q\n";
        $path .= "q 0.08 0.34 0.29 RG 1.4 w $polygonPath" . "h S Q\n";

        $sides = is_array($geometry['sides'] ?? null) ? $geometry['sides'] : [];
        foreach ($sides as $index => $side) {
            if (!is_array($side) || !is_array($side['start'] ?? null) || !is_array($side['end'] ?? null)) continue;
            $start = $map($side['start']); $end = $map($side['end']);
            $widthCm = $product['border']['segmentWidths'][$side['id']] ?? $product['border']['widthsBySide'][$side['id']] ?? $product['border']['widthCm'] ?? 10;
            $stroke = max(3.0, (float) $widthCm * 0.32);
            $path .= sprintf("q 0.94 0.90 0.82 RG %.2F w %.2F %.2F m %.2F %.2F l S Q\n", $stroke, $start[0], $start[1], $end[0], $end[1]);
            $labelX = ($start[0] + $end[0]) / 2; $labelY = ($start[1] + $end[1]) / 2;
            $path .= sprintf("%% WC_SCHEMATIC_SIDE_LABEL\nq 1 1 1 rg %.2F %.2F 10 10 re f Q\nBT /F1 7 Tf %.2F %.2F Td <%s> Tj ET\n", $labelX - 5, $labelY - 5, $labelX - 2, $labelY - 2, $this->textHex((string) ($index + 1)));
        }

        $groups = [];
        foreach (($geometry['fasteners']['positions'] ?? []) as $position) {
            if (!is_array($position)) continue;
            $key = (string) ($position['sideId'] ?? '') . ':' . (string) ($position['distanceCm'] ?? '');
            $groups[$key][] = $position;
        }
        foreach ($groups as $positions) {
            foreach ($positions as $markerIndex => $position) {
                $point = $map($position);
                $side = null;
                foreach ($sides as $candidate) if (($candidate['id'] ?? null) === ($position['sideId'] ?? null)) { $side = $candidate; break; }
                if (is_array($side)) {
                    $start = $map($side['start']); $end = $map($side['end']);
                    $length = hypot($end[0] - $start[0], $end[1] - $start[1]) ?: 1.0;
                    $offset = ($markerIndex - (count($positions) - 1) / 2) * 4;
                    $point[0] += ($end[0] - $start[0]) / $length * $offset;
                    $point[1] += ($end[1] - $start[1]) / $length * $offset;
                }
                $path .= $this->schematicFastener((string) ($position['hardware'] ?? 'grommet'), $point[0], $point[1]);
            }
        }

        $hookStrapKits = max(0, (int) ($product['extras']['hookStrapKits'] ?? 0));
        $topSides = array_values(array_filter($sides, fn ($side): bool => ($side['role'] ?? null) === 'top'));
        $topLength = array_sum(array_map(fn ($side): float => hypot((float) $side['end']['x'] - (float) $side['start']['x'], (float) $side['end']['y'] - (float) $side['start']['y']), $topSides));
        for ($index = 0; $index < $hookStrapKits && $topLength > 0; $index++) {
            $distance = $topLength * ($index + 1) / ($hookStrapKits + 1);
            $target = $topSides[count($topSides) - 1];
            foreach ($topSides as $side) {
                $length = hypot((float) $side['end']['x'] - (float) $side['start']['x'], (float) $side['end']['y'] - (float) $side['start']['y']);
                if ($distance <= $length) { $target = $side; break; }
                $distance -= $length;
            }
            $length = hypot((float) $target['end']['x'] - (float) $target['start']['x'], (float) $target['end']['y'] - (float) $target['start']['y']) ?: 1.0;
            $ratio = min(1.0, $distance / $length);
            $point = $map([
                'x' => (float) $target['start']['x'] + ((float) $target['end']['x'] - (float) $target['start']['x']) * $ratio,
                'y' => (float) $target['start']['y'] + ((float) $target['end']['y'] - (float) $target['start']['y']) * $ratio,
            ]);
            $path .= sprintf("%% WC_SCHEMATIC_HOOK_STRAP\nq 0.31 0.37 0.35 RG 1.8 w %.2F %.2F m %.2F %.2F %.2F %.2F %.2F %.2F c %.2F %.2F %.2F %.2F %.2F %.2F c S Q\n", $point[0] + 4, $point[1] + 10, $point[0] - 5, $point[1] + 10, $point[0] - 5, $point[1] + 2, $point[0] + 1, $point[1] + 2, $point[0] + 5, $point[1] + 2, $point[0] + 4, $point[1] - 4, $point[0], $point[1] - 4);
        }

        foreach ($sides as $side) {
            if (($side['role'] ?? null) !== 'bottom') continue;
            $start = $map($side['start']); $end = $map($side['end']);
            if (($product['extras']['flashing'] ?? false) === true) $path .= sprintf("q 0.23 0.45 0.58 RG 2.4 w %.2F %.2F m %.2F %.2F l S Q\n", $start[0], $start[1] - 3, $end[0], $end[1] - 3);
            if (($product['extras']['weightBar'] ?? false) === true) $path .= sprintf("q 0.24 0.24 0.24 RG 2.4 w %.2F %.2F m %.2F %.2F l S Q\n", $start[0], $start[1] + 3, $end[0], $end[1] + 3);
        }
        if (($product['type'] ?? null) === 'door') {
            if (($product['zipperMode'] ?? null) === 'center') {
                $centerX = (min(array_column($mapped, 0)) + max(array_column($mapped, 0))) / 2;
                $path .= sprintf("q 0.83 0.45 0.08 RG 2 w %.2F %.2F m %.2F %.2F l S Q\n", $centerX, min(array_column($mapped, 1)), $centerX, max(array_column($mapped, 1)));
            } else {
                foreach ($sides as $side) if (in_array($side['role'] ?? null, ['left', 'right'], true)) {
                    $start = $map($side['start']); $end = $map($side['end']);
                    $path .= sprintf("q 0.83 0.45 0.08 RG 2 w %.2F %.2F m %.2F %.2F l S Q\n", $start[0], $start[1], $end[0], $end[1]);
                }
            }
        }
        return $path;
    }

    private function schematicFastener(string $hardware, float $x, float $y): string
    {
        $prefix = "% WC_SCHEMATIC_FASTENER\n";
        if ($hardware === 'plastic-turn-button') return $prefix . sprintf("q 0.95 0.63 0.11 rg 0.65 0.39 0 RG %.2F %.2F 4.8 4.8 re B Q\n", $x - 2.4, $y - 2.4);
        if ($hardware === 'metal-turn-button') return $prefix . sprintf("q 0.55 0.61 0.65 rg 0.26 0.32 0.37 RG %.2F %.2F m %.2F %.2F l %.2F %.2F l %.2F %.2F l h B Q\n", $x, $y + 3, $x + 3, $y, $x, $y - 3, $x - 3, $y);
        if ($hardware === 'black-metal-turn-button') return $prefix . sprintf("q 0.2 0.2 0.2 rg %.2F %.2F m %.2F %.2F l %.2F %.2F l h f Q\n", $x, $y + 3, $x + 3, $y - 2.6, $x - 3, $y - 2.6);
        if ($hardware === 'strap-bracket-45') return $prefix . sprintf("q 0.48 0.29 0.58 RG 2.5 w %.2F %.2F m %.2F %.2F l S Q\n", $x - 3.5, $y, $x + 3.5, $y);
        $radius = 2.5; $control = $radius * 0.55228475;
        return $prefix . sprintf("q 0.09 0.4 0.33 RG 1.2 w %.2F %.2F m %.2F %.2F %.2F %.2F %.2F %.2F c %.2F %.2F %.2F %.2F %.2F %.2F c %.2F %.2F %.2F %.2F %.2F %.2F c %.2F %.2F %.2F %.2F %.2F %.2F c S Q\n", $x + $radius, $y, $x + $radius, $y + $control, $x + $control, $y + $radius, $x, $y + $radius, $x - $control, $y + $radius, $x - $radius, $y + $control, $x - $radius, $y, $x - $radius, $y - $control, $x - $control, $y - $radius, $x, $y - $radius, $x + $control, $y - $radius, $x + $radius, $y - $control, $x + $radius, $y);
    }

    /** @param list<string> $chars */
    private function cmap(array $chars): string
    {
        $rows = [];
        foreach ($chars as $char) $rows[] = sprintf('<%04X> <%s>', $this->codePoint($char), $this->utf16Hex($char));
        return "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /BeyndaCalculator def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" . count($rows) . " beginbfchar\n" . implode("\n", $rows) . "\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
    }

    /** @return list<string> */
    private function wrap(string $text, int $limit): array
    {
        if ($text === '') return [''];
        $lines = []; $line = '';
        foreach (explode(' ', $text) as $word) {
            $candidate = $line === '' ? $word : "$line $word";
            if (count(preg_split('//u', $candidate, -1, PREG_SPLIT_NO_EMPTY) ?: []) <= $limit) { $line = $candidate; continue; }
            if ($line !== '') $lines[] = $line;
            $line = $word;
        }
        if ($line !== '') $lines[] = $line;
        return $lines;
    }
    private function upper(string $text): string { return strtr(strtoupper($text), ['а'=>'А','б'=>'Б','в'=>'В','г'=>'Г','д'=>'Д','е'=>'Е','ё'=>'Ё','ж'=>'Ж','з'=>'З','и'=>'И','й'=>'Й','к'=>'К','л'=>'Л','м'=>'М','н'=>'Н','о'=>'О','п'=>'П','р'=>'Р','с'=>'С','т'=>'Т','у'=>'У','ф'=>'Ф','х'=>'Х','ц'=>'Ц','ч'=>'Ч','ш'=>'Ш','щ'=>'Щ','ъ'=>'Ъ','ы'=>'Ы','ь'=>'Ь','э'=>'Э','ю'=>'Ю','я'=>'Я']); }
    private function textHex(string $text): string { $hex = ''; foreach (preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $char) $hex .= sprintf('%04X', $this->codePoint($char)); return $hex; }
    private function utf16Hex(string $char): string { $bytes = array_map('ord', str_split($char)); $code = count($bytes) === 1 ? $bytes[0] : (count($bytes) === 2 ? (($bytes[0] & 31) << 6) | ($bytes[1] & 63) : (($bytes[0] & 15) << 12) | (($bytes[1] & 63) << 6) | ($bytes[2] & 63)); return sprintf('%04X', $code); }
    private function codePoint(string $char): int { return (int) hexdec($this->utf16Hex($char)); }
    private function value(string $value): string { $labels = ['width'=>'WIDTH','height'=>'HEIGHT','wallHeight'=>'WALL HEIGHT','leftWallHeight'=>'LEFT WALL','rightWallHeight'=>'RIGHT WALL','ridgeWidth'=>'RIDGE WIDTH','stemWidth'=>'STEM WIDTH','crossbarHeight'=>'CROSSBAR HEIGHT','cutSize'=>'SLOPE SIZE','right'=>'RIGHT','left'=>'LEFT','top'=>'TOP','bottom'=>'BOTTOM','extension-45'=>'EXTENSION AT 45','opening'=>'OPENING','fixed'=>'FIXED','clear-pvc-700'=>'CLEAR PVC, 700 MICRONS','tinted-pvc-700'=>'TINTED PVC, 700 MICRONS','none'=>'TARPAULIN INSTEAD OF PVC FILM','grommet'=>'GROMMETS','plastic-turn-button'=>'PLASTIC TURN BUTTON','metal-turn-button'=>'METAL TURN BUTTON','black-metal-turn-button'=>'BLACK METAL TURN BUTTON','strap-bracket-45'=>'BRACKET AND STRAP','hook-strap-kit'=>'HOOK AND STRAP','weight-bar'=>'WEIGHT BAR','top-sides'=>'TOP AND SIDES','top-bottom'=>'TOP AND BOTTOM','all'=>'ALL SIDES','white'=>'WHITE','brown'=>'BROWN','gray'=>'GRAY']; return $labels[$value] ?? $this->upper(str_replace('_', ' ', $value)); }
    private function zipperMode(string $mode): string { return $mode === 'both-sides' ? 'BOTH SIDES' : 'CENTERED'; }
    /** @param array<string, mixed> $product */
    private function sideDescription(array $product, string $sideId): string
    {
        foreach (($product['geometry']['sides'] ?? []) as $index => $side) {
            if (($side['id'] ?? null) === $sideId) return 'SIDE №' . ($index + 1) . ' (' . $this->value((string) ($side['role'] ?? '')) . ')';
        }
        return 'SIDE';
    }
    private function unit(string $unit): string { return ['m2'=>'M2','m'=>'M','piece'=>'PCS.','kit'=>'KITS.','percent'=>'%','fixed'=>'FIXED.'][$unit] ?? $this->value($unit); }
    /** @param array<string, mixed> $item */
    private function priceLine(array $item, string $currency): string { $unitPrice = $item['unitPrice'] === null ? '' : ' X ' . $this->number($item['unitPrice']) . ' ' . $currency; $included = ($item['included'] ?? false) ? ' (INCLUDED)' : ''; return 'PRICE: ' . $item['label'] . ' - ' . $this->number($item['quantity']) . ' ' . $this->unit($item['unit']) . $unitPrice . ' = ' . $this->number($item['amount']) . ' ' . $currency . $included; }
    private function number(mixed $value): string { return rtrim(rtrim(number_format((float) $value, 4, '.', ''), '0'), '.'); }

    /** @param array<string, mixed> $fasteners */
    private function fastenerCountText(array $fasteners): string
    {
        $elements = max(0, (int) ($fasteners['total'] ?? 0));
        $positions = is_array($fasteners['positions'] ?? null) ? $fasteners['positions'] : [];
        if ($positions === []) return $elements . ' ' . $this->plural($elements, 'FASTENER', 'FASTENERS', 'FASTENERS');
        $unique = [];
        foreach ($positions as $position) $unique[(string) ($position['x'] ?? 0) . ':' . (string) ($position['y'] ?? 0)] = true;
        $positionCount = count($unique);
        if ($positionCount === $elements) return $elements . ' ' . $this->plural($elements, 'FASTENER', 'FASTENERS', 'FASTENERS');
        return $positionCount . ' ' . $this->plural($positionCount, 'POSITION', 'POSITIONS', 'POSITIONS') . ', ' . $elements . ' ' . $this->plural($elements, 'ELEMENT', 'ELEMENTS', 'ELEMENTS');
    }

    private function plural(int $value, string $one, string $few, string $many): string
    {
        return abs($value) === 1 ? $one : $many;
        if ($last === 1) return $one;
        if ($last >= 2 && $last <= 4) return $few;
        return $many;
    }

    /** @return array<string, string> */
    private static function patterns(): array
    {
        $l=['A'=>'01110/10001/10001/11111/10001/10001/10001','B'=>'11110/10001/10001/11110/10001/10001/11110','C'=>'01111/10000/10000/10000/10000/10000/01111','D'=>'11110/10001/10001/10001/10001/10001/11110','E'=>'11111/10000/10000/11110/10000/10000/11111','F'=>'11111/10000/10000/11110/10000/10000/10000','G'=>'01111/10000/10000/10111/10001/10001/01111','H'=>'10001/10001/10001/11111/10001/10001/10001','I'=>'11111/00100/00100/00100/00100/00100/11111','J'=>'00111/00010/00010/00010/10010/10010/01100','K'=>'10001/10010/10100/11000/10100/10010/10001','L'=>'10000/10000/10000/10000/10000/10000/11111','M'=>'10001/11011/10101/10101/10001/10001/10001','N'=>'10001/11001/10101/10011/10001/10001/10001','O'=>'01110/10001/10001/10001/10001/10001/01110','P'=>'11110/10001/10001/11110/10000/10000/10000','Q'=>'01110/10001/10001/10001/10101/10010/01101','R'=>'11110/10001/10001/11110/10100/10010/10001','S'=>'01111/10000/10000/01110/00001/00001/11110','T'=>'11111/00100/00100/00100/00100/00100/00100','U'=>'10001/10001/10001/10001/10001/10001/01110','V'=>'10001/10001/10001/10001/10001/01010/00100','W'=>'10001/10001/10001/10101/10101/10101/01010','X'=>'10001/10001/01010/00100/01010/10001/10001','Y'=>'10001/10001/01010/00100/00100/00100/00100','Z'=>'11111/00001/00010/00100/01000/10000/11111'];
        return $l+['А'=>$l['A'],'Б'=>'11110/10000/10000/11110/10001/10001/11110','В'=>$l['B'],'Г'=>'11111/10000/10000/10000/10000/10000/10000','Д'=>'01110/01010/01010/01010/10001/11111/10001','Е'=>$l['E'],'Ё'=>'01010/11111/10000/11110/10000/10000/11111','Ж'=>'10101/10101/01110/00100/01110/10101/10101','З'=>'11110/00001/00001/01110/00001/00001/11110','И'=>'10001/10011/10101/10101/11001/10001/10001','Й'=>'01010/00100/10001/10011/10101/11001/10001','К'=>$l['K'],'Л'=>'00111/01001/01001/01001/10001/10001/10001','М'=>$l['M'],'Н'=>$l['H'],'О'=>$l['O'],'П'=>'11111/10001/10001/10001/10001/10001/10001','Р'=>$l['P'],'С'=>$l['C'],'Т'=>$l['T'],'У'=>$l['Y'],'Ф'=>'00100/01110/10101/10101/01110/00100/00100','Х'=>$l['X'],'Ц'=>'10001/10001/10001/10001/10001/11111/00001','Ч'=>'10001/10001/10001/01111/00001/00001/00001','Ш'=>'10101/10101/10101/10101/10101/10101/11111','Щ'=>'10101/10101/10101/10101/10101/11111/00001','Ъ'=>'11000/01000/01000/01110/01001/01001/01110','Ы'=>'10001/10001/10001/10111/11001/11001/10111','Ь'=>'10000/10000/10000/11110/10001/10001/11110','Э'=>'01110/10001/00001/00111/00001/10001/01110','Ю'=>'10010/10101/10101/11101/10101/10101/10010','Я'=>'01111/10001/10001/01111/00101/01001/10001','0'=>'01110/10001/10011/10101/11001/10001/01110','1'=>'00100/01100/00100/00100/00100/00100/01110','2'=>'01110/10001/00001/00010/00100/01000/11111','3'=>'11110/00001/00001/01110/00001/00001/11110','4'=>'00010/00110/01010/10010/11111/00010/00010','5'=>'11111/10000/10000/11110/00001/00001/11110','6'=>'01110/10000/10000/11110/10001/10001/01110','7'=>'11111/00001/00010/00100/01000/01000/01000','8'=>'01110/10001/10001/01110/10001/10001/01110','9'=>'01110/10001/10001/01111/00001/00001/01110',' '=>'00000/00000/00000/00000/00000/00000/00000','?'=>'01110/10001/00001/00010/00100/00000/00100','.'=>'00000/00000/00000/00000/00000/01100/01100',','=>'00000/00000/00000/00000/01100/01100/01000',':'=>'00000/01100/01100/00000/01100/01100/00000','-'=>'00000/00000/00000/11111/00000/00000/00000','/'=>'00001/00010/00100/01000/10000/00000/00000','='=>'00000/11111/00000/11111/00000/00000/00000','('=>'00010/00100/01000/01000/01000/00100/00010',')'=>'01000/00100/00010/00010/00010/00100/01000',';'=>'00000/01100/01100/00000/01100/01100/01000'];
    }
}
