import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createQuotePrintHtml,
  downloadQuotePdf,
  isQuoteExportable,
  printQuote,
  renderQuoteSummary,
} from '../../src/frontend/summary/index.js';

function quote(status = 'ready') {
  return {
    version: 1,
    quoteNumber: 'Q-PRINT-1',
    createdAt: '2026-09-17T12:00:00.000Z',
    currency: 'RUB',
    status,
    statusText: status === 'ready' ? null : 'Pricing requires configuration',
    missingTariffs: status === 'ready' ? [] : ['border.perMeter'],
    products: [{
      id: 'window-1', type: 'window', shape: 'rectangle', position: 'extension-45',
      dimensions: { width: 120, height: 140 }, material: 'clear-pvc-700', purpose: 'opening',
      hardware: 'plastic-turn-button', installation: { mode: 'all', edgeOffsetCm: 10, spacingCm: 20, replaceTopWithGrommets: false },
      border: { widthCm: 10, color: 'white', segmentWidths: { 'top-1': 8, 'right-2': 11, 'bottom-3': 12, 'left-4': 9 } },
      extras: { flashing: true, weightBar: true },
      geometry: {
        shape: 'rectangle', areaM2: 1.68, perimeterM: 5.2,
        polygon: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 140 }, { x: 0, y: 140 }, { x: 0, y: 0 }],
        sides: [
          { id: 'top-1', role: 'top', start: { x: 0, y: 0 }, end: { x: 120, y: 0 }, lengthCm: 120 },
          { id: 'right-2', role: 'right', start: { x: 120, y: 0 }, end: { x: 120, y: 140 }, lengthCm: 140 },
          { id: 'bottom-3', role: 'bottom', start: { x: 120, y: 140 }, end: { x: 0, y: 140 }, lengthCm: 120 },
          { id: 'left-4', role: 'left', start: { x: 0, y: 140 }, end: { x: 0, y: 0 }, lengthCm: 140 },
        ],
        fasteners: { total: 24, positions: [], bySide: [], byHardware: { 'plastic-turn-button': 24 } },
      },
      subtotal: status === 'ready' ? 2500 : null,
    }],
    lineItems: status === 'ready' ? [
      { id: 'window-1:material', productId: 'window-1', component: 'material', label: 'Material', quantity: 1.68, unit: 'm2', unitPrice: 1000, amount: 1680 },
      { id: 'window-1:fastener', productId: 'window-1', component: 'fastener', label: 'Fasteners', quantity: 24, unit: 'piece', unitPrice: 12.5, amount: 300 },
    ] : [],
    subtotal: status === 'ready' ? 2500 : null,
    tax: { mode: 'off', ratePercent: 0, amount: status === 'ready' ? 0 : null },
    total: status === 'ready' ? 2500 : null,
  };
}

