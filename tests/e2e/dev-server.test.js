import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('dev server redirects the root URL to the public calculator', async (t) => {
  const child = spawn(process.execPath, ['tests/e2e/dev-server.mjs', '--port=0'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const [line] = await once(child.stdout, 'data');
  const address = String(line).trim();
  const rootResponse = await fetch(address, { redirect: 'manual' });

  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get('location'), '/public/');
});
