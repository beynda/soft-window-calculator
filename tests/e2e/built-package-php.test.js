import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildDeployPackage } from '../../deployment/build.mjs';

const php = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
const phpSkip = php.error
  ? 'PHP is not installed locally; built-package PHP wiring was not exercised'
  : Number(php.stdout) < 80100
    ? `PHP 8.1+ required, found ${php.stdout}; built-package PHP wiring was not exercised`
    : false;

test('built package serves real config and quote PHP endpoints with PII-free log transport', { skip: phpSkip }, async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'window-calculator-php-build-'));
  const packageRoot = await buildDeployPackage({ outputRoot });
  const configPath = join(packageRoot, 'storage', 'config.json');
  const runtime = join(outputRoot, 'runtime');
  const logPath = join(runtime, 'mail.log');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.tariffs.materials['clear-pvc-700'] = 1000;
  config.tariffs.materials['tinted-pvc-700'] = 1200;
  for (const key of Object.keys(config.tariffs.hardware)) config.tariffs.hardware[key] = 10;
  config.tariffs.zipperPerMeter = 30;
  config.tariffs.weightBarPerMeter = 50;
  config.tariffs.flashingPerMeter = 60;
  await writeFile(configPath, JSON.stringify(config));

  const port = await availablePort();
  const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', packageRoot, join(packageRoot, 'router.php')], {
    env: {
      ...process.env,
      QUOTE_CONFIG_DIR: join(packageRoot, 'storage'),
      QUOTE_RUNTIME_DIR: runtime,
      QUOTE_MAIL_TRANSPORT: 'log',
      QUOTE_MAIL_LOG_PATH: logPath,
      QUOTE_IP_HASH_SALT: 'built-package-ip-test-salt',
      QUOTE_IDEMPOTENCY_SALT: 'built-package-idempotency-test-salt',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', (chunk) => { diagnostics += chunk; });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitForHttp(`${origin}/config/public.php`, server);
    for (const path of ['/storage/config.json', '/server/config/translations.json', '/.env.example', '/storage/archive/', '/%2estorage/config.json']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
    assert.equal((await fetch(`${origin}/archive/`)).status, 401);
    const page = await fetch(`${origin}/public/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\.\/app\.js/);

    const publicConfig = await (await fetch(`${origin}/config/public.php`)).json();
    assert.equal(publicConfig.tariffs.materials['clear-pvc-700'], 1000);

    const admin = await fetch(`${origin}/admin/`);
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get('x-frame-options'), 'DENY');
    const adminHtml = await admin.text();
    assert.match(adminHtml, /type="password"/);
    assert.doesNotMatch(adminHtml, /<textarea|clear-pvc-700|"tariffs"|ADMIN_PASSWORD_HASH/i);

    const backup = await fetch(`${origin}/admin/backup.php`);
    assert.equal(backup.status, 401);
    assert.match(backup.headers.get('content-type') ?? '', /^application\/json/i);
    const backupBody = await backup.text();
    assert.deepEqual(JSON.parse(backupBody), { error: 'AUTH_REQUIRED' });
    assert.doesNotMatch(backupBody, /clear-pvc-700|companyAddress|tariffs|ADMIN_PASSWORD_HASH/i);

    const payload = requestPayload();
    const response = await fetch(`${origin}/api/quote/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '723e4567-e89b-42d3-a456-426614174000',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.match(Buffer.from(result.pdfBase64, 'base64').toString('latin1', 0, 8), /^%PDF-1\.7/);

    const log = await readFile(logPath, 'utf8');
    const events = log.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(events.length, 2);
    assert.deepEqual([...new Set(events.map(({ event }) => event))], ['quote_mail_simulated']);
    for (const value of Object.values(payload.contact)) {
      if (typeof value === 'string') assert.equal(log.includes(value), false);
    }
  } finally {
    server.kill();
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    await rm(outputRoot, { recursive: true, force: true });
  }
  assert.equal(diagnostics.includes('Fatal error'), false, diagnostics);
});

function requestPayload() {
  return {
    version: 1,
    project: { version: 1, products: [{
      id: 'window-1', type: 'window', shape: 'rectangle', position: 'right',
      dimensions: { width: 100, height: 100 }, material: 'clear-pvc-700', purpose: 'opening',
      hardware: 'plastic-turn-button', installation: { mode: 'top', edgeOffsetCm: 10, spacingCm: 20, replaceTopWithGrommets: false },
      border: { widthCm: 10, color: 'white' }, extras: { weightBar: false, flashing: false },
    }] },
    contact: { name: 'Test User', phone: '+7 000 000-00-00', email: 'built-package@example.test', consent: true },
    honeypot: '',
  };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`PHP server exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch { /* PHP server has not bound its socket yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Built-package PHP server did not become ready');
}
