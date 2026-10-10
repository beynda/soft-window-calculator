import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateQuote } from '../../src/domain/pricing.js';

function rectangleWindow(overrides = {}) {
  return {
    id: 'window-1',
    type: 'window',
    shape: 'rectangle',
    position: 'right',
    dimensions: { width: 100, height: 100 },
    material: 'clear-pvc-700',
    purpose: 'opening',
    hardware: 'plastic-turn-button',
    installation: { mode: 'top', edgeOffsetCm: 10, spacingCm: 20 },
    border: { widthCm: 10, color: 'white' },
    extras: { weightBar: false, flashing: false },
    ...overrides,
  };
}

function rectangleDoor(overrides = {}) {
  return {
    id: 'door-1',
    type: 'door',
    shape: 'rectangle',
    position: 'left',
    dimensions: { width: 100, height: 200 },
    material: 'tinted-pvc-700',
    hardware: 'metal-turn-button',
    zipperMode: 'center',
    installation: { mode: 'top', edgeOffsetCm: 10, spacingCm: 40 },
    border: { widthCm: 10, color: '#123456' },
    extras: { weightBar: false, flashing: false },
    ...overrides,
  };
}

test('calculateQuote reports configuration-required instead of inventing prices', () => {
  const quote = calculateQuote(
    { version: 1, products: [rectangleWindow()] },
    { version: 1, currency: 'RUB', tariffs: {}, vat: { mode: 'off', ratePercent: 0 } },
  );

  assert.equal(quote.status, 'configuration-required');
  assert.equal(quote.statusText, 'Pricing requires configuration');
  assert.equal(quote.total, null);
  assert.deepEqual(quote.lineItems, []);
  assert.ok(quote.missingTariffs.includes('materials.clear-pvc-700'));
  assert.equal(quote.missingTariffs.includes('border.perMeter'), false);
  assert.ok(quote.missingTariffs.includes('hardware.plastic-turn-button'));
  assert.equal(quote.products[0].geometry.areaM2, 1);
});

test('calculateQuote itemizes every price component and rounds additive VAT to rubles', () => {
  const quote = calculateQuote(
    {
      version: 1,
      products: [
        rectangleWindow({
          installation: { mode: 'all', edgeOffsetCm: 10, spacingCm: 40 },
          extras: { weightBar: true, flashing: true },
        }),
        rectangleDoor(),
      ],
    },
    {
      version: 1,
      currency: 'RUB',
      tariffs: {
        materials: { 'clear-pvc-700': 1000, 'tinted-pvc-700': 1200 },
        border: { perMeter: 100, baseWidthCm: 10 },
        hardware: { 'plastic-turn-button': 10, 'metal-turn-button': 20 },
        zipperPerMeter: 30,
        weightBarPerMeter: 50,
        flashingPerMeter: 60,
        surcharges: {
          shapes: { rectangle: { type: 'percent', value: 10, label: 'Shape' } },
          products: { door: { type: 'fixed', value: 200, label: 'Door' } },
        },
      },
      vat: { mode: 'additive', ratePercent: 20 },
    },
  );

  assert.equal(quote.status, 'ready');
  assert.deepEqual(quote.products.map(({ subtotal }) => subtotal), [1353, 2972]);
  assert.equal(quote.subtotal, 4325);
  assert.deepEqual(quote.tax, { mode: 'additive', ratePercent: 20, amount: 865 });
  assert.equal(quote.total, 5190);
  assert.deepEqual(new Set(quote.lineItems.map(({ component }) => component)), new Set([
    'material', 'fastener', 'zipper', 'weight-bar', 'flashing', 'surcharge', 'vat',
  ]));
  assert.equal(quote.lineItems.find(({ component }) => component === 'material').amount, 1000);
  assert.equal(quote.lineItems.find(({ component }) => component === 'fastener').amount, 120);
  assert.equal(quote.lineItems.find(({ component }) => component === 'weight-bar').amount, 50);
  assert.equal(quote.lineItems.find(({ component }) => component === 'flashing').amount, 60);
  assert.equal(quote.lineItems.find(({ component }) => component === 'zipper').amount, 60);
});

