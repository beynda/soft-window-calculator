<?php

declare(strict_types=1);

namespace BeyndaCalculator\Mail;

use JsonException;
use RuntimeException;

final class LogMailTransport implements MailTransport
{
    public function __construct(private readonly string $path)
    {
    }

    public function send(MailMessage $message): void
    {
        $directory = dirname($this->path);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new RuntimeException('Could not prepare the mail log.');
        }
        try {
            $line = json_encode([
                'event' => 'quote_mail_simulated',
                'recipientKind' => $message->recipientKind,
                'quoteNumber' => $message->quoteNumber,
                'pdfSha256' => hash('sha256', $message->pdfBytes),
                'pdfBytes' => strlen($message->pdfBytes),
                'at' => gmdate('c'),
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $error) {
            throw new RuntimeException('Could not create the mail event.', 0, $error);
        }
        if (file_put_contents($this->path, $line . PHP_EOL, FILE_APPEND | LOCK_EX) === false) {
            throw new RuntimeException('Could not write the mail event.');
        }
    }
}
