<?php

declare(strict_types=1);

use BeyndaCalculator\Mail\MailMessage;
use BeyndaCalculator\Mail\MailTransport;
use BeyndaCalculator\QuoteApi\ApiException;
use BeyndaCalculator\QuoteApi\IdempotencyStore;
use BeyndaCalculator\QuoteApi\QuoteCalculator;
use BeyndaCalculator\QuoteApi\QuotePdfRenderer;
use BeyndaCalculator\QuoteApi\QuoteRequestValidator;
use BeyndaCalculator\QuoteApi\QuoteService;
use BeyndaCalculator\QuoteApi\RateLimiter;

require_once dirname(__DIR__, 3) . '/server/api/bootstrap.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function requestFixture(): array
{
    return [
        'project' => ['version' => 1, 'products' => [[
            'id' => 'window-1', 'type' => 'window', 'shape' => 'rectangle', 'position' => 'right',
            'dimensions' => ['width' => 100, 'height' => 100], 'material' => 'clear-pvc-700',
            'purpose' => 'opening', 'hardware' => 'plastic-turn-button',
            'hardwareBySide' => ['top-1' => ['grommet', 'plastic-turn-button'], 'right-2' => [], 'bottom-3' => [], 'left-4' => []],
            'installation' => ['mode' => 'top', 'edgeOffsetCm' => 10, 'spacingCm' => 20, 'replaceTopWithGrommets' => false],
            'border' => ['widthCm' => 10, 'color' => 'white'], 'extras' => ['weightBar' => false, 'flashing' => false],
        ]]],
        'contact' => ['name' => 'Test User', 'phone' => '+7 000 000-00-00', 'email' => 'client@example.test', 'consent' => true],
        'honeypot' => '',
    ];
}

function codepointToUtf8(int $code): string
{
    if ($code <= 0x7F) return chr($code);
    if ($code <= 0x7FF) return chr(0xC0 | ($code >> 6)) . chr(0x80 | ($code & 0x3F));
    return chr(0xE0 | ($code >> 12)) . chr(0x80 | (($code >> 6) & 0x3F)) . chr(0x80 | ($code & 0x3F));
}