test('door zipper is either centered or installed on both sides and is priced by total zipper length', () => {
  const config = {
    version: 1,
    currency: 'RUB',
    tariffs: {
      materials: { 'tinted-pvc-700': 1200 },
      hardware: { 'metal-turn-button': 20 },
      zipperPerMeter: 30,
    },
    vat: { mode: 'off', ratePercent: 0 },
  };

  const centered = calculateQuote({ version: 1, products: [rectangleDoor()] }, config);
  const bothSides = calculateQuote({
    version: 1,
    products: [rectangleDoor({ zipperMode: 'both-sides' })],
  }, config);

  assert.equal(centered.products[0].zipperMode, 'center');
  assert.equal(centered.lineItems.find(({ component }) => component === 'zipper').quantity, 2);
  assert.equal(bothSides.products[0].zipperMode, 'both-sides');
  assert.equal(bothSides.lineItems.find(({ component }) => component === 'zipper').quantity, 4);
  assert.throws(
    () => calculateQuote({ version: 1, products: [rectangleDoor({ zipperMode: 'left' })] }, config),
    (error) => error.field === 'products.0.zipperMode' && /zipper layout/i.test(error.message),
  );
});

test('calculateQuote rejects incompatible and administratively disabled options', () => {
  const configured = {
    version: 1,
    currency: 'RUB',
    availableOptions: { materials: ['clear-pvc-700'] },
    tariffs: {},
    vat: { mode: 'off', ratePercent: 0 },
  };

  assert.throws(
    () => calculateQuote({
      version: 1,
      products: [rectangleWindow({ purpose: 'fixed', hardware: 'strap-bracket-45' })],
    }, configured),
    (error) => error.field === 'products.0.hardware' && /incompatible/.test(error.message),
  );
  assert.throws(
    () => calculateQuote({
      version: 1,
      products: [rectangleWindow({ material: 'tinted-pvc-700' })],
    }, configured),
    (error) => error.field === 'products.0.material' && /unavailable/.test(error.message),
  );
  assert.throws(
    () => calculateQuote({
      version: 1,
      products: Array.from({ length: 11 }, (_, index) => rectangleWindow({ id: `window-${index + 1}` })),
    }, configured),
    /at most 10 windows/,
  );
});

test('weight-bar hardware is priced by bottom length and never as piece fasteners', () => {
  const quote = calculateQuote(
    {
      version: 1,
      products: [rectangleWindow({ hardware: 'weight-bar' })],
    },
    {
      version: 1,
      currency: 'RUB',
      tariffs: {
        materials: { 'clear-pvc-700': 1000 },
        border: { perMeter: 100, baseWidthCm: 10 },
        weightBarPerMeter: 50,
      },
      vat: { mode: 'off', ratePercent: 0 },
    },
  );

  assert.equal(quote.status, 'ready');
  assert.equal(quote.products[0].geometry.fasteners.total, 0);
  assert.equal(quote.lineItems.some(({ component }) => component === 'fastener'), false);
  assert.deepEqual(
    quote.lineItems.find(({ component }) => component === 'weight-bar'),
    {
      id: 'window-1:weight-bar:2',
      productId: 'window-1',
      component: 'weight-bar',
      label: 'Weight bar',
      quantity: 1,
      unit: 'm',
      unitPrice: 50,
      amount: 50,
    },
  );
});

test('several hardware types on one side are priced separately while weight bar stays a bottom extra', () => {
  const quote = calculateQuote({
    version: 1,
    products: [rectangleWindow({
      hardwareBySide: { 'top-1': ['grommet', 'plastic-turn-button'] },
      installation: { mode: 'all', edgeOffsetCm: 'auto', spacingCm: 30 },
      extras: { weightBar: true, flashing: true },
    })],
  }, {
    version: 1,
    currency: 'RUB',
    tariffs: {
      materials: { 'clear-pvc-700': 1000 },
      border: { perMeter: 100, baseWidthCm: 10 },
      hardware: { grommet: 10, 'plastic-turn-button': 20 },
      weightBarPerMeter: 50,
      flashingPerMeter: 60,
    },
    vat: { mode: 'off', ratePercent: 0 },
  });

  assert.equal(quote.status, 'ready');
  assert.deepEqual(
    quote.lineItems.filter(({ component }) => component === 'fastener').map(({ label, option, quantity, amount }) => ({ label, option, quantity, amount })),
    [
      { label: 'Fasteners - Grommets', option: 'grommet', quantity: 4, amount: 40 },
      { label: 'Fasteners - Plastic turn button', option: 'plastic-turn-button', quantity: 4, amount: 80 },
    ],
  );
  assert.equal(quote.lineItems.find(({ component }) => component === 'weight-bar').quantity, 1);
  assert.equal(quote.lineItems.find(({ component }) => component === 'flashing').quantity, 1);
});

