<?php

declare(strict_types=1);

namespace BeyndaCalculator\Config;

use RuntimeException;

final class ConfigValidationException extends RuntimeException
{
    /** @param array<string, string> $errors */
    public function __construct(private readonly array $errors)
    {
        parent::__construct('Configuration contains invalid values.');
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }
}