/** @return array{pageCount: int, pathCount: int, maxPathSegments: int, schematicCount: int, text: string} */
function parsePdfGraph(string $pdf, int $expectedPaths): array
{
    check(preg_match('/startxref\n(\d+)\n%%EOF/', $pdf, $start) === 1, 'startxref missing');
    $xrefOffset = (int) $start[1];
    check(substr($pdf, $xrefOffset, 4) === 'xref', 'startxref points to wrong offset');
    $xref = substr($pdf, $xrefOffset);
    check(preg_match('/^xref\n0 (\d+)\n([\s\S]*?)trailer <<([\s\S]*?)>>/', $xref, $table) === 1, 'xref table malformed');
    $entries = preg_split('/\r?\n/', trim($table[2])) ?: [];
    check(count($entries) === (int) $table[1], 'xref entry count mismatch');
    $offsets = [];
    foreach (array_slice($entries, 1) as $entry) { check(preg_match('/^(\d{10}) 00000 n ?$/', $entry, $match) === 1, 'xref entry malformed'); $offsets[] = (int) $match[1]; }
    $objects = [];
    foreach ($offsets as $index => $offset) {
        $id = $index + 1;
        check(str_starts_with(substr($pdf, $offset), "$id 0 obj"), 'xref object offset invalid');
        $end = $offsets[$index + 1] ?? $xrefOffset;
        $objects[$id] = substr($pdf, $offset, $end - $offset);
    }
    check(preg_match('/\/Root (\d+) 0 R/', $table[3], $rootRef) === 1 && isset($objects[(int) $rootRef[1]]), 'Catalog Root missing');
    $catalog = $objects[(int) $rootRef[1]];
    check(str_contains($catalog, '/Type /Catalog') && preg_match('/\/Pages (\d+) 0 R/', $catalog, $pagesRef) === 1, 'Catalog Pages missing');
    $pagesId = (int) $pagesRef[1]; $pagesRoot = $objects[$pagesId] ?? '';
    check(preg_match('/\/Count (\d+)/', $pagesRoot, $count) === 1 && preg_match('/\/Kids \[([^\]]*)\]/', $pagesRoot, $kids) === 1, 'Pages tree malformed');
    preg_match_all('/(\d+) 0 R/', $kids[1], $kidRefs);
    $pageIds = array_map('intval', $kidRefs[1]);
    check(count($pageIds) === (int) $count[1] && $pageIds !== [] && count(array_unique($pageIds)) === count($pageIds), 'Pages Count/Kids mismatch');

    $contentStreams = []; $fontIds = [];
    foreach ($pageIds as $pageId) {
        $page = $objects[$pageId] ?? '';
        check(str_contains($page, '/Type /Page ') && preg_match('/\/Parent (\d+) 0 R/', $page, $parent) === 1 && (int) $parent[1] === $pagesId, 'Page parent invalid');
        check(str_contains($page, '/MediaBox [0 0 595 842]'), 'Page is not A4');
        check(preg_match('/\/F1 (\d+) 0 R/', $page, $fontRef) === 1 && isset($objects[(int) $fontRef[1]]), 'Page font missing');
        check(preg_match('/\/Contents (\d+) 0 R/', $page, $contentRef) === 1 && isset($objects[(int) $contentRef[1]]), 'Page Contents missing');
        $fontIds[(int) $fontRef[1]] = true;
        $contentStreams[] = objectStream($objects[(int) $contentRef[1]]);
    }
    check(count($fontIds) === 1, 'Pages must share one font');
    $font = $objects[array_key_first($fontIds)];
    check(str_contains($font, '/Subtype /Type0') && str_contains($font, '/DescendantFonts') && preg_match('/\/ToUnicode (\d+) 0 R/', $font, $unicodeRef) === 1 && isset($objects[(int) $unicodeRef[1]]), 'reachable ToUnicode missing');
    $cmap = objectStream($objects[(int) $unicodeRef[1]]);
    preg_match_all('/<([0-9A-F]{4})> <([0-9A-F]{4})>/', $cmap, $mapping, PREG_SET_ORDER);
    $characters = [];
    foreach ($mapping as $row) $characters[hexdec($row[1])] = codepointToUtf8(hexdec($row[2]));
    $decoded = []; $pathCount = 0; $maxPathSegments = 0; $schematicCount = 0;
    foreach ($contentStreams as $stream) {
        preg_match_all('/<([0-9A-F]+)> Tj/', $stream, $texts);
        foreach ($texts[1] as $hex) { $line = ''; foreach (str_split($hex, 4) as $code) $line .= $characters[hexdec($code)] ?? '?'; $decoded[] = $line; }
        preg_match_all('/q 0\.08 0\.34 0\.29 RG 1\.4 w (?:-?\d+(?:\.\d+)? ){2}m (?:(?:-?\d+(?:\.\d+)? ){2}l ){2,}h S Q/', $stream, $paths);
        $pathCount += count($paths[0]);
        foreach ($paths[0] as $path) $maxPathSegments = max($maxPathSegments, substr_count($path, ' l '));
        $schematicCount += substr_count($stream, '% WC_SCHEMATIC_START');
    }
    check($pathCount === $expectedPaths, 'one reachable thumbnail path per product required');
    return ['pageCount' => count($pageIds), 'pathCount' => $pathCount, 'maxPathSegments' => $maxPathSegments, 'schematicCount' => $schematicCount, 'text' => implode("\n", $decoded)];
}

function objectStream(string $object): string
{
    check(preg_match('/\/Length (\d+)[^>]*>>\nstream\n([\s\S]*?)\nendstream/', $object, $stream) === 1, 'reachable stream malformed');
    check(strlen($stream[2]) === (int) $stream[1], 'stream length mismatch');
    return $stream[2];
}