test('custom border color requires and preserves a safe concrete color value', () => {
  const config = {
    version: 1,
    currency: 'RUB',
    tariffs: {
      materials: { 'clear-pvc-700': 1000 },
      border: { perMeter: 100, baseWidthCm: 10 },
      hardware: { 'plastic-turn-button': 10 },
    },
    vat: { mode: 'off', ratePercent: 0 },
  };

  assert.throws(
    () => calculateQuote({
      version: 1,
      products: [rectangleWindow({ border: { widthCm: 10, color: 'custom' } })],
    }, config),
    (error) => error.field === 'products.0.border.customColor' && /color/i.test(error.message),
  );

  const quote = calculateQuote({
    version: 1,
    products: [rectangleWindow({
      border: { widthCm: 10, color: 'custom', customColor: '#Ab12Cd' },
    })],
  }, config);

  assert.deepEqual(quote.products[0].border, {
    widthCm: 10,
    color: '#Ab12Cd',
    colorPreset: 'custom',
  });
  assert.notEqual(quote.products[0].border.color, 'custom');
});

test('material square-metre tariff includes edging for every material option', () => {
  const config = {
    version: 1,
    currency: 'RUB',
    availableOptions: {
      materials: ['clear-pvc-700', 'tinted-pvc-700', 'none'],
      hardware: ['grommet', 'hook-strap-kit'],
    },
    tariffs: {
      materials: { 'clear-pvc-700': 1200, 'tinted-pvc-700': 1500, none: 1200 },
      border: { perMeter: 999999, baseWidthCm: 10 },
      hardware: { grommet: 20, 'hook-strap-kit': 180 },
    },
    vat: { mode: 'off', ratePercent: 0 },
  };

  for (const [material, expected] of [['clear-pvc-700', 1200], ['tinted-pvc-700', 1500], ['none', 1200]]) {
    const quote = calculateQuote({
      version: 1,
      products: [rectangleWindow({ material, hardwareBySide: { 'top-1': [] } })],
    }, config);
    assert.equal(quote.status, 'ready');
    assert.equal(quote.total, expected);
    assert.deepEqual(quote.lineItems.map(({ component }) => component), ['material']);
    assert.equal(quote.lineItems[0].label, 'Material including edging');
  }
});

test('hook-strap kits are priced for the whole product with a minimum of two', () => {
  const config = {
    version: 1,
    currency: 'RUB',
    availableOptions: { materials: ['clear-pvc-700'], hardware: ['grommet', 'hook-strap-kit'] },
    tariffs: {
      materials: { 'clear-pvc-700': 1200 },
      hardware: { grommet: 20, 'hook-strap-kit': 180 },
    },
    vat: { mode: 'off', ratePercent: 0 },
  };
  const quote = calculateQuote({
    version: 1,
    products: [rectangleWindow({
      hardwareBySide: { 'top-1': [] },
      extras: { weightBar: false, flashing: false, hookStrapKits: 3 },
    })],
  }, config);

  assert.deepEqual(
    quote.lineItems.find(({ component }) => component === 'hook-strap-kit'),
    {
      id: 'window-1:hook-strap-kit:2',
      productId: 'window-1',
      component: 'hook-strap-kit',
      label: 'Hook and strap',
      quantity: 3,
      unit: 'kit',
      unitPrice: 180,
      amount: 540,
    },
  );
  assert.equal(quote.total, 1740);
  assert.throws(
    () => calculateQuote({
      version: 1,
      products: [rectangleWindow({
        hardwareBySide: { 'top-1': [] },
        extras: { weightBar: false, flashing: false, hookStrapKits: 1 },
      })],
    }, config),
    (error) => error.field === 'products.0.extras.hookStrapKits' && /minimum of 2/i.test(error.message),
  );
});