test('summary, print, and download expose one guarded Quote export seam', () => {
  const ready = quote();
  const blocked = quote('configuration-required');
  const html = renderQuoteSummary(ready);
  const printHtml = createQuotePrintHtml(ready);

  assert.equal(isQuoteExportable(ready), true);
  assert.equal(isQuoteExportable(blocked), false);
  assert.match(html, /Extension at 45°/);
  assert.match(html, /Width: 120 cm/);
  assert.match(html, /1\.68 m²/);
  assert.match(html, /24 pcs\./);
  assert.match(html, /Material/);
  assert.match(html, /Edging by side/);
  assert.match(html, /Top, segment 1: 8 cm/);
  assert.doesNotMatch(html, /<dt>Edging<\/dt>/);
  assert.doesNotMatch(html, /top-1/i);
  assert.match(html, /Bottom weight bar<\/dt><dd>Yes/);
  assert.match(html, /RUB\s?2,500/);
  assert.match(printHtml, /@page\s*{\s*size:\s*A4/);
  assert.match(printHtml, /Bottom, segment 3: 12 cm/);
  assert.doesNotMatch(printHtml, /<button/i);

  let opened = 0;
  assert.throws(() => printQuote(blocked, { windowRef: { open() { opened += 1; } } }), (error) => error.code === 'QUOTE_NOT_EXPORTABLE');
  assert.equal(opened, 0);

  let written = '';
  let printed = false;
  const printWindow = { document: { open() {}, write(value) { written = value; }, close() {} }, focus() {}, print() { printed = true; } };
  printQuote(ready, { windowRef: { open() { opened += 1; return printWindow; } } });
  assert.match(written, /Q-PRINT-1/);
  assert.equal(printed, true);

  let clicked = false;
  let revoked = '';
  const anchor = { click() { clicked = true; }, remove() {} };
  const documentRef = { body: { append() {} }, createElement() { return anchor; } };
  const URLRef = { createObjectURL() { return 'blob:quote'; }, revokeObjectURL(value) { revoked = value; } };
  const downloaded = downloadQuotePdf(ready, { documentRef, URLRef, BlobCtor: Blob });
  assert.ok(downloaded.bytes instanceof Uint8Array);
  assert.equal(downloaded.filename, 'quote-Q-PRINT-1.pdf');
  assert.equal(anchor.download, downloaded.filename);
  assert.equal(clicked, true);
  assert.equal(revoked, 'blob:quote');
  assert.throws(() => downloadQuotePdf(blocked, { documentRef, URLRef, BlobCtor: Blob }), (error) => error.code === 'QUOTE_NOT_EXPORTABLE');
});

test('summary distinguishes mounting positions from hardware elements', () => {
  const ready = quote();
  ready.products[0].geometry.fasteners = {
    total: 4,
    positions: [
      { x: 0, y: 0, hardware: 'grommet' },
      { x: 0, y: 0, hardware: 'plastic-turn-button' },
      { x: 120, y: 0, hardware: 'grommet' },
      { x: 120, y: 0, hardware: 'plastic-turn-button' },
    ],
    bySide: [],
    byHardware: { grommet: 2, 'plastic-turn-button': 2 },
  };
  const html = renderQuoteSummary(ready);

  assert.match(html, /2 positions · 4 elements/);
  assert.match(html, /Grommets: 2 pcs\./);
  assert.match(html, /Plastic turn button: 2 pcs\./);
});

test('summary shows the door zipper layout instead of a left or right side', () => {
  const ready = quote();
  ready.products[0].type = 'door';
  ready.products[0].position = 'left';
  delete ready.products[0].purpose;
  ready.products[0].zipperMode = 'center';

  const html = renderQuoteSummary(ready);
  assert.match(html, /Zipper layout<\/dt><dd>Centered/);
  assert.doesNotMatch(html, /Zipper side/);
});

test('ready Quote guard rejects incomplete nested products and line items before rendering', () => {
  const missingVersion = structuredClone(quote());
  delete missingVersion.version;
  const missingTariffState = structuredClone(quote());
  delete missingTariffState.missingTariffs;
  const missingInstallation = structuredClone(quote());
  delete missingInstallation.products[0].installation;
  const missingLineAmount = structuredClone(quote());
  delete missingLineAmount.lineItems[0].amount;
  const missingGeometryField = structuredClone(quote());
  delete missingGeometryField.products[0].geometry.polygon;
  const missingGrommetBoolean = structuredClone(quote());
  delete missingGrommetBoolean.products[0].installation.replaceTopWithGrommets;

  for (const incomplete of [null, {}, missingVersion, missingTariffState, missingInstallation, missingLineAmount, missingGeometryField, missingGrommetBoolean]) {
    assert.equal(isQuoteExportable(incomplete), false);
    assert.throws(
      () => createQuotePrintHtml(incomplete),
      (error) => error.code === 'QUOTE_NOT_EXPORTABLE' && error.name !== 'TypeError',
    );
  }
});

test('ready Quote guard requires every dimension declared by the product shape', () => {
  const dimensionsByShape = {
    rectangle: { width: 120, height: 140 },
    'trapezoid-right': { width: 120, height: 140, wallHeight: 90 },
    'trapezoid-left': { width: 120, height: 140, wallHeight: 90 },
    'trapezoid-both': { width: 120, height: 140, leftWallHeight: 90, rightWallHeight: 100 },
    'triangle-left': { width: 120, height: 140 },
    'triangle-right': { width: 120, height: 140 },
    'hexagon-peak': { width: 160, height: 180, wallHeight: 100, ridgeWidth: 40 },
    't-shape': { width: 180, height: 200, stemWidth: 70, crossbarHeight: 50 },
    octagon: { width: 160, height: 160, cutSize: 30 },
  };

  for (const [shape, dimensions] of Object.entries(dimensionsByShape)) {
    const complete = structuredClone(quote());
    complete.products[0].shape = shape;
    complete.products[0].geometry.shape = shape;
    complete.products[0].dimensions = dimensions;
    assert.equal(isQuoteExportable(complete), true, `${shape} with complete dimensions must be exportable`);

    for (const dimension of Object.keys(dimensions)) {
      const incomplete = structuredClone(complete);
      delete incomplete.products[0].dimensions[dimension];
      assert.equal(isQuoteExportable(incomplete), false, `${shape} without ${dimension} must be rejected`);
      assert.throws(() => createQuotePrintHtml(incomplete), (error) => error.code === 'QUOTE_NOT_EXPORTABLE');
    }
  }
});
