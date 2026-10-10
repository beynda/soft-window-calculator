<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

final class QuotePdfRenderer
{
    /** @param array<string, mixed> $quote */
    public function render(array $quote): string
    {
        if (($quote['status'] ?? null) !== 'ready') {
            throw new ApiException('Pricing requires configuration. Submission is unavailable.', 'CONFIGURATION_REQUIRED', 422);
        }
        return (new ServerPdfDocument())->build($quote);
    }
}
