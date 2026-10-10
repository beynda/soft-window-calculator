import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const rootPath = fileURLToPath(root);
const publicKeys = [
  'availableOptions', 'companyAddress', 'currency', 'marketRates', 'ranges', 'savedAt',
  'tariffs', 'texts', 'vat', 'version',
];

async function fixture() {
  return JSON.parse(await readFile(new URL('storage/config.json', root), 'utf8'));
}

test('starter CalculatorConfig matches the public whitelist and contains editable demo tariffs', async () => {
  const config = await fixture();

  assert.deepEqual(Object.keys(config).sort(), publicKeys);
  assert.deepEqual(Object.keys(config.ranges).sort(), ['borderWidthCm', 'dimensions']);
  assert.deepEqual(Object.keys(config.ranges.dimensions).sort(), ['max', 'min', 'minSegment']);
  assert.deepEqual(Object.keys(config.ranges.borderWidthCm).sort(), ['max', 'min']);
  assert.deepEqual(Object.keys(config.availableOptions).sort(), ['hardware', 'materials']);
  assert.deepEqual(Object.keys(config.tariffs).sort(), [
    'flashingPerMeter', 'hardware', 'materials', 'surcharges',
    'weightBarPerMeter', 'zipperPerMeter',
  ]);
  assert.deepEqual(Object.keys(config.vat).sort(), ['mode', 'ratePercent']);
  assert.deepEqual(Object.keys(config.texts).sort(), ['configurationRequired', 'intro', 'privacy']);
  assert.deepEqual(Object.keys(config.tariffs.materials).sort(), ['clear-pvc-700', 'none', 'tinted-pvc-700']);
  assert.equal(Object.hasOwn(config.tariffs, 'border'), false);
  assert.deepEqual(Object.keys(config.tariffs.hardware).sort(), [
    'black-metal-turn-button', 'grommet', 'hook-strap-kit',
    'metal-turn-button', 'plastic-turn-button', 'strap-bracket-45',
  ]);
  assert.deepEqual(Object.keys(config.tariffs.surcharges).sort(), ['products', 'shapes']);
  assert.equal(config.companyAddress, '');
  assert.equal(config.ranges.dimensions.max, 1500);
  assert.equal(config.availableOptions.hardware.includes('weight-bar'), false);
  assert.deepEqual(config.vat, { mode: 'off', ratePercent: 0 });
  assert.ok(config.tariffs.materials['clear-pvc-700'] > 0);
  assert.ok(config.tariffs.materials['tinted-pvc-700'] > 0);
  assert.ok(config.tariffs.materials.none > 0);
  assert.ok(config.tariffs.zipperPerMeter > 0);
  assert.equal(JSON.stringify(config).includes('quotes@example.invalid'), false);
});

const php = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
const phpSkip = php.error ? 'PHP is not installed locally' : false;

