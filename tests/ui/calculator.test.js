import assert from 'node:assert/strict';
import test from 'node:test';

import { mountCalculator } from '../../src/frontend/calculator/index.js';

function rootStub() {
  return {
    innerHTML: '',
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
    contains() { return true; },
    querySelector() { return null; },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const config = {
  version: 1,
  currency: 'RUB',
  ranges: { dimensions: { min: 20, max: 1500, minSegment: 5 }, borderWidthCm: { min: 7, max: 15 } },
  tariffs: {
    materials: { 'clear-pvc-700': 1000, 'tinted-pvc-700': 1200 },
    border: { perMeter: 100, baseWidthCm: 10 },
    hardware: {
      grommet: 10,
      'plastic-turn-button': 20,
      'metal-turn-button': 25,
      'black-metal-turn-button': 30,
      'strap-bracket-45': 35,
      'hook-strap-kit': 180,
    },
    zipperPerMeter: 50,
    weightBarPerMeter: 80,
    flashingPerMeter: 70,
  },
  vat: { mode: 'off', ratePercent: 0 },
};

test('archive project loads products and rejects an empty replacement', () => {
  const calculator = mountCalculator(rootStub(), config, { storage: memoryStorage() });
  calculator.addProduct('door');
  const products = calculator.getState().products;
  products[0].dimensions.width = 250;
  products[0].extras.hookStrapKits = 3;
  calculator.loadProject({ version: 1, products });
  assert.equal(calculator.getState().products.length, 2);
  assert.equal(calculator.getState().products[0].dimensions.width, 250);
  assert.equal(calculator.getState().products[0].extras.hookStrapKits, 3);
  assert.throws(() => calculator.loadProject({ version: 1, products: [] }));
  assert.equal(calculator.getState().products.length, 2);
});

test('hook-strap kit is a whole-product manual quantity and renamed strap hardware is shown', () => {
  const root = rootStub();
  const calculator = mountCalculator(root, {
    ...config,
    availableOptions: {
      materials: ['clear-pvc-700', 'tinted-pvc-700', 'none'],
      hardware: ['grommet', 'plastic-turn-button', 'strap-bracket-45', 'hook-strap-kit'],
    },
  }, { storage: memoryStorage() });
  const id = calculator.getState().activeProductId;

  assert.match(root.innerHTML, /Bracket and strap/);
  assert.match(root.innerHTML, /Hook and strap/);
  assert.doesNotMatch(root.innerHTML, /data-hardware="hook-strap-kit"/);
  calculator.updateProduct(id, 'extras.hookStrapKits', 2);
  assert.match(root.innerHTML, /min="2"[^>]+data-field-path="extras\.hookStrapKits"/);
  assert.match(root.innerHTML, /Hook and strap[\s\S]*2 kits/);
  assert.equal((root.innerHTML.match(/class="wc-hook-strap"/g) ?? []).length, 2);
  assert.equal(calculator.getState().quote.lineItems.find(({ component }) => component === 'hook-strap-kit').quantity, 2);
});

test('mountCalculator drives product limits, compatibility, geometry, quote, and last-item replacement', () => {
  const root = rootStub();
  const storage = memoryStorage();
  const calculator = mountCalculator(root, config, { storage, now: () => '2026-09-17T10:00:00.000Z' });

  assert.equal((root.innerHTML.match(/data-shape-id=/g) ?? []).length, 9);
  const firstTotal = calculator.getState().quote.total;
  const firstId = calculator.getState().activeProductId;
  calculator.updateProduct(firstId, 'dimensions.width', 200);
  assert.ok(calculator.getState().quote.total > firstTotal);

  for (let index = 1; index < 10; index += 1) assert.equal(calculator.addProduct('window'), true);
  assert.equal(calculator.addProduct('window'), false);
  assert.match(calculator.getState().notice, /at most 10 windows/i);

  assert.equal(calculator.addProduct('door'), true);
  assert.equal(calculator.addProduct('door'), true);
  assert.equal(calculator.addProduct('door'), false);
  const door = calculator.getState().products.find(({ type }) => type === 'door');
  assert.equal(door.shape, 'rectangle');
  assert.deepEqual(door.availableInstallationModes, ['top', 'top-bottom']);
  assert.deepEqual(door.availablePositions, ['left', 'right']);

  calculator.updateProduct(firstId, 'hardwareBySide.top-1', ['strap-bracket-45']);
  calculator.updateProduct(firstId, 'purpose', 'fixed');
  assert.deepEqual(calculator.getState().products.find(({ id }) => id === firstId).hardwareBySide['top-1'], []);

  for (const product of [...calculator.getState().products]) calculator.removeProduct(product.id);
  assert.equal(calculator.getState().products.length, 1);
  assert.equal(calculator.getState().products[0].type, 'window');
  assert.notEqual(storage.getItem('beynda-soft-window-calculator-draft'), null);
});

test('per-side border controls use geometry side ids without adding a separate edging charge', () => {
  const root = rootStub();
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  const id = calculator.getState().activeProductId;
  const originalTotal = calculator.getState().quote.total;

  calculator.updateProduct(id, 'border.perSide', true);
  assert.match(root.innerHTML, /data-field-path="border\.widthsBySide\.top-1"/);
  assert.doesNotMatch(root.innerHTML, /<dt>Edging<\/dt>/);
  assert.match(root.innerHTML, /<dt>Edging by side<\/dt>/);
  calculator.updateProduct(id, 'border.widthsBySide.top-1', 15);

  assert.equal(calculator.getState().quote.total, originalTotal);
});

test('drawing exposes flashing and the selected door zipper layout', () => {
  const root = rootStub();
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  calculator.addProduct('door');
  const door = calculator.getState().products.find(({ type }) => type === 'door');
  calculator.updateProduct(door.id, 'extras.flashing', true);
  calculator.updateProduct(door.id, 'zipperMode', 'both-sides');

  assert.match(root.innerHTML, /class="wc-flashing"/);
  assert.equal((root.innerHTML.match(/class="wc-zipper"/g) ?? []).length, 2);
  assert.match(root.innerHTML, /Zipper both sides/);
});

test('dimension change event recalculates after editing completes through the mounted UI', () => {
  const root = rootStub();
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  const before = calculator.getState().quote.total;
  const input = {
    type: 'number',
    value: '220',
    dataset: { fieldPath: 'dimensions.width' },
    closest() { return this; },
  };

  root.listeners.get('change')({ target: input });

  assert.equal(calculator.getState().products[0].dimensions.width, 220);
  assert.ok(calculator.getState().quote.total > before);
});

test('publicly disabled materials and hardware are omitted from controls', () => {
  const root = rootStub();
  mountCalculator(root, {
    ...config,
    availableOptions: { materials: ['clear-pvc-700'], hardware: ['grommet'] },
  }, { storage: memoryStorage() });

  assert.doesNotMatch(root.innerHTML, /value="tinted-pvc-700"/);
  assert.doesNotMatch(root.innerHTML, /data-hardware="plastic-turn-button"/);
  assert.match(root.innerHTML, /data-hardware="grommet"/);
});

test('invalid border value is announced at the field and receives focus', async () => {
  const root = rootStub();
  let focused = false;
  root.querySelector = (selector) => selector === '[data-field-path="border.widthCm"][aria-invalid="true"]' && root.innerHTML.includes('aria-invalid="true"')
    ? { focus() { focused = true; } }
    : null;
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });

  calculator.updateProduct(calculator.getState().activeProductId, 'border.widthCm', 99);
  await Promise.resolve();

  assert.match(root.innerHTML, /data-field-path="border\.widthCm"[^>]+aria-invalid="true"/);
  assert.match(root.innerHTML, /Edging width must be between 7 and 15 cm/);
  assert.equal(focused, true);
});

