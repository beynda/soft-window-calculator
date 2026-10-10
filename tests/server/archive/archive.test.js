import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
const php = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
const phpSkip = php.error ? 'PHP is not installed locally' : Number(php.stdout) < 80100 ? `PHP 8.1+ required, found ${php.stdout}` : false;

test('archive edits overwrite in place, save without email, reject stale writes, and retry mail safely', { skip: phpSkip }, () => {
  const result = spawnSync('php', ['tests/server/archive/edit-smoke.php'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ARCHIVE_EDIT_OK/);
});

test('PHP quote archive stores protected PDFs, delivery state, search data, and expires after 18 months', { skip: phpSkip }, () => {
  const result = spawnSync('php', ['tests/server/archive/php-smoke.php'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ARCHIVE_PHP_SMOKE_OK/);
});

test('staff archive requires login for reads and CSRF for edits', { skip: phpSkip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beynda-archive-http-'));
  const configDirectory = join(directory, 'config');
  const runtimeDirectory = join(directory, 'runtime');
  const archiveDirectory = join(directory, 'archive');
  await cp(join(rootPath, 'storage'), configDirectory, { recursive: true });
  const configPath = join(configDirectory, 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.tariffs.materials['clear-pvc-700'] = 1000;
  config.tariffs.materials['tinted-pvc-700'] = 1200;
  for (const key of Object.keys(config.tariffs.hardware)) config.tariffs.hardware[key] = 10;
  config.tariffs.zipperPerMeter = 30;
  config.tariffs.weightBarPerMeter = 50;
  config.tariffs.flashingPerMeter = 60;
  await writeFile(configPath, JSON.stringify(config));
  const port = await availablePort();
  const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'server'], {
    cwd: rootPath,
    env: {
      ...process.env,
      ADMIN_PASSWORD_HASH: spawnSync('php', ['-r', "echo password_hash('archive-test-password', PASSWORD_DEFAULT);"], { encoding: 'utf8' }).stdout,
      ADMIN_RATE_LIMIT_PATH: join(runtimeDirectory, 'admin-attempts.json'),
      QUOTE_CONFIG_DIR: configDirectory,
      QUOTE_RUNTIME_DIR: runtimeDirectory,
      QUOTE_ARCHIVE_DIR: archiveDirectory,
      QUOTE_MAIL_TRANSPORT: 'log',
      QUOTE_MAIL_LOG_PATH: join(runtimeDirectory, 'mail.log'),
      QUOTE_IP_HASH_SALT: 'archive-http-ip-salt',
      QUOTE_IDEMPOTENCY_SALT: 'archive-http-idempotency-salt',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', (chunk) => { diagnostics += chunk; });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitForHttp(`${origin}/archive/`, server);
    const quoteResponse = await fetch(`${origin}/api/quote/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': '913e4567-e89b-42d3-a456-426614174000' },
      body: JSON.stringify(requestPayload()),
    });
    assert.equal(quoteResponse.status, 201);
    const quoteNumber = (await quoteResponse.json()).quoteNumber;

    for (const path of ['/archive/', `/archive/?edit=${quoteNumber}`, `/archive/?pdf=${quoteNumber}`]) {
      const denied = await fetch(origin + path);
      assert.equal(denied.status, 401);
      assert.doesNotMatch(await denied.text(), /manager@example.test|editToken|pdfBase64/);
    }
    assert.equal((await fetch(`${origin}/archive/`, { method: 'POST', body: '{}' })).status, 401);
    const loginPage = await fetch(`${origin}/admin/`);
    let cookie = loginPage.headers.getSetCookie()[0].split(';')[0];
    const csrf = (await loginPage.text()).match(/name="csrf" value="([^"]+)"/)[1];
    const login = await fetch(`${origin}/admin/`, { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'login', csrf, password: 'archive-test-password' }) });
    assert.equal(login.status, 303);
    cookie = login.headers.getSetCookie()[0].split(';')[0];
    const authenticatedFetch = (url, init = {}) => fetch(url, { ...init, headers: { cookie, ...init.headers } });
    const archiveResponse = await authenticatedFetch(`${origin}/archive/`);
    assert.equal(archiveResponse.status, 200);
    const archive = await archiveResponse.json();
    assert.equal(archive.ok, true);
    assert.equal(archive.records.length, 1);
    assert.equal(archive.records[0].contact.email, 'manager@example.test');
    assert.equal(archive.records[0].delivery.company.status, 'sent');
    assert.equal(archive.records[0].delivery.client.status, 'sent');

    const pdf = await authenticatedFetch(`${origin}/archive/?pdf=${encodeURIComponent(quoteNumber)}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(Buffer.from(await pdf.arrayBuffer()).toString('latin1', 0, 8), /^%PDF-1\.7/);

    const record = (await (await authenticatedFetch(`${origin}/archive/?edit=${quoteNumber}`)).json()).record;
    const payload = requestPayload();
    payload.project.products[0].dimensions.width = 250;
    const update = { ...payload, quoteNumber, editToken: record.editToken, send: false };
    const post = (body, key, extra = {}) => authenticatedFetch(`${origin}/archive/`, { method: 'POST', headers: { 'X-CSRF-Token': record.csrfToken, 'Content-Type': 'application/json', 'Idempotency-Key': key, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post(update, 'edit-http-csrf-test', { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await post(update, 'edit-http-test-00001', { Origin: 'https://foreign.test' })).status, 403);
    assert.equal((await post({ ...update, total: 1 }, 'edit-http-test-00002')).status, 400);
    const updated = await post(update, 'edit-http-test-00003');
    assert.equal(updated.status, 200, await updated.clone().text());
    assert.equal((await updated.json()).quoteNumber, quoteNumber);
    const reread = (await (await authenticatedFetch(`${origin}/archive/?edit=${quoteNumber}`)).json()).record;
    assert.equal(reread.project.products[0].dimensions.width, 250);
    assert.equal((await (await authenticatedFetch(`${origin}/archive/`)).json()).records.length, 1);
    assert.equal((await post(update, 'edit-http-test-00004')).status, 409);
  } finally {
    server.kill();
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(diagnostics.includes('Fatal error'), false, diagnostics);
});

function requestPayload() {
  return {
    version: 1,
    project: { version: 1, products: [{
      id: 'window-1', type: 'window', shape: 'rectangle', position: 'right',
      dimensions: { width: 100, height: 100 }, material: 'clear-pvc-700', purpose: 'opening',
      hardware: 'plastic-turn-button',
      hardwareBySide: { 'top-1': ['grommet'], 'right-2': [], 'bottom-3': [], 'left-4': [] },
      installation: { mode: 'top', edgeOffsetCm: 10, spacingCm: 20, replaceTopWithGrommets: false },
      border: { widthCm: 10, color: 'white' }, extras: { weightBar: false, flashing: false },
    }] },
    contact: { name: 'Test User', phone: '+7 000 000-00-00', email: 'manager@example.test', consent: true },
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`PHP server exited with ${server.exitCode}`);
    try { const response = await fetch(url); if (response.status < 500) return; } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('PHP server did not become ready');
}
