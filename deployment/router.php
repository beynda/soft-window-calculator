<?php

declare(strict_types=1);

// Local PHP development server only. Production needs equivalent web-server rules.
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
if (preg_match('~(?:^|/)\.|^/(?:storage|server)(?:/|$)|\\\\|\x00~', $path)) {
    http_response_code(404);
    exit;
}
if ($path === '/') {
    header('Location: /public/', true, 302);
    exit;
}
return false;