test('UI keeps dimensions outside SVG, product error context, door options, visual equipment, and complete summaries', async () => {
  const root = rootStub();
  let focused = false;
  root.querySelector = (selector) => selector === '[data-field-path="border.widthCm"][aria-invalid="true"]'
    ? { focus() { focused = true; } }
    : null;
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  calculator.addProduct('window');
  const secondWindow = calculator.getState().activeProductId;
  calculator.selectProduct('window-1');
  calculator.updateProduct(secondWindow, 'border.widthCm', 99);
  await Promise.resolve();

  assert.equal(calculator.getState().activeProductId, secondWindow);
  assert.equal(focused, true);
  calculator.updateProduct(secondWindow, 'border.widthCm', 10);
  calculator.addProduct('door');
  const doorId = calculator.getState().activeProductId;
  assert.doesNotMatch(root.innerHTML, /value="weight-bar"/);
  calculator.updateProduct(doorId, 'hardwareBySide.top-1', ['grommet', 'plastic-turn-button']);
  calculator.updateProduct(doorId, 'border.perSide', true);
  calculator.updateProduct(doorId, 'border.widthsBySide.top-1', 15);

  assert.match(root.innerHTML, /class="wc-dimension-grid"/);
  assert.doesNotMatch(root.innerHTML.match(/<div class="wc-svg-stage"[\s\S]*?<\/div><\/div>/)?.[0] ?? '', /wc-field--dimension/);
  assert.match(root.innerHTML, /wc-fastener--grommet/);
  assert.match(root.innerHTML, /wc-fastener--plastic-turn-button/);
  assert.match(root.innerHTML, /data-side-id="top-1"[^>]+stroke-width="15"/);
  for (const label of ['Material', 'Purpose', 'Hardware', 'Spacing', 'Edging']) assert.match(root.innerHTML, new RegExp(label));
  assert.doesNotMatch(root.innerHTML, />Installation</);
});

