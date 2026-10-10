<?php

declare(strict_types=1);

namespace BeyndaCalculator\QuoteApi;

final class QuoteRequestValidator
{
    private const MAX_BODY_BYTES = 262144;

    /** @return array{project: array<string, mixed>, contact: array{name: string, phone: string, email: string}, honeypot: string} */
    public function decode(string $body): array
    {
        if ($body === '' || strlen($body) > self::MAX_BODY_BYTES) {
            throw new ApiException('Request is empty or too large.', 'INVALID_BODY', 413);
        }
        try {
            $input = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('Invalid JSON.', 'INVALID_JSON');
        }
        if (!is_array($input) || array_is_list($input)) {
            throw new ApiException('Expected JSON-an object.', 'INVALID_BODY');
        }
        $allowed = ['version', 'project', 'contact', 'honeypot'];
        if (array_diff(array_keys($input), $allowed) !== [] || ($input['version'] ?? null) !== 1) {
            throw new ApiException('Request schema is unsupported.', 'INVALID_SCHEMA');
        }
        $project = $input['project'] ?? null;
        $contact = $input['contact'] ?? null;
        if (!is_array($project) || array_is_list($project) || !is_array($contact) || array_is_list($contact)) {
            throw new ApiException('Complete the project and contact details.', 'INVALID_SCHEMA');
        }
        $errors = [];
        $name = is_string($contact['name'] ?? null) ? trim($contact['name']) : '';
        if ($this->length($name) < 2 || $this->length($name) > 120 || preg_match('/[\x00-\x1F\x7F]/', $name) === 1) {
            $errors['name'] = 'Enter your full name.';
        }
        $phone = is_string($contact['phone'] ?? null) ? trim($contact['phone']) : '';
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) < 10 || strlen($digits) > 15 || preg_match('/^[+()\-\s\d]+$/u', $phone) !== 1) {
            $errors['phone'] = 'Enter a valid phone number.';
        }
        $email = is_string($contact['email'] ?? null) ? trim($contact['email']) : '';
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $email) === 1) {
            $errors['email'] = 'Enter a valid e-mail.';
        }
        if (array_diff(array_keys($contact), ['name', 'phone', 'email', 'consent']) !== []) {
            $errors['contact'] = 'Contact details contain unknown fields.';
        }
        if ($errors !== []) {
            throw new ApiException('Check contact details.', 'INVALID_CONTACT', 422, $errors);
        }
        $honeypot = $input['honeypot'] ?? '';
        if (!is_string($honeypot) || strlen($honeypot) > 200) {
            throw new ApiException('Request schema is unsupported.', 'INVALID_SCHEMA');
        }
        return [
            'project' => $project,
            'contact' => ['name' => $name, 'phone' => $phone, 'email' => $email],
            'honeypot' => $honeypot,
        ];
    }

    private function length(string $value): int
    {
        $length = preg_match_all('/./us', $value);
        return $length === false ? PHP_INT_MAX : $length;
    }
}

