# Soft Window Calculator

[Try the calculator online](https://beynda.com/tools/soft-window-calculator/). The demo runs locally in your browser and exports real PDFs without collecting contact details.

A configurable calculator for flexible PVC window panels and doors, prepared by Beynda.

[Русская документация](README.ru.md)

It supports nine window shapes, rectangular doors, hardware placement, itemized pricing, print layouts, local PDF export and technical drafts. The optional PHP backend recalculates quotes, validates submissions and provides an administrator interface.

## Quick start

Requires Node.js 24 or newer. No npm runtime dependencies are needed.

```sh
npm run dev
```

Open the local address printed in the terminal. The development server simulates submission and archive endpoints, keeps its sample records in memory and sends no email. Use fictional contact details. Its sample PDF response is a stub; use the browser's **PDF** export for a real document.

The calculator opens in English with inches and USD. Use the language, units and currency controls to select English with centimetres or inches and USD or EUR, or Russian with centimetres and RUB. Preferences persist locally. Switching display settings retains the technical draft; contact fields are cleared after confirmation.

PDF and print exports retain each quote's language and units. Geometry is calculated in centimetres internally. Material rates use square metres; length-based rates use metres in all profiles. Included prices are illustrative, not market quotations or live currency conversions.

## Check and build

```sh
npm test
npm run build
```

Tests cover geometry, pricing, drafts, UI markup, PDF and package boundaries. PHP tests require PHP 8.1+ and skip when it is unavailable. Browser acceptance scripts require Python, Playwright, Pillow and pypdf. Visual baselines must be established for the target environment.

`npm run test:e2e:international` checks language controls, inch/metric roundtrips, USD/EUR profiles, Russian RUB output, PDF downloads and mobile overflow in an installed Chrome browser. Screenshots are written to a temporary directory, or to `CALCULATOR_TEST_ARTIFACTS` when set.

The build is generated in `deployment/dist/window-calculator/`. Edit source files, then rebuild. The build only replaces its own marked output directory.

## Configuration

`storage/config.json` contains demonstration rates, supported materials, hardware, dimension limits and tax settings. Prices are recalculated by both JavaScript and PHP; keep their rules and parity tests synchronized.

The root `currency`, `tariffs` and `vat` fields configure RUB. `marketRates.USD` and `marketRates.EUR` each define independent `tariffs` and `vat` objects. Edit the currency profiles in the administrator JSON editor or configuration file. No exchange-rate service is used. USD/EUR amounts round to cents; the original whole-ruble rounding is retained for RUB. The backend selects rates from its own configuration and never accepts a client-supplied total or tariff.

`server/api/bootstrap.php` defaults to the metadata-only log mail transport. Placeholder addresses use `example.invalid`. Real mail requires deliberate transport configuration and replacement of placeholders.

Environment variable names are listed in `.env.example`. PHP does not automatically load that file. Configure environment variables in your server runtime, and never commit their values.

## Deployment boundary

See [installation notes](docs/INSTALL.md). Archive reads, PDFs and edits require the admin session. Edits also require its CSRF token. Configure ADMIN_PASSWORD_HASH before using the archive. Keep storage private and use HTTPS. Verify authentication, mail delivery, PHP endpoints and browser behavior on the target host before deployment.

## Repository contents

- `src/domain`: geometry and pricing without DOM dependencies.
- `src/frontend`: calculator, summary, PDF, submission and archive components.
- `public`: browser shell and styles.
- `server`: PHP validation, pricing, configuration, archive and mail transports.
- `tests`: unit and integration checks with synthetic examples.
- `deployment`: reproducible packaging script.

## License

Licensed under the [MIT License](LICENSE). Third-party fonts retain their own license terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built by [Beynda](https://beynda.com).

Run `npm run test:e2e:archive` to verify real PHP archive login, PDF downloads, editing and logout with isolated synthetic data. Third-party font terms are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