test('shape dimensions remain separate from the schematic, local errors focus, and summary stays unambiguous', async () => {
  const root = rootStub();
  let focusedSelector = null;
  root.querySelector = (selector) => {
    if (selector !== '[data-field-path="dimensions.width"][aria-invalid="true"]') return null;
    return { focus() { focusedSelector = selector; } };
  };
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  const firstId = calculator.getState().activeProductId;

  calculator.updateProduct(firstId, 'shape', 't-shape');
  for (const name of ['width', 'height', 'stemWidth', 'crossbarHeight']) {
    assert.match(root.innerHTML, new RegExp(`data-dimension-name="${name}"`));
  }
  assert.match(root.innerHTML, /max="1500"/);
  assert.match(root.innerHTML, /min="20"/);
  assert.doesNotMatch(root.innerHTML, /Drawing not to scale|wc-not-to-scale/);
  calculator.updateProduct(firstId, 'shape', 'triangle-left');
  assert.match(root.innerHTML, /data-dimension-name="height"/);
  calculator.updateProduct(firstId, 'shape', 'trapezoid-left');
  assert.match(root.innerHTML, /data-dimension-name="height"/);
  assert.match(root.innerHTML, /data-dimension-name="wallHeight"/);

  calculator.addProduct('window');
  const secondId = calculator.getState().activeProductId;
  calculator.selectProduct(firstId);
  calculator.updateProduct(secondId, 'dimensions.width', 5);
  await Promise.resolve();
  assert.equal(calculator.getState().activeProductId, secondId);
  assert.equal(focusedSelector, '[data-field-path="dimensions.width"][aria-invalid="true"]');

  calculator.addProduct('door');
  const doorId = calculator.getState().activeProductId;
  calculator.updateProduct(doorId, 'zipperMode', 'center');
  calculator.updateProduct(doorId, 'installation.edgeOffsetCm', 10);
  calculator.updateProduct(doorId, 'installation.spacingCm', 40);
  calculator.updateProduct(doorId, 'hardwareBySide.top-1', ['grommet']);
  calculator.updateProduct(doorId, 'extras.flashing', true);
  calculator.updateProduct(doorId, 'border.perSide', true);
  calculator.updateProduct(doorId, 'border.widthsBySide.top-1', 15);
  for (const text of ['Zipper layout', 'Centered', 'Offset', '10 cm', 'Spacing', '40 cm', 'Hardware', 'Grommets', 'Flashing', 'Edging by side', '15 cm']) {
    assert.match(root.innerHTML, new RegExp(text));
  }
});

test('dimension inputs use the limits configured in the admin panel', () => {
  const root = rootStub();
  const customConfig = structuredClone(config);
  customConfig.ranges.dimensions = { min: 35, max: 550, minSegment: 8 };
  mountCalculator(root, customConfig, { storage: memoryStorage() });

  assert.match(root.innerHTML, /data-dimension-name="width"[\s\S]*?<input type="number" min="35" max="550"/);
  assert.match(root.innerHTML, /data-dimension-name="height"[\s\S]*?<input type="number" min="35" max="550"/);
});

test('hardware is configured by drawing side, dimensions stay outside the drawing, and bottom extras are adjacent', () => {
  const root = rootStub();
  const calculator = mountCalculator(root, config, { storage: memoryStorage() });
  const id = calculator.getState().activeProductId;

  assert.doesNotMatch(root.innerHTML, />Installation</);
  assert.doesNotMatch(root.innerHTML, />Hardware<\/span><select/);
  assert.match(root.innerHTML, /data-action="select-side"/);
  assert.match(root.innerHTML, /data-action="toggle-side-hardware"/);
  assert.doesNotMatch(root.innerHTML, /wc-border-segment is-selected/);
  assert.match(root.innerHTML, /wc-segment-label-bg is-selected/);
  assert.match(root.innerHTML, /Bottom weight bar/);
  assert.match(root.innerHTML, /Bottom flashing, 20 cm/);
  assert.doesNotMatch(root.innerHTML.match(/<div class="wc-svg-stage"[\s\S]*?<\/div><\/div>/)?.[0] ?? '', /wc-field--dimension/);
  assert.match(root.innerHTML, /class="wc-dimension-grid"/);

  calculator.updateProduct(id, 'hardwareBySide.top-1', ['grommet', 'plastic-turn-button']);
  assert.deepEqual(calculator.getState().quote.products[0].geometry.fasteners.byHardware, {
    grommet: 4,
    'plastic-turn-button': 4,
  });
  assert.equal((root.innerHTML.match(/class="wc-fastener-position"/g) ?? []).length, 4);
  assert.equal((root.innerHTML.match(/data-hardware-count="2"/g) ?? []).length, 4);
  assert.match(root.innerHTML, /4 position[^<]*· 8 elements/);
});
