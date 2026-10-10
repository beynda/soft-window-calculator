# Installation notes

## Local evaluation

Run `npm run dev` with Node.js 24+. The local server binds to 127.0.0.1 and uses simulated backend endpoints. It is not the PHP application.

## PHP evaluation

Requires PHP 8.1+ and writable, nonpublic directories for configuration, quote archives and runtime state. Run `npm test` with PHP on PATH before deployment.

Run `npm run build`, then evaluate the generated package behind access control on a private test host. Apache storage denial rules are generated, but other servers require equivalent explicit rules. Deny HTTP access to storage, source configuration and environment files.

Set long random `QUOTE_IP_HASH_SALT` and `QUOTE_IDEMPOTENCY_SALT` values. Set `ADMIN_PASSWORD_HASH` using PHP password_hash for the admin interface. `.env.example` lists names only and is not an environment loader.

Keep `QUOTE_MAIL_TRANSPORT=log` during evaluation. No real mail is sent in this mode. The log contains delivery metadata rather than message bodies. Configure native/SMTP sending only after explicit delivery testing and replacement of example.invalid addresses.

The quote archive requires the admin session for lists, records, PDFs and edits. Sign in at /admin/ first. Edits require the session CSRF token, which is returned with the editable record and sent in X-CSRF-Token. With no ADMIN_PASSWORD_HASH configured, access remains closed. Use HTTPS and keep storage inaccessible over HTTP.

Check configuration loading, dimensions, pricing, browser and server PDFs, validation errors, idempotent submission, archive access and admin authentication on your actual test host. A successful static preview alone does not establish backend readiness.

## Local PHP verification

Run `npm run build`, then `php -S 127.0.0.1:8080 -t deployment/dist/window-calculator deployment/dist/window-calculator/router.php`. Open http://127.0.0.1:8080/public/. The router denies storage, server and dotfiles; the built-in PHP server ignores Apache .htaccess rules. Use only synthetic contacts and QUOTE_MAIL_TRANSPORT=log for local checks. Configure environment variables in the shell or hosting service; .env.example is documentation, not an automatic loader.

The generated root .htaccess denies internal server/storage routes and dotfiles on Apache. Keep equivalent rules on other servers. Verify their behavior on the actual host before accepting real contacts.
