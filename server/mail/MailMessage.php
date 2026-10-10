<?php

declare(strict_types=1);

namespace BeyndaCalculator\Mail;

final class MailMessage
{
    public function __construct(
        public readonly string $recipient,
        public readonly string $recipientKind,
        public readonly string $subject,
        public readonly string $text,
        public readonly string $pdfBytes,
        public readonly string $pdfFilename,
        public readonly string $quoteNumber,
    ) {
    }
}
