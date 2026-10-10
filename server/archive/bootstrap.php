<?php

declare(strict_types=1);

namespace BeyndaCalculator\Archive;

require_once __DIR__ . '/QuoteArchive.php';

function quoteArchive(): QuoteArchive
{
    static $archive;
    if ($archive instanceof QuoteArchive) return $archive;
    $configured = getenv('QUOTE_ARCHIVE_DIR');
    $directory = is_string($configured) && $configured !== '' ? $configured : dirname(__DIR__, 2) . '/storage/archive';
    return $archive = new QuoteArchive($directory);
}
