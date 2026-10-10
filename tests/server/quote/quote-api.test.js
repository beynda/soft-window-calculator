import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const rootPath = fileURLToPath(new URL('../../../', import.meta.url));
const php = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
const phpSkip = php.error ? 'PHP is not installed locally' : Number(php.stdout) < 80100 ? `PHP 8.1+ required, found ${php.stdout}` : false;

test('PHP quote smoke recalculates, renders one PDF, sends twice, hashes IP, and deduplicates', { skip: phpSkip }, () => {
  const result = spawnSync('php', ['tests/server/quote/php-smoke.php'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /QUOTE_PHP_SMOKE_OK/);
});

test('PHP quote state uses one stable lock for parallel rate reservations and idempotency claims', { skip: phpSkip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beynda-quote-concurrency-'));
  try {
    const ratePath = join(directory, 'rate.json');
    const rateRuns = await Promise.all(Array.from({ length: 20 }, () => runPhp(['tests/server/quote/php-concurrency-worker.php', 'rate', ratePath, 'same'])));
    assert.ok(rateRuns.every(({ code, stderr }) => code === 0 && stderr === ''), JSON.stringify(rateRuns));
    assert.equal(rateRuns.filter(({ stdout }) => stdout === 'reserved').length, 5);
    assert.equal(rateRuns.filter(({ stdout }) => stdout === 'blocked').length, 15);
    const rateState = JSON.parse(await readFile(ratePath, 'utf8'));
    assert.equal(Object.values(rateState)[0].length, 5);

    const sharedPath = join(directory, 'shared-claims.json');
    const shared = await Promise.all(Array.from({ length: 12 }, () => runPhp(['tests/server/quote/php-concurrency-worker.php', 'claim', sharedPath, '423e4567-e89b-42d3-a456-426614174000'])));
    assert.equal(shared.filter(({ stdout }) => stdout === 'new').length, 1);
    assert.equal(shared.filter(({ stdout }) => stdout === 'pending').length, 11);

    const uniquePath = join(directory, 'unique-claims.json');
    const unique = await Promise.all(Array.from({ length: 20 }, (_, index) => runPhp(['tests/server/quote/php-concurrency-worker.php', 'claim', uniquePath, `523e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`])));
    assert.ok(unique.every(({ code, stdout, stderr }) => code === 0 && stdout === 'new' && stderr === ''), JSON.stringify(unique));
    assert.equal(Object.keys(JSON.parse(await readFile(uniquePath, 'utf8'))).length, 20);
    assert.equal((await readdir(directory)).some((name) => name.includes('.tmp-') || name.includes('.old-')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PHP HTTP quote boundary rejects client totals and keeps log transport free of contacts', { skip: phpSkip }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beynda-quote-http-'));
  const configDirectory = join(directory, 'config');
  const runtimeDirectory = join(directory, 'runtime');
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
      QUOTE_CONFIG_DIR: configDirectory,
      QUOTE_RUNTIME_DIR: runtimeDirectory,
      QUOTE_ARCHIVE_DIR: join(directory, 'archive'),
      QUOTE_MAIL_TRANSPORT: 'log',
      QUOTE_MAIL_LOG_PATH: join(runtimeDirectory, 'mail.log'),
      QUOTE_IP_HASH_SALT: 'http-ip-hash-test-salt',
      QUOTE_IDEMPOTENCY_SALT: 'http-idempotency-test-salt',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', (chunk) => { diagnostics += chunk; });
  try {
    const url = `http://127.0.0.1:${port}/api/quote/`;
    await waitForHttp(url, server);
    const payload = requestPayload();
    const headers = { 'content-type': 'application/json', 'idempotency-key': '123e4567-e89b-42d3-a456-426614174000' };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 201, `${diagnostics}\n${(await response.clone().text()).slice(0, 1500)}`);
    const delivered = await response.json();
    assert.equal(delivered.ok, true);
    assert.equal(delivered.quote.total, 1100);
    assert.match(Buffer.from(delivered.pdfBase64, 'base64').toString('latin1', 0, 8), /^%PDF-1\.7/);

    const duplicate = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(duplicate.status, 201);
    assert.equal((await duplicate.json()).quoteNumber, delivered.quoteNumber);
    const log = await readFile(join(runtimeDirectory, 'mail.log'), 'utf8');
    const events = log.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(events.length, 2);
    assert.equal(events[0].pdfSha256, events[1].pdfSha256);
    assert.equal(log.includes(payload.contact.email), false);
    assert.equal(log.includes(payload.contact.phone), false);
    assert.equal(log.includes(payload.contact.name), false);

    const untrusted = { ...payload, quote: { total: 1 }, pdf: 'client-data' };
    const rejected = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': '223e4567-e89b-42d3-a456-426614174000' },
      body: JSON.stringify(untrusted),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'INVALID_SCHEMA');
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
      hardwareBySide: { 'top-1': ['grommet', 'plastic-turn-button'], 'right-2': [], 'bottom-3': [], 'left-4': [] },
      installation: { mode: 'top', edgeOffsetCm: 10, spacingCm: 20, replaceTopWithGrommets: false },
      border: { widthCm: 10, color: 'white' }, extras: { weightBar: false, flashing: false },
    }] },
    contact: { name: 'Test User', phone: '+7 000 000-00-00', email: 'client@example.test', consent: true },
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

function runPhp(args) {
  return new Promise((resolve) => {
    const child = spawn('php', args, { cwd: rootPath, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  });
}

async function waitForHttp(url, server) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`PHP server exited with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch { /* not bound yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('PHP server did not become ready');
}
