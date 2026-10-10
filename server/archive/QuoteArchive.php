<?php

declare(strict_types=1);

namespace BeyndaCalculator\Archive;

use Closure;
use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use RuntimeException;
use Throwable;

final class QuoteArchive
{
    private readonly Closure $clock;

    public function __construct(
        private readonly string $directory,
        ?Closure $clock = null,
    ) {
        $this->clock = $clock ?? static fn (): DateTimeImmutable => new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    /** @param array<string, mixed> $request @param array<string, mixed> $quote */
    public function savePrepared(array $request, array $quote, string $pdfBytes, string $pdfFilename, ?string $operation = null): void
    {
        $quoteNumber = $this->quoteNumber($quote['quoteNumber'] ?? null);
        $contact = $request['contact'] ?? null;
        $project = $request['project'] ?? null;
        if (!is_array($contact) || !is_array($project) || $pdfBytes === '') {
            throw new RuntimeException('Incomplete quote archive data.');
        }
        $this->withDatabase(function (array &$database) use ($quoteNumber, $contact, $project, $quote, $pdfBytes, $pdfFilename, $operation): void {
            $now = ($this->clock)();
            $existing = is_array($database[$quoteNumber] ?? null) ? $database[$quoteNumber] : [];
            if ($operation === null && ($existing['editOperation'] ?? null) !== null) throw new RuntimeException('The quote has been edited; the original submission cannot be repeated.');
            $createdAt = is_string($existing['createdAt'] ?? null) ? $existing['createdAt'] : $now->format(DATE_ATOM);
            $expiresAt = is_string($existing['expiresAt'] ?? null) ? $existing['expiresAt'] : $now->modify('+18 months')->format(DATE_ATOM);
            $storedFilename = $quoteNumber . '.pdf';
            $pdfPath = $this->directory . '/' . $storedFilename;
            $oldPdf = is_file($pdfPath) ? file_get_contents($pdfPath) : null;
            if ($oldPdf === false) throw new RuntimeException('Could not read the current PDF.');
            $this->atomicWrite($pdfPath, $pdfBytes);
            $database[$quoteNumber] = [
                'version' => 1,
                'quoteNumber' => $quoteNumber,
                'createdAt' => $createdAt,
                'updatedAt' => $now->format(DATE_ATOM),
                'expiresAt' => $expiresAt,
                'contact' => [
                    'name' => (string) ($contact['name'] ?? ''),
                    'phone' => (string) ($contact['phone'] ?? ''),
                    'email' => (string) ($contact['email'] ?? ''),
                ],
                'project' => $project,
                'quote' => $quote,
                'pdfFilename' => $this->downloadFilename($pdfFilename, $quoteNumber),
                'pdfPath' => $storedFilename,
                'editOperation' => $operation,
                'delivery' => ($operation === ($existing['editOperation'] ?? null) && is_array($existing['delivery'] ?? null)) ? $existing['delivery'] : [
                    'company' => ['status' => 'pending', 'updatedAt' => $now->format(DATE_ATOM)],
                    'client' => ['status' => 'pending', 'updatedAt' => $now->format(DATE_ATOM)],
                ],
            ];
            try { $this->writeDatabase($database); }
            catch (Throwable $error) {
                if (is_string($oldPdf)) $this->atomicWrite($pdfPath, $oldPdf); else @unlink($pdfPath);
                throw $error;
            }
        }, false);
    }

    public function record(string $quoteNumber): array
    {
        $quoteNumber = $this->quoteNumber($quoteNumber);
        return $this->withDatabase(function (array &$database) use ($quoteNumber): array {
            $record = $database[$quoteNumber] ?? null;
            if (!is_array($record)) throw new RuntimeException('Quote not found.');
            $record['editToken'] = hash('sha256', serialize([$record['project'], $record['contact'], $record['quote'], $record['editOperation'] ?? null]));
            unset($record['pdfPath']);
            return $record;
        });
    }

    // Serialize the whole update, including delivery, without blocking other quotes.
    public function withEditLock(string $quoteNumber, callable $callback): mixed
    {
        $quoteNumber = $this->quoteNumber($quoteNumber);
        $this->record($quoteNumber);
        $handle = fopen($this->directory . '/.' . $quoteNumber . '.edit.lock', 'c');
        if ($handle === false) throw new RuntimeException('Could not open the lock.');
        try {
            if (!flock($handle, LOCK_EX | LOCK_NB)) throw new \BeyndaCalculator\QuoteApi\ApiException('The quote is being saved. Try again later.', 'REQUEST_IN_PROGRESS', 409);
            return $callback();
        } finally { fclose($handle); }
    }

    public function markDelivery(string $quoteNumber, string $kind, string $status): void
    {
        $quoteNumber = $this->quoteNumber($quoteNumber);
        if (!in_array($kind, ['company', 'client'], true) || !in_array($status, ['pending', 'sent', 'failed'], true)) {
            throw new RuntimeException('Invalid delivery status.');
        }
        $this->withDatabase(function (array &$database) use ($quoteNumber, $kind, $status): void {
            if (!is_array($database[$quoteNumber] ?? null)) throw new RuntimeException('Quote was not found in the archive.');
            $at = ($this->clock)()->format(DATE_ATOM);
            $database[$quoteNumber]['delivery'][$kind] = ['status' => $status, 'updatedAt' => $at];
            $database[$quoteNumber]['updatedAt'] = $at;
        });
    }

    /** @return list<array<string, mixed>> */
    public function search(string $query, int $limit = 100): array
    {
        return $this->searchPage($query, 1, $limit)['records'];
    }

    /** Search all records before selecting a page (never truncate search at 100). */
    public function searchPage(string $query, int $page = 1, int $limit = 10): array
    {
        $query = trim($query);
        if ($this->length($query) > 120) throw new RuntimeException('Search query is too long.');
        $limit = max(1, min(100, $limit));
        return $this->withDatabase(function (array &$database) use ($query, $limit, $page): array {
            $rows = [];
            foreach ($database as $record) {
                if (!is_array($record)) continue;
                $haystack = implode(' ', [
                    (string) ($record['quoteNumber'] ?? ''),
                    (string) ($record['contact']['name'] ?? ''),
                    (string) ($record['contact']['phone'] ?? ''),
                    (string) ($record['contact']['email'] ?? ''),
                ]);
                $phoneQuery = preg_match('/^[+\d\s().-]+$/', $query) === 1 ? preg_replace('/\D/', '', $query) : '';
                $phone = preg_replace('/\D/', '', (string) ($record['contact']['phone'] ?? ''));
                if (strlen($phoneQuery) === 11 && ($phoneQuery[0] === '8' || $phoneQuery[0] === '7')) $phoneQuery = substr($phoneQuery, 1);
                if (strlen($phone) === 11 && ($phone[0] === '8' || $phone[0] === '7')) $phone = substr($phone, 1);
                $phoneMatch = $phoneQuery !== '' && str_contains($phone, $phoneQuery);
                if ($query !== '' && !$this->contains($haystack, $query) && !$phoneMatch) continue;
                $quote = is_array($record['quote'] ?? null) ? $record['quote'] : [];
                $products = is_array($quote['products'] ?? null) ? $quote['products'] : [];
                $rows[] = [
                    'quoteNumber' => (string) ($record['quoteNumber'] ?? ''),
                    'createdAt' => (string) ($record['createdAt'] ?? ''),
                    'expiresAt' => (string) ($record['expiresAt'] ?? ''),
                    'contact' => $record['contact'] ?? [],
                    'total' => $quote['total'] ?? null,
                    'currency' => (string) ($quote['currency'] ?? 'RUB'),
                    'productCount' => count($products),
                    'delivery' => $record['delivery'] ?? [],
                ];
            }
            usort($rows, static fn (array $left, array $right): int => strcmp((string) $right['createdAt'], (string) $left['createdAt']) ?: strcmp($right['quoteNumber'], $left['quoteNumber']));
            $total = count($rows);
            $pages = max(1, (int) ceil($total / $limit));
            $page = max(1, min($pages, $page));
            return ['records' => array_slice($rows, ($page - 1) * $limit, $limit), 'total' => $total, 'page' => $page, 'pages' => $pages, 'pageSize' => $limit];
        });
    }

    /** @return array{bytes: string, filename: string} */
    public function pdf(string $quoteNumber): array
    {
        $quoteNumber = $this->quoteNumber($quoteNumber);
        return $this->withDatabase(function (array &$database) use ($quoteNumber): array {
            $record = $database[$quoteNumber] ?? null;
            if (!is_array($record)) throw new RuntimeException('Quote not found.');
            $path = $this->directory . '/' . basename((string) ($record['pdfPath'] ?? ''));
            $bytes = is_file($path) ? file_get_contents($path) : false;
            if (!is_string($bytes) || $bytes === '') throw new RuntimeException('PDF quote is unavailable.');
            return ['bytes' => $bytes, 'filename' => (string) ($record['pdfFilename'] ?? ($quoteNumber . '.pdf'))];
        });
    }

    private function withDatabase(callable $callback, bool $persist = true): mixed
    {
        if (!is_dir($this->directory) && !mkdir($this->directory, 0770, true) && !is_dir($this->directory)) {
            throw new RuntimeException('Could not create the archive directory.');
        }
        $lock = fopen($this->directory . '/.archive.lock', 'c');
        if ($lock === false) throw new RuntimeException('Could not open the archive lock.');
        try {
            if (!flock($lock, LOCK_EX)) throw new RuntimeException('Could not lock the archive.');
            $database = $this->readDatabase();
            $changed = $this->removeExpired($database);
            $before = serialize($database);
            $result = $callback($database);
            if ($persist && ($changed || serialize($database) !== $before)) $this->writeDatabase($database);
            flock($lock, LOCK_UN);
            return $result;
        } finally {
            fclose($lock);
        }
    }

    /** @return array<string, array<string, mixed>> */
    private function readDatabase(): array
    {
        $path = $this->directory . '/quotes.json';
        if (!is_file($path)) return [];
        $raw = file_get_contents($path);
        if (!is_string($raw) || $raw === '') throw new RuntimeException('Quote database is unavailable.');
        try {
            $decoded = json_decode($raw, true, 128, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('Quote database is corrupted.', 0, $error);
        }
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) throw new RuntimeException('Invalid quote database format.');
        return $decoded;
    }

    /** @param array<string, array<string, mixed>> $database */
    private function writeDatabase(array $database): void
    {
        try {
            $json = json_encode($database, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $error) {
            throw new RuntimeException('Could not save the quote database.', 0, $error);
        }
        $this->atomicWrite($this->directory . '/quotes.json', $json);
    }

    /** @param array<string, array<string, mixed>> $database */
    private function removeExpired(array &$database): bool
    {
        $changed = false;
        $now = ($this->clock)();
        foreach ($database as $key => $record) {
            $expires = is_array($record) && is_string($record['expiresAt'] ?? null) ? new DateTimeImmutable($record['expiresAt']) : null;
            if ($expires !== null && $expires > $now) continue;
            if (is_array($record) && is_string($record['pdfPath'] ?? null)) @unlink($this->directory . '/' . basename($record['pdfPath']));
            unset($database[$key]);
            $changed = true;
        }
        return $changed;
    }

    private function atomicWrite(string $path, string $bytes): void
    {
        $temporary = $path . '.tmp-' . bin2hex(random_bytes(8));
        $handle = fopen($temporary, 'xb');
        if ($handle === false) throw new RuntimeException('Could not create the temporary archive file.');
        try {
            $written = 0;
            while ($written < strlen($bytes)) {
                $chunk = fwrite($handle, substr($bytes, $written));
                if ($chunk === false || $chunk === 0) throw new RuntimeException('Incomplete archive record.');
                $written += $chunk;
            }
            if (!fflush($handle)) throw new RuntimeException('Could not flush the archive to disk.');
            if (function_exists('fsync') && !fsync($handle)) throw new RuntimeException('Could not synchronize the archive.');
        } catch (Throwable $error) {
            fclose($handle);
            @unlink($temporary);
            throw $error;
        }
        fclose($handle);
        if (@rename($temporary, $path)) return;
        if (DIRECTORY_SEPARATOR === '\\' && is_file($path)) {
            $old = $path . '.old-' . bin2hex(random_bytes(6));
            if (@rename($path, $old) && @rename($temporary, $path)) { @unlink($old); return; }
            if (is_file($old) && !is_file($path)) @rename($old, $path);
        }
        @unlink($temporary);
        throw new RuntimeException('Could not atomically update the archive.');
    }

    private function quoteNumber(mixed $value): string
    {
        if (!is_string($value) || preg_match('/^Q-[A-Z0-9-]{3,80}$/', $value) !== 1) throw new RuntimeException('Invalid quote number.');
        return $value;
    }

    private function downloadFilename(string $filename, string $quoteNumber): string
    {
        return preg_match('/^[A-Za-z0-9_-]{1,100}\.pdf$/', $filename) === 1 ? $filename : $quoteNumber . '.pdf';
    }

    private function contains(string $haystack, string $needle): bool
    {
        if (function_exists('mb_stripos')) return mb_stripos($haystack, $needle, 0, 'UTF-8') !== false;
        return stripos($haystack, $needle) !== false;
    }

    private function length(string $value): int
    {
        if (function_exists('mb_strlen')) return mb_strlen($value, 'UTF-8');
        $count = preg_match_all('/./us', $value);
        return $count === false ? PHP_INT_MAX : $count;
    }
}
