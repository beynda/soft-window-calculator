<?php

declare(strict_types=1);

use BeyndaCalculator\Config\ConfigStore;
use BeyndaCalculator\Config\ConfigValidator;
use BeyndaCalculator\Archive\QuoteArchive;
use BeyndaCalculator\Mail\LogMailTransport;
use BeyndaCalculator\Mail\MailTransport;
use BeyndaCalculator\Mail\NativeMailTransport;
use BeyndaCalculator\Mail\SmtpMailTransport;
use BeyndaCalculator\QuoteApi\IdempotencyStore;
use BeyndaCalculator\QuoteApi\QuoteCalculator;
use BeyndaCalculator\QuoteApi\QuotePdfRenderer;
use BeyndaCalculator\QuoteApi\QuoteService;
use BeyndaCalculator\QuoteApi\RateLimiter;

require_once dirname(__DIR__) . '/config/ConfigValidationException.php';
require_once dirname(__DIR__) . '/config/ConfigValidator.php';
require_once dirname(__DIR__) . '/config/ConfigStore.php';
require_once dirname(__DIR__) . '/archive/QuoteArchive.php';
require_once __DIR__ . '/ApiException.php';
require_once __DIR__ . '/AtomicJsonState.php';
require_once __DIR__ . '/QuoteRequestValidator.php';
require_once __DIR__ . '/RateLimiter.php';
require_once __DIR__ . '/IdempotencyStore.php';
require_once __DIR__ . '/QuoteCalculator.php';
require_once __DIR__ . '/ServerPdfFont.php';
require_once __DIR__ . '/ServerPdfDocument.php';
require_once __DIR__ . '/QuotePdfRenderer.php';
require_once __DIR__ . '/QuoteService.php';
require_once dirname(__DIR__) . '/mail/MailTransport.php';
require_once dirname(__DIR__) . '/mail/MailMessage.php';
require_once dirname(__DIR__) . '/mail/LogMailTransport.php';
require_once dirname(__DIR__) . '/mail/NativeMailTransport.php';
require_once dirname(__DIR__) . '/mail/SmtpMailTransport.php';

function quoteRuntimeDirectory(): string
{
    $configured = getenv('QUOTE_RUNTIME_DIR');
    return is_string($configured) && $configured !== '' ? $configured : dirname(__DIR__, 2) . '/storage/runtime';
}

function quoteConfigStore(): ConfigStore
{
    $configured = getenv('QUOTE_CONFIG_DIR');
    $directory = is_string($configured) && $configured !== '' ? $configured : dirname(__DIR__, 2) . '/storage';
    return new ConfigStore($directory, new ConfigValidator());
}

function quoteMailTransport(): MailTransport
{
    // The public sample defaults to the metadata-only log transport.
    $mode = getenv('QUOTE_MAIL_TRANSPORT') ?: 'log';
    if ($mode === 'smtp') {
        return new SmtpMailTransport(getenv('QUOTE_SMTP_HOST') ?: 'smtp.example.invalid', (int) (getenv('QUOTE_SMTP_PORT') ?: 465), getenv('QUOTE_SMTP_USERNAME') ?: '', getenv('QUOTE_SMTP_PASSWORD') ?: '', getenv('QUOTE_MAIL_FROM') ?: 'quotes@example.invalid');
    }
    if ($mode === 'log') {
        $path = getenv('QUOTE_MAIL_LOG_PATH') ?: quoteRuntimeDirectory() . '/mail.log';
        return new LogMailTransport($path);
    }
    if ($mode === 'native') {
        $from = getenv('QUOTE_MAIL_FROM') ?: 'no-reply@example.invalid';
        return new NativeMailTransport(is_string($from) ? $from : 'no-reply@example.invalid');
    }
    throw new RuntimeException('QUOTE_MAIL_TRANSPORT must be log or native.');
}

/** @return array{0: QuoteService, 1: RateLimiter} */
function quoteDependencies(): array
{
    $ipSalt = getenv('QUOTE_IP_HASH_SALT');
    $idempotencySalt = getenv('QUOTE_IDEMPOTENCY_SALT');
    $runtime = quoteRuntimeDirectory();
    $limiter = new RateLimiter($runtime . '/rate-limit.json', is_string($ipSalt) ? $ipSalt : '');
    $idempotency = new IdempotencyStore($runtime . '/idempotency.json', is_string($idempotencySalt) ? $idempotencySalt : '');
    $archiveDirectory = getenv('QUOTE_ARCHIVE_DIR');
    $archivePath = is_string($archiveDirectory) && $archiveDirectory !== '' ? $archiveDirectory : dirname(__DIR__, 2) . '/storage/archive';
    return [new QuoteService(new QuoteCalculator(), new QuotePdfRenderer(), quoteMailTransport(), $idempotency, new QuoteArchive($archivePath)), $limiter];
}
