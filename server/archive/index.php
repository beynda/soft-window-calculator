<?php

declare(strict_types=1);

use function BeyndaCalculator\Archive\quoteArchive;

require_once __DIR__ . '/bootstrap.php';
require_once dirname(__DIR__) . '/api/bootstrap.php';
require_once dirname(__DIR__) . '/admin/bootstrap.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

try {
    \BeyndaCalculator\Admin\AdminAuth::startSession();
    $auth = \BeyndaCalculator\Admin\adminAuth();
    if (!$auth->isAuthenticated()) {
        throw new \BeyndaCalculator\QuoteApi\ApiException('Sign in at /admin/ to access the archive.', 'AUTH_REQUIRED', 401);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'POST') {
        try {
            $auth->assertCsrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null);
        } catch (RuntimeException) {
            throw new \BeyndaCalculator\QuoteApi\ApiException('Refresh the archive and try again.', 'CSRF_REJECTED', 403);
        }
        if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') throw new \BeyndaCalculator\QuoteApi\ApiException('Expected JSON.', 'INVALID_BODY', 415);
        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        $expectedOrigin = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
        if (($origin !== null && $origin !== $expectedOrigin) || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') throw new \BeyndaCalculator\QuoteApi\ApiException('Cross-site requests are not allowed.', 'ORIGIN_REJECTED', 403);
        $body = file_get_contents('php://input', false, null, 0, 262145);
        if (!is_string($body) || strlen($body) > 262144) throw new \BeyndaCalculator\QuoteApi\ApiException('Request is too large.', 'INVALID_BODY', 413);
        $data = json_decode($body, true);
        if (!is_array($data) || !is_string($data['quoteNumber'] ?? null) || preg_match('/^Q-[A-Z0-9-]{3,80}$/', $data['quoteNumber']) !== 1 || !is_string($data['editToken'] ?? null) || preg_match('/^[a-f0-9]{64}$/', $data['editToken']) !== 1 || !is_bool($data['send'] ?? null)) throw new \BeyndaCalculator\QuoteApi\ApiException('Invalid request.', 'INVALID_BODY');
        [$number, $token, $send] = [$data['quoteNumber'], $data['editToken'], $data['send']];
        unset($data['quoteNumber'], $data['editToken'], $data['send']);
        $request = (new \BeyndaCalculator\QuoteApi\QuoteRequestValidator())->decode(json_encode($data, JSON_THROW_ON_ERROR));
        [$service, $limiter] = quoteDependencies();
        if (!$limiter->reserve((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'))) throw new \BeyndaCalculator\QuoteApi\ApiException('Too many attempts. Try again later.', 'RATE_LIMITED', 429);
        if ($request['honeypot'] !== '') throw new \BeyndaCalculator\QuoteApi\ApiException('Request rejected.', 'INVALID_BODY');
        respond($service->edit($request, quoteConfigStore()->loadConfig(), (string) ($_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? ''), $number, $token, $send));
    }
    if ($method !== 'GET') {
        header('Allow: GET, POST');
        respond(['ok' => false, 'message' => 'Method not supported.'], 405);
    }

    if (isset($_GET['edit'])) {
        $record = quoteArchive()->record(is_string($_GET['edit']) ? $_GET['edit'] : '');
        unset($record['editOperation'], $record['delivery']);
        $record['csrfToken'] = $auth->csrfToken();
        respond(['ok' => true, 'record' => $record]);
    }

    if (isset($_GET['pdf'])) {
        $pdf = quoteArchive()->pdf(is_string($_GET['pdf']) ? $_GET['pdf'] : '');
        header('Content-Type: application/pdf');
        header('Content-Length: ' . strlen($pdf['bytes']));
        header('Content-Disposition: attachment; filename="' . $pdf['filename'] . '"');
        echo $pdf['bytes'];
        exit;
    }

    $query = is_string($_GET['q'] ?? null) ? $_GET['q'] : '';
    $page = filter_var($_GET['page'] ?? '1', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($page === false) throw new \BeyndaCalculator\QuoteApi\ApiException('Invalid page number.', 'INVALID_PAGE');
    respond(['ok' => true] + quoteArchive()->searchPage($query, $page));
} catch (\BeyndaCalculator\QuoteApi\ApiException $error) {
    respond(['ok' => false, 'code' => $error->errorCode, 'message' => $error->getMessage(), 'fieldErrors' => $error->fieldErrors], $error->httpStatus);
} catch (RuntimeException $error) {
    error_log('quote_archive_error: ' . $error->getMessage());
    respond(['ok' => false, 'message' => 'Archive is temporarily unavailable.'], 503);
} catch (Throwable $error) {
    error_log('quote_archive_unexpected: ' . $error::class);
    respond(['ok' => false, 'message' => 'Archive is temporarily unavailable.'], 503);
}

/** @param array<string, mixed> $payload */
function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
