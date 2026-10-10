<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

use BeyndaCalculator\Archive\QuoteArchive;
use BeyndaCalculator\Mail\MailMessage;
use BeyndaCalculator\Mail\MailTransport;
use Throwable;

final class QuoteService
{
    private const COMPANY_RECIPIENT = 'quotes@example.invalid';

    public function __construct(
        private readonly QuoteCalculator $calculator,
        private readonly QuotePdfRenderer $pdf,
        private readonly MailTransport $mail,
        private readonly IdempotencyStore $idempotency,
        private readonly ?QuoteArchive $archive = null,
    ) {
    }

    /** @param array<string, mixed> $request @param array<string, mixed> $config @return array<string, mixed> */
    public function edit(array $request, array $config, string $idempotencyKey, string $number, string $token, bool $send): array
    {
        if ($this->archive === null) throw new ApiException('Archive is unavailable.', 'ARCHIVE_UNAVAILABLE', 503);
        return $this->archive->withEditLock($number, function () use ($request, $config, $idempotencyKey, $number, $token, $send): array {
            $record = $this->archive->record($number);
            $operation = hash('sha256', $idempotencyKey);
            if (!hash_equals($record['editToken'], $token) && ($record['editOperation'] ?? null) !== $operation) {
                throw new ApiException('The quote has changed. Select «Edit», to open the current version.', 'EDIT_CONFLICT', 409);
            }
            return $this->deliver($request, $config, $idempotencyKey, ['record' => $record, 'operation' => $operation, 'send' => $send, 'token' => $token]);
        });
    }

    public function deliver(array $request, array $config, string $idempotencyKey, ?array $edit = null): array
    {
        $fingerprint = hash('sha256', json_encode([$request, $edit === null ? null : [$edit['record']['quoteNumber'], $edit['token'], $edit['send']]], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        $claim = $this->idempotency->claim($idempotencyKey, $fingerprint);
        if ($claim['status'] === 'cached') return $claim['response'];
        if ($claim['status'] === 'conflict') throw new ApiException('The idempotency key was already used for a different quote.', 'IDEMPOTENCY_CONFLICT', 409);
        if ($claim['status'] === 'pending') throw new ApiException('This quote is already being submitted.', 'REQUEST_IN_PROGRESS', 409);
        $prepared = false;
        $archived = false;
        try {
            if ($claim['status'] === 'resume') {
                $response = $claim['response'];
                $quote = $response['quote'];
                $pdfBytes = base64_decode((string) $response['pdfBase64'], true);
                if (!is_array($quote) || !is_string($pdfBytes)) throw new ApiException('Retry submission data is corrupted.', 'RETRY_STATE_INVALID', 503);
                $filename = (string) $response['pdfFilename'];
                $sentKinds = $claim['sentKinds'] ?? [];
            } else {
                $quote = $this->calculator->calculate($request['project'], $config);
                if ($quote['status'] !== 'ready') throw new ApiException('Pricing requires configuration. Submission is disabled.', 'CONFIGURATION_REQUIRED', 422);
                if ($edit !== null) {
                    $quote['quoteNumber'] = $edit['record']['quoteNumber'];
                    $quote['createdAt'] = $edit['record']['quote']['createdAt'] ?? $edit['record']['createdAt'];
                }
                $pdfBytes = $this->pdf->render($quote);
                $filename = preg_replace('/[^A-Za-z0-9_-]/', '-', (string) $quote['quoteNumber']) . '.pdf';
                $response = ['ok' => true, 'quoteNumber' => $quote['quoteNumber'], 'quote' => $quote, 'pdfFilename' => $filename, 'pdfBase64' => base64_encode($pdfBytes)];
                // Keep the first response identical to a later JSON-cached response.
                $response = json_decode(json_encode($response, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
                $sentKinds = [];
                $this->idempotency->checkpoint($idempotencyKey, $fingerprint, $response);
            }
            $prepared = true;
            $contact = $request['contact'];
            $this->archive?->savePrepared($request, $quote, $pdfBytes, $filename, $edit['operation'] ?? null);
            $archived = $this->archive !== null;
            $presentation = $quote['presentation'] ?? ['language' => 'en', 'units' => 'cm'];
            $translate = static fn (string $label): string => \BeyndaCalculator\Config\presentText($label, $presentation);
            $subject = $translate('Quote') . ' ' . $quote['quoteNumber'] . ' - Beynda';
            $text = $translate('Quote') . " {$quote['quoteNumber']}\n" . $translate('Full name') . ": {$contact['name']}\n" . $translate('Phone') . ": {$contact['phone']}\nE-mail: {$contact['email']}\n" . $translate('Total') . ": {$quote['total']} {$quote['currency']}";
            $recipients = ($edit !== null && !$edit['send']) ? [] : [['company', self::COMPANY_RECIPIENT], ['client', $contact['email']]];
            foreach ($recipients as [$kind, $recipient]) {
                if (in_array($kind, $sentKinds, true)) {
                    $this->archive?->markDelivery((string) $quote['quoteNumber'], $kind, 'sent');
                    continue;
                }
                try {
                    $this->mail->send(new MailMessage($recipient, $kind, $subject, $text, $pdfBytes, $filename, $quote['quoteNumber']));
                    $this->idempotency->markSent($idempotencyKey, $kind);
                    $this->archive?->markDelivery((string) $quote['quoteNumber'], $kind, 'sent');
                } catch (Throwable $error) {
                    $this->archive?->markDelivery((string) $quote['quoteNumber'], $kind, 'failed');
                    throw $error;
                }
            }
            if ($edit !== null) $response['editToken'] = $this->archive->record((string) $quote['quoteNumber'])['editToken'];
            $this->idempotency->complete($idempotencyKey, $fingerprint, $response);
            return $response;
        } catch (Throwable $error) {
            if ($prepared) $this->idempotency->pause($idempotencyKey); else $this->idempotency->release($idempotencyKey);
            if ($edit !== null && $prepared) throw new ApiException($archived ? 'The quote was saved, but delivery is incomplete. Try again «Save and submit».' : 'The quote could not be saved. Select the same action to retry.', 'EDIT_RETRY_REQUIRED', 503);
            throw $error;
        }
    }
}
