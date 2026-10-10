<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

use RuntimeException;

final class ApiException extends RuntimeException
{
    /** @param array<string, string> $fieldErrors */
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $httpStatus = 400,
        public readonly array $fieldErrors = [],
    ) {
        parent::__construct($message);
    }
}

