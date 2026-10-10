<?php
declare(strict_types=1);
require_once dirname(__DIR__, 3) . '/server/api/ServerPdfFont.php';
require_once dirname(__DIR__, 3) . '/server/api/ServerPdfDocument.php';
$quote = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
echo (new \BeyndaCalculator\QuoteApi\ServerPdfDocument())->build($quote);
