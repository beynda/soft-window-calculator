<?php

declare(strict_types=1);

use BeyndaCalculator\Archive\QuoteArchive;

require_once dirname(__DIR__, 3) . '/server/archive/QuoteArchive.php';

function ensureArchive(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$directory = sys_get_temp_dir() . '/beynda-archive-' . bin2hex(random_bytes(8));
$now = new DateTimeImmutable('2026-09-25T08:30:00+00:00');
$clock = static function () use (&$now): DateTimeImmutable { return $now; };

try {
    $archive = new QuoteArchive($directory, $clock);
    $request = [
        'project' => ['version' => 1, 'products' => [['id' => 'window-1']]],
        'contact' => ['name' => 'Test User', 'phone' => '+7 000 000-00-00', 'email' => 'manager@example.test', 'consent' => true],
    ];
    $quote = ['quoteNumber' => 'Q-TEST-1', 'total' => 12500, 'currency' => 'RUB', 'products' => [['id' => 'window-1']]];
    $archive->savePrepared($request, $quote, '%PDF-test', 'Q-TEST-1.pdf');
    $archive->markDelivery('Q-TEST-1', 'company', 'sent');
    $archive->markDelivery('Q-TEST-1', 'client', 'failed');

    $records = $archive->search('manager@example.test');
    ensureArchive(count($records) === 1, 'saved quote was not searchable');
    ensureArchive($records[0]['contact']['name'] === 'Test User', 'contact was not preserved');
    ensureArchive($records[0]['productCount'] === 1 && $records[0]['total'] === 12500, 'quote summary is incomplete');
    ensureArchive($records[0]['delivery']['company']['status'] === 'sent', 'company delivery was not tracked');
    ensureArchive($records[0]['delivery']['client']['status'] === 'failed', 'recipient delivery failure was not tracked');
    ensureArchive($records[0]['expiresAt'] === '2028-03-25T08:30:00+00:00', 'retention is not exactly 18 months');
    $pdf = $archive->pdf('Q-TEST-1');
    ensureArchive($pdf['bytes'] === '%PDF-test' && $pdf['filename'] === 'Q-TEST-1.pdf', 'protected PDF could not be read');

    $rows = [];
    for ($i = 0; $i < 105; $i++) {
        $row = $archive->record('Q-TEST-1');
        $row['quoteNumber'] = 'Q-PAGE-' . str_pad((string) $i, 3, '0', STR_PAD_LEFT);
        $row['pdfPath'] = 'Q-TEST-1.pdf';
        $row['contact']['name'] = $i === 0 ? 'Earliest record' : 'Test';
        $rows[$row['quoteNumber']] = $row;
    }
    // One isolated fixture database, no production storage.
    file_put_contents($directory . '/quotes.json', json_encode($rows));
    $now = new DateTimeImmutable('2026-10-09T00:00:00+00:00');
    $first = $archive->searchPage('', 1);
    ensureArchive(count($first['records']) === 10 && $first['total'] === 105 && $first['pages'] === 11, 'page size or total wrong');
    $last = $archive->searchPage('', 999);
    ensureArchive($last['page'] === 11 && count($last['records']) === 5, 'last page clamp wrong');
    ensureArchive($archive->searchPage('Earliest record', 1)['total'] === 1, 'search truncated at first 100');
    ensureArchive($archive->searchPage('nonexistent', 1)['records'] === [], 'empty search wrong');
    $now = new DateTimeImmutable('2028-03-26T00:00:00+00:00');
    ensureArchive($archive->search('') === [], 'expired quote was not deleted');
    ensureArchive(!is_file($directory . '/Q-TEST-1.pdf'), 'expired PDF was not deleted');
    echo "ARCHIVE_PHP_SMOKE_OK\n";
} finally {
    if (is_dir($directory)) {
        foreach (glob($directory . '/*') ?: [] as $path) if (is_file($path)) unlink($path);
        if (is_file($directory . '/.archive.lock')) unlink($directory . '/.archive.lock');
        rmdir($directory);
    }
}
