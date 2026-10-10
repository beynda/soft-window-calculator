import assert from 'node:assert/strict';
import test from 'node:test';
import { fastenerCountText } from '../../src/shared/fasteners.js';
import { renderArchiveRecords } from '../../src/frontend/archive/index.js';

test('English fastener labels use singular only for one element', () => {
  assert.equal(fastenerCountText({ total: 1, positions: [] }), '1 fastener');
  assert.equal(fastenerCountText({ total: 0, positions: [] }), '0 fasteners');
  assert.equal(fastenerCountText({ total: 21, positions: [] }), '21 fasteners');
});

test('English labels distinguish one mounting position from two elements', () => {
  assert.equal(fastenerCountText({ total: 2, positions: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }), '1 position · 2 elements');
});

test('English archive labels and number formatting apply to a 21-product quote', () => {
  const html = renderArchiveRecords([{
    quoteNumber: 'Q-EN-TEST', createdAt: '2026-10-10T12:00:00Z',
    productCount: 21, total: 12500, currency: 'RUB',
    contact: { name: 'Test User', phone: '+7 000 000-00-00', email: 'user@example.test' },
  }]);
  assert.match(html, /21 products/);
  assert.match(html, /RUB\s?12,500/);
  assert.doesNotMatch(html, /[А-Яа-яЁё]/);
});