test('PHP 8.1+ smoke verifies validation, recovery, public projection, auth, and CSRF', { skip: phpSkip }, () => {
  assert.ok(Number(php.stdout) >= 80100, `PHP 8.1+ required, found ${php.stdout}`);
  const result = spawnSync('php', ['tests/server/admin/php-smoke.php'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PHP_SMOKE_OK/);
});

test('PHP workers serialize config transactions and atomically reserve only five login attempts', { skip: phpSkip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beynda-admin-concurrency-'));
  try {
    await copyFile(new URL('storage/config.json', root), join(directory, 'config.json'));
    const configRuns = await Promise.all(Array.from({ length: 10 }, (_, index) => (
      runPhp(['tests/server/admin/php-concurrency-worker.php', 'config', directory, `writer-${index}`])
    )));
    assert.ok(configRuns.every(({ code, stderr }) => code === 0 && stderr === ''), JSON.stringify(configRuns));

    const active = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
    const backup = JSON.parse(await readFile(join(directory, 'config.backup.json'), 'utf8'));
    assert.match(active.texts.intro, /^writer-\d+$/);
    assert.match(backup.texts.intro, /^writer-\d+$/);
    assert.notEqual(active.texts.intro, backup.texts.intro);
    assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false);

    const attempts = await Promise.all(Array.from({ length: 12 }, () => (
      runPhp(['tests/server/admin/php-concurrency-worker.php', 'limiter', directory, 'shared-client'])
    )));
    assert.ok(attempts.every(({ code, stderr }) => code === 0 && stderr === ''), JSON.stringify(attempts));
    assert.equal(attempts.filter(({ stdout }) => stdout.trim() === 'reserved').length, 5);
    assert.equal(attempts.filter(({ stdout }) => stdout.trim() === 'blocked').length, 7);
    assert.equal((await readFile(join(directory, 'attempts.json'), 'utf8')).includes('shared-client'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PHP HTTP boundary protects editor and backup, validates CSRF, and exposes only public config', { skip: phpSkip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beynda-admin-http-'));
  const port = await availablePort();
  const hash = spawnSync('php', ['-r', "echo password_hash('local-test-password', PASSWORD_DEFAULT);"], { encoding: 'utf8' });
  assert.equal(hash.status, 0, hash.stderr);
  const server = spawn('php', [
    '-d', `session.save_path=${directory}`,
    '-S', `127.0.0.1:${port}`,
    '-t', 'server',
  ], {
    cwd: rootPath,
    env: {
      ...process.env,
      ADMIN_PASSWORD_HASH: hash.stdout,
      ADMIN_RATE_LIMIT_PATH: join(directory, 'attempts.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', (chunk) => { diagnostics += chunk; });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/config/public.php`, server);
    const unauthorizedBackup = await fetch(`http://127.0.0.1:${port}/admin/backup.php`);
    assert.equal(unauthorizedBackup.status, 401);

    const loginPage = await fetch(`http://127.0.0.1:${port}/admin/`);
    let cookie = responseCookie(loginPage);
    const loginHtml = await loginPage.text();
    assert.doesNotMatch(loginHtml, /<textarea/);
    const csrf = loginHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(csrf);
    const russianPage = await fetch(`http://127.0.0.1:${port}/admin/`, { headers: { cookie: 'beynda_language=ru' } });
    const russianHtml = await russianPage.text();
    assert.match(russianHtml, /<html lang="ru">/);
    assert.match(russianHtml, /Настройка калькулятора/);
    assert.doesNotMatch(russianHtml, /<textarea/);

    const login = await fetch(`http://127.0.0.1:${port}/admin/`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ action: 'login', csrf, password: 'local-test-password' }),
    });
    assert.equal(login.status, 303);
    cookie = responseCookie(login) || cookie;

    const editorPage = await fetch(`http://127.0.0.1:${port}/admin/`, { headers: { cookie } });
    const editorHtml = await editorPage.text();
    assert.doesNotMatch(editorHtml, /<textarea/);
    assert.match(editorHtml, /name="action" value="save_form"/);
    assert.match(editorHtml, /Clear PVC film, 700 microns/);
    assert.doesNotMatch(editorHtml, /name="recipientEmail"/);
    const editorCsrf = editorHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(editorCsrf);

    const rejected = await fetch(`http://127.0.0.1:${port}/admin/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ action: 'logout', csrf: 'wrong-token' }),
    });
    assert.equal(rejected.status, 200);
    assert.match(await rejected.text(), /Operation rejected/);

    const backupResponse = await fetch(`http://127.0.0.1:${port}/admin/backup.php`, { headers: { cookie } });
    assert.equal(backupResponse.status, 200);
    assert.match(backupResponse.headers.get('content-disposition') ?? '', /^attachment;/);
    const exported = await backupResponse.json();
    assert.deepEqual(Object.keys(exported).sort(), publicKeys);
    assert.equal(exported.companyAddress, '');
    assert.equal(JSON.stringify(exported).includes('quotes@example.invalid'), false);

    const publicResponse = await fetch(`http://127.0.0.1:${port}/config/public.php`);
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(Object.keys(await publicResponse.json()).sort(), publicKeys);
  } finally {
    server.kill();
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(diagnostics.includes('Fatal error'), false, diagnostics);
});

function runPhp(args) {
  return new Promise((resolve) => {
    const child = spawn('php', args, { cwd: rootPath, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url, server) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`PHP server exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Server has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('PHP server did not become ready');
}

function responseCookie(response) {
  const value = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '';
  return value.split(';', 1)[0];
}
