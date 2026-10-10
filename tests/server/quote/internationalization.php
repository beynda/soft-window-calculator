<?php
declare(strict_types=1);
require_once dirname(__DIR__, 3) . '/server/api/ApiException.php';
require_once dirname(__DIR__, 3) . '/server/api/QuoteCalculator.php';
$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$quote = (new \BeyndaCalculator\QuoteApi\QuoteCalculator())->calculate($input['project'], $input['config']);
echo json_encode($quote, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
