<?php

declare(strict_types=1);

namespace BeyndaCalculator\Mail;

use RuntimeException;

final class NativeMailTransport implements MailTransport
{
    public function __construct(private readonly string $fromAddress)
    {
        if (filter_var($fromAddress, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $fromAddress) === 1) {
            throw new RuntimeException('Sender email address is not configured.');
        }
    }

    public function send(MailMessage $message): void
    {
        if (filter_var($message->recipient, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $message->recipient) === 1) {
            throw new RuntimeException('Invalid recipient email address.');
        }
        $boundary = '=_quote_' . bin2hex(random_bytes(16));
        $headers = [
            'MIME-Version: 1.0',
            'From: ' . $this->fromAddress,
            'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
        ];
        $body = '--' . $boundary . "\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($message->text))
            . '--' . $boundary . "\r\n"
            . "Content-Type: application/pdf; name=\"{$message->pdfFilename}\"\r\n"
            . "Content-Disposition: attachment; filename=\"{$message->pdfFilename}\"\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($message->pdfBytes))
            . '--' . $boundary . "--\r\n";
        $subject = '=?UTF-8?B?' . base64_encode($message->subject) . '?=';
        if (!mail($message->recipient, $subject, $body, implode("\r\n", $headers))) {
            throw new RuntimeException('The mail server rejected the message.');
        }
    }
}
