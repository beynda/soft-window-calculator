import assert from 'node:assert/strict';
import test from 'node:test';

import { renderArchiveRecords } from '../../src/frontend/archive/index.js';

test('archive list renders manager-facing fields and escapes stored contacts', () => {
  const html = renderArchiveRecords([{
    quoteNumber: 'Q-TEST-1',
    createdAt: '2026-09-25T08:30:00+00:00',
    expiresAt: '2028-03-25T08:30:00+00:00',
    contact: { name: '<img src=x onerror=alert(1)>', phone: '+7 000 000-00-00', email: 'manager@example.test' },
    total: 12500,
    currency: 'RUB',
    productCount: 2,
    delivery: { company: { status: 'sent' }, client: { status: 'failed' } },
  }], '/window-calculator/archive/');

  assert.match(html, /Q-TEST-1/);
  assert.match(html, /manager@example\.test/);
  assert.match(html, /RUB\s?12,500/);
  assert.match(html, /2 products/);
  assert.doesNotMatch(html, /Company copy|Email/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /pdf=Q-TEST-1/);
});

test('archive list has a clear empty state', () => {
  assert.match(renderArchiveRecords([], '/archive/'), /No quotes found/);
});

test('archive uses compact collapsed rows with contact and date in the summary', () => {
  const html = renderArchiveRecords([{quoteNumber:'Q-TEST-1', createdAt:'2026-10-09T10:00:00Z',contact:{name:'Test',phone:'89000000000',email:'test@example.test'},total:1000}]);
  assert.match(html, /<details class="wc-archive-card"/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /<summary[\s\S]*Test[\s\S]*89000000000[\s\S]*<\/summary>/);
});

test('archive offers only download and edit, with saving in the contact form', () => {
  const records = [{ quoteNumber: 'Q-TEST-1' }, { quoteNumber: 'Q-TEST-2' }];
  const html = renderArchiveRecords(records, '/archive/', 'Q-TEST-1');
  assert.match(html, /Download PDF[\s\S]*Edit/);
  assert.doesNotMatch(html, /data-archive-save|data-archive-send|Save/);
});
