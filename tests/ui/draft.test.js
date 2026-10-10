import assert from 'node:assert/strict';
import test from 'node:test';

import * as draftApi from '../../src/frontend/calculator/draft.js';

const { clearDraft, loadDraft, saveDraft } = draftApi;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('draft persists only valid technical project data and clears corrupted content', () => {
  const storage = memoryStorage();
  const draft = {
    version: 1,
    activeProductId: 'window-1',
    updatedAt: '2026-09-17T10:00:00.000Z',
    products: [{
      id: 'window-1',
      type: 'window',
      shape: 'rectangle',
      dimensions: { width: 100, phone: '+7 000 000-00-00' },
      installation: { mode: 'top', customer: { email: 'hidden@example.test' } },
      hardwareBySide: { 'top-1': ['grommet', 'plastic-turn-button'], invalid: ['weight-bar'] },
      border: { widthCm: 10, contact: { fullName: 'Hidden name' } },
      extras: { flashing: false, email: 'nested@example.test' },
    }],
    contact: { name: 'Must not persist', phone: '+7 000 000-00-00' },
  };

  assert.equal(saveDraft(draft, storage), true);
  assert.deepEqual(loadDraft(storage), {
    version: 1,
    activeProductId: 'window-1',
    updatedAt: '2026-09-17T10:00:00.000Z',
    products: [{
      id: 'window-1',
      type: 'window',
      shape: 'rectangle',
      dimensions: { width: 100 },
      installation: { mode: 'top' },
      hardwareBySide: { 'top-1': ['grommet', 'plastic-turn-button'] },
      border: { widthCm: 10 },
      extras: { flashing: false },
    }],
  });
  const persisted = storage.getItem('beynda-soft-window-calculator-draft');
  assert.doesNotMatch(persisted, /phone|email|contact|fullName|Hidden|example\.test/);
  assert.equal('STORAGE_KEY' in draftApi, false);

  storage.setItem('beynda-soft-window-calculator-draft', '{broken');
  assert.equal(loadDraft(storage), null);
  assert.equal(storage.getItem('beynda-soft-window-calculator-draft'), null);

  saveDraft(draft, storage);
  clearDraft(storage);
  assert.equal(loadDraft(storage), null);
});

test('draft stores zipper layout and safely migrates the obsolete left or right zipper choice', () => {
  const storage = memoryStorage();
  const base = {
    version: 1,
    activeProductId: 'door-1',
    updatedAt: '2026-09-25T10:00:00.000Z',
    products: [{ id: 'door-1', type: 'door', shape: 'rectangle', zipperSide: 'left' }],
  };

  assert.equal(saveDraft(base, storage), true);
  assert.equal(loadDraft(storage).products[0].zipperMode, 'center');
  assert.equal('zipperSide' in loadDraft(storage).products[0], false);

  base.products[0] = { id: 'door-1', type: 'door', shape: 'rectangle', zipperMode: 'both-sides' };
  assert.equal(saveDraft(base, storage), true);
  assert.equal(loadDraft(storage).products[0].zipperMode, 'both-sides');
});
