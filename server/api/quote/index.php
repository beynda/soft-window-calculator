<?php

declare(strict_types=1);

use BeyndaCalculator\QuoteApi\ApiException;
use BeyndaCalculator\QuoteApi\QuoteRequestValidator;

require_once dirname(__DIR__) . '/bootstrap.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        header('Allow: POST');
        throw new ApiException('Method not supported.', 'METHOD_NOT_ALLOWED', 405);
    }
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($contentType !== 'application/json') throw new ApiException('Expected application/json.', 'UNSUPPORTED_MEDIA_TYPE', 415);
    $length = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : null;
    if ($length !== null && $length > 262144) throw new ApiException('Request is too large.', 'INVALID_BODY', 413);
    $body = file_get_contents('php://input', false, null, 0, 262145);
    if ($body === false) throw new ApiException('Could not read the request.', 'INVALID_BODY');
    $request = (new QuoteRequestValidator())->decode($body);
    [$service, $limiter] = quoteDependencies();
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    if (!$limiter->reserve($ip)) throw new ApiException('Too many attempts. Try again later.', 'RATE_LIMITED', 429);
    if ($request['honeypot'] !== '') {
        http_response_code(202);
        echo json_encode(['ok' => true, 'accepted' => true], JSON_THROW_ON_ERROR);
        exit;
    }
    $idempotencyKey = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
    $response = $service->deliver($request, quoteConfigStore()->loadConfig(), (string) $idempotencyKey);
    http_response_code(201);
    echo json_encode($response, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (ApiException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['ok' => false, 'code' => $error->errorCode, 'message' => $error->getMessage(), 'fieldErrors' => $error->fieldErrors], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (Throwable) {
    http_response_code(503);
    echo json_encode(['ok' => false, 'code' => 'SERVICE_UNAVAILABLE', 'message' => 'Submission is temporarily unavailable. The form and PDF remain available.'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
}