function expectPdfGraphFailure(string $pdf, int $paths, string $message): void
{
    try { parsePdfGraph($pdf, $paths); throw new RuntimeException($message); }
    catch (RuntimeException $error) { check($error->getMessage() !== $message, $message); }
}

$config = json_decode((string) file_get_contents(dirname(__DIR__, 3) . '/storage/config.json'), true, 64, JSON_THROW_ON_ERROR);
$config['tariffs']['materials']['clear-pvc-700'] = 1000;
$config['tariffs']['materials']['tinted-pvc-700'] = 1200;
foreach ($config['tariffs']['hardware'] as $key => $_) $config['tariffs']['hardware'][$key] = 10;
$config['tariffs']['zipperPerMeter'] = 30;
$config['tariffs']['weightBarPerMeter'] = 50;
$config['tariffs']['flashingPerMeter'] = 60;

$validator = new QuoteRequestValidator();
$decoded = $validator->decode(json_encode(['version' => 1] + requestFixture(), JSON_THROW_ON_ERROR));
check($decoded['contact']['email'] === 'client@example.test', 'contact validation failed');
try {
    $validator->decode(json_encode(['version' => 1] + array_replace(requestFixture(), ['contact' => ['name' => 'x', 'phone' => '1', 'email' => 'bad', 'consent' => false]]), JSON_THROW_ON_ERROR));
    throw new RuntimeException('invalid contact accepted');
} catch (ApiException $error) {
    check($error->errorCode === 'INVALID_CONTACT', 'wrong contact error');
}

$quote = (new QuoteCalculator())->calculate($decoded['project'], $config);
check($quote['status'] === 'ready' && $quote['total'] === 1100, 'server quote did not recalculate known total');
check($quote['products'][0]['geometry']['fasteners']['byHardware'] === ['grommet' => 5, 'plastic-turn-button' => 5], 'side hardware was not calculated independently');
check(array_column(array_values(array_filter($quote['lineItems'], fn ($line): bool => $line['component'] === 'fastener')), 'label') === ['Fasteners - Grommets', 'Fasteners - Plastic turn button'], 'hardware price rows are not named');
$quote['products'][0]['extras']['hookStrapKits'] = 2;
$segmentProject = $decoded['project'];
$segmentProject['products'][0]['border']['segmentWidths'] = ['top-1' => 15];
$legacyProject = $decoded['project'];
$legacyProject['products'][0]['border']['widthsBySide'] = ['top-1' => 15];
$segmentQuote = (new QuoteCalculator())->calculate($segmentProject, $config);
$legacyQuote = (new QuoteCalculator())->calculate($legacyProject, $config);
check($segmentQuote['total'] === 1100 && $legacyQuote['total'] === 1100, 'border aliases price differently');
check($segmentQuote['products'][0]['border']['segmentWidths'] === $legacyQuote['products'][0]['border']['segmentWidths'], 'border aliases did not normalize');
check(!isset($legacyQuote['products'][0]['border']['widthsBySide']), 'legacy border field leaked into Quote');
try {
    $conflict = $segmentProject; $conflict['products'][0]['border']['widthsBySide'] = ['top-1' => 15];
    (new QuoteCalculator())->calculate($conflict, $config);
    throw new RuntimeException('conflicting border aliases accepted');
} catch (ApiException $error) { check($error->errorCode === 'INVALID_PROJECT', 'wrong border conflict error'); }
$malicious = $decoded['project'];
$malicious['products'][0]['subtotal'] = 1;
try {
    (new QuoteCalculator())->calculate($malicious, $config);
    throw new RuntimeException('client price was trusted');
} catch (ApiException $error) {
    check($error->errorCode === 'INVALID_PROJECT', 'wrong project error');
}

$pdf = (new QuotePdfRenderer())->render($quote);
check(str_starts_with($pdf, '%PDF-1.7'), 'invalid server PDF');
$parsedPdf = parsePdfGraph($pdf, count($quote['products']));
$pdfText = preg_replace('/\s+/u', ' ', $parsedPdf['text']);
$fieldMatrix = ['DRAWING' => $parsedPdf['schematicCount'] === count($quote['products'])];
foreach (['BEYNDA', $quote['quoteNumber'], 'POSITION', 'DIMENSIONS', 'SIDE GEOMETRY', 'PURPOSE', 'MATERIAL', 'HARDWARE', 'SIDE №1', '5 POSITIONS', '10 ELEMENTS', 'EDGING', 'OFFSET', 'SPACING', 'BOTTOM SIDE', 'PRICE', 'GRAND TOTAL'] as $expected) $fieldMatrix[$expected] = str_contains($pdfText, $expected);
check(str_contains($pdfText, 'SIDE №1 (TOP)'), 'PDF side labels are not translated');
check(!str_contains($pdfText, 'TOP-1'), 'internal English side id leaked into PDF');
check(substr_count($pdf, '% WC_SCHEMATIC_HOOK_STRAP') === 2, 'hook-strap kits are missing from the PDF schematic');
foreach ($fieldMatrix as $field => $present) check($present, "PDF field missing: $field");
$withoutKids = preg_replace_callback('/\/Kids \[([^\]]*)\]/', fn ($m): string => '/Kids [' . str_repeat(' ', strlen($m[1])) . ']', $pdf, 1);
$withoutContents = preg_replace_callback('/\/Contents \d+ 0 R/', fn ($m): string => '/Contents ' . str_repeat(' ', strlen($m[0]) - 10), $pdf, 1);
$withoutPath = preg_replace_callback('/q 0\.08 0\.34 0\.29 RG 1\.4 w (?:-?\d+(?:\.\d+)? ){2}m (?:(?:-?\d+(?:\.\d+)? ){2}l ){2,}h S Q/', fn ($m): string => str_repeat(' ', strlen($m[0])), $pdf, 1);
expectPdfGraphFailure((string) $withoutKids, 1, 'PDF without Kids passed');
expectPdfGraphFailure((string) $withoutContents, 1, 'PDF without Contents passed');
expectPdfGraphFailure((string) $withoutPath, 1, 'PDF without thumbnail path passed');
$many = $decoded['project'];
$many['products'] = [];
for ($i = 1; $i <= 10; $i++) { $product = $decoded['project']['products'][0]; $product['id'] = "window-$i"; $many['products'][] = $product; }
$many['products'][4]['shape'] = 't-shape';
$many['products'][4]['dimensions'] = ['width' => 320, 'height' => 260, 'stemWidth' => 120, 'crossbarHeight' => 80];
unset($many['products'][4]['hardwareBySide']);
$many['products'][] = [
    'id' => 'door-1', 'type' => 'door', 'shape' => 'rectangle', 'position' => 'left',
    'dimensions' => ['width' => 100, 'height' => 200], 'material' => 'tinted-pvc-700',
    'hardware' => 'metal-turn-button', 'zipperMode' => 'both-sides',
    'installation' => ['mode' => 'top-bottom', 'edgeOffsetCm' => 'auto', 'spacingCm' => 40, 'replaceTopWithGrommets' => true],
    'border' => ['widthCm' => 10, 'color' => 'brown', 'segmentWidths' => ['top-1' => 12]],
    'extras' => ['weightBar' => false, 'flashing' => true],
];
$manyPdf = (new QuotePdfRenderer())->render((new QuoteCalculator())->calculate($many, $config));
$manyParsed = parsePdfGraph($manyPdf, count($many['products']));
check($manyParsed['pageCount'] > 1, 'long quote was not paginated');
check($manyParsed['maxPathSegments'] >= 7, 'complex geometry thumbnail was simplified to a rectangle');
check(str_contains($manyParsed['text'], 'PRODUCT 10'), 'last product missing from multipage PDF');
$manyText = preg_replace('/\s+/u', ' ', $manyParsed['text']);
foreach (['ZIPPER', 'EDGING BY SIDE', 'AUTO', 'SPACING', 'BOTTOM FLASHING, 20 CM'] as $expected) check(str_contains($manyText, $expected), "multipage PDF field missing: $expected");
check(str_contains($manyText, 'BOTH SIDES'), 'door zipper layout missing from PDF');

$directory = sys_get_temp_dir() . '/beynda-quote-' . bin2hex(random_bytes(8));
mkdir($directory, 0770, true);
try {
    $transport = new class implements MailTransport {
        /** @var list<MailMessage> */ public array $messages = [];
        public function send(MailMessage $message): void { $this->messages[] = $message; }
    };
    $store = new IdempotencyStore($directory . '/idempotency.json', 'idempotency-test-salt');
    $service = new QuoteService(new QuoteCalculator(), new QuotePdfRenderer(), $transport, $store);
    $first = $service->deliver($decoded, $config, '123e4567-e89b-42d3-a456-426614174000');
    $second = $service->deliver($decoded, $config, '123e4567-e89b-42d3-a456-426614174000');
    check(count($transport->messages) === 2, 'idempotency allowed duplicate mail');
    check($transport->messages[0]->recipient === 'quotes@example.invalid', 'company recipient is not fixed');
    check($transport->messages[1]->recipient === 'client@example.test', 'client recipient missing');
    check($transport->messages[0]->pdfBytes === $transport->messages[1]->pdfBytes, 'recipients got different PDFs');
    check($transport->messages[0]->quoteNumber === $transport->messages[1]->quoteNumber, 'recipients got different quote numbers');
    check($first === $second, 'cached response changed');

    $flaky = new class implements MailTransport {
        /** @var list<MailMessage> */ public array $messages = [];
        private bool $failed = false;
        public function send(MailMessage $message): void {
            if ($message->recipientKind === 'client' && !$this->failed) { $this->failed = true; throw new RuntimeException('simulated transport failure'); }
            $this->messages[] = $message;
        }
    };
    $retryService = new QuoteService(new QuoteCalculator(), new QuotePdfRenderer(), $flaky, $store);
    $retryKey = '323e4567-e89b-42d3-a456-426614174000';
    try { $retryService->deliver($decoded, $config, $retryKey); } catch (RuntimeException) {}
    $retryService->deliver($decoded, $config, $retryKey);
    check(count(array_filter($flaky->messages, fn (MailMessage $message): bool => $message->recipientKind === 'company')) === 1, 'partial retry duplicated company mail');
    check(count(array_filter($flaky->messages, fn (MailMessage $message): bool => $message->recipientKind === 'client')) === 1, 'partial retry did not deliver client mail exactly once');

    $limiter = new RateLimiter($directory . '/limits.json', 'ip-hash-test-salt', 2, 600);
    check($limiter->reserve('203.0.113.42') && $limiter->reserve('203.0.113.42') && !$limiter->reserve('203.0.113.42'), 'rate limit failed');
    check(!str_contains((string) file_get_contents($directory . '/limits.json'), '203.0.113.42'), 'raw IP was stored');
    $corruptPath = $directory . '/corrupt.json';
    file_put_contents($corruptPath, '{broken');
    try { (new RateLimiter($corruptPath, 'corrupt-state-salt'))->reserve('203.0.113.9'); throw new RuntimeException('corrupt state failed open'); }
    catch (RuntimeException $error) { check($error->getMessage() !== 'corrupt state failed open', 'corrupt state was silently reset'); }
    check(file_get_contents($corruptPath) === '{broken', 'failed state read overwrote prior state');
    $state = (string) file_get_contents($directory . '/idempotency.json');
    check(!str_contains($state, 'client@example.test') && !str_contains($state, 'Test'), 'contacts were stored');
} finally {
    foreach (glob($directory . '/*') ?: [] as $path) @unlink($path);
    @rmdir($directory);
}

echo "QUOTE_PHP_SMOKE_OK\n";
