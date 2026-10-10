import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuotePdf } from '../../src/frontend/pdf/index.js';

function product(index) {
  const id = `window-${index}`;
  return {
    id,
    type: 'window',
    shape: 'rectangle',
    position: index % 2 ? 'right' : 'extension-45',
    dimensions: { width: 120 + index, height: 140 },
    material: 'clear-pvc-700',
    purpose: 'opening',
    hardware: 'plastic-turn-button',
    installation: { mode: 'all', edgeOffsetCm: 10, spacingCm: 20, replaceTopWithGrommets: true },
    border: { widthCm: 10, color: 'white' },
    extras: { flashing: index % 2 === 0, weightBar: false },
    geometry: {
      shape: 'rectangle',
      areaM2: 1.68,
      perimeterM: 5.2,
      polygon: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 140 }, { x: 0, y: 140 }, { x: 0, y: 0 }],
      sides: [
        { id: 'top-1', role: 'top', start: { x: 0, y: 0 }, end: { x: 120, y: 0 }, lengthCm: 120 },
        { id: 'right-2', role: 'right', start: { x: 120, y: 0 }, end: { x: 120, y: 140 }, lengthCm: 140 },
        { id: 'bottom-3', role: 'bottom', start: { x: 120, y: 140 }, end: { x: 0, y: 140 }, lengthCm: 120 },
        { id: 'left-4', role: 'left', start: { x: 0, y: 140 }, end: { x: 0, y: 0 }, lengthCm: 140 },
      ],
      fasteners: { total: 24, positions: [], bySide: [], byHardware: { 'plastic-turn-button': 20, grommet: 4 } },
    },
    subtotal: 2500 + index,
  };
}

function quote(productCount = 1) {
  const products = Array.from({ length: productCount }, (_, index) => product(index + 1));
  const lineItems = products.flatMap((item) => [
    { id: `${item.id}:material`, productId: item.id, component: 'material', label: 'Material', quantity: 1.68, unit: 'm2', unitPrice: 1000, amount: 1680 },
    { id: `${item.id}:border`, productId: item.id, component: 'border', label: 'Edging', quantity: 5.2, unit: 'm', unitPrice: 100, amount: 520 },
    { id: `${item.id}:fastener`, productId: item.id, component: 'fastener', label: 'Fasteners', quantity: 24, unit: 'piece', unitPrice: 12.5, amount: 300 },
  ]);
  return {
    version: 1,
    quoteNumber: 'Q-TEST-2026',
    createdAt: '2026-09-17T12:00:00.000Z',
    currency: 'RUB',
    status: 'ready',
    statusText: null,
    missingTariffs: [],
    products,
    lineItems,
    subtotal: products.reduce((sum, item) => sum + item.subtotal, 0),
    tax: { mode: 'off', ratePercent: 0, amount: 0 },
    total: products.reduce((sum, item) => sum + item.subtotal, 0),
  };
}

function tShapeQuote() {
  const value = quote(1);
  const item = value.products[0];
  item.shape = 't-shape';
  item.geometry.shape = 't-shape';
  item.dimensions = { width: 320, height: 260, stemWidth: 120, crossbarHeight: 80 };
  item.border.segmentWidths = { 'top-1': 8, 'right-2': 11, 'bottom-3': 12, 'left-4': 9 };
  item.extras.weightBar = true;
  item.geometry.polygon = [
    { x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 80 }, { x: 220, y: 80 },
    { x: 220, y: 260 }, { x: 100, y: 260 }, { x: 100, y: 80 }, { x: 0, y: 80 }, { x: 0, y: 0 },
  ];
  return value;
}

test('createQuotePdf exposes valid xref, A4 pages, ToUnicode, and decoded Quote content', () => {
  const bytes = createQuotePdf(quote(12));
  const parsed = parsePdf(bytes);

  assert.ok(bytes instanceof Uint8Array);
  assert.equal(parsed.version, '%PDF-1.7');
  assert.ok(parsed.pageObjects.length >= 2);
  assert.ok(parsed.pageObjects.every((page) => /\/MediaBox \[0 0 595 842\]/.test(page)));
  assert.match(parsed.decodedText, /Q-TEST-2026/);
  assert.match(parsed.decodedText, /MATERIAL/);
  assert.match(parsed.decodedText, /Fasteners/i);
  assert.match(parsed.decodedText, /GRAND TOTAL/);
});

test('PDF embeds a readable TrueType font instead of the pixel Type3 font', () => {
  const source = Buffer.from(createQuotePdf(quote(1))).toString('latin1');
  assert.match(source, /\/Subtype \/Type0/);
  assert.match(source, /\/FontFile2/);
  assert.doesNotMatch(source, /\/Subtype \/Type3/);
});

test('T-shape dimensions, segment widths, and weight bar are decoded from in-page content inside A4', () => {
  const parsed = parsePdf(createQuotePdf(tShapeQuote()));
  const dimensionLabels = ['Width', 'Height', 'Stem width', 'Crossbar height'];

  for (const label of dimensionLabels) assert.match(parsed.decodedText, new RegExp(label));
  assert.match(parsed.decodedText, /EDGING BY SIDE/);
  assert.match(parsed.decodedText, /SIDE №1 \(TOP\): 8 CM/);
  assert.doesNotMatch(parsed.decodedText, /top-1/i);
  assert.match(parsed.decodedText, /WEIGHT BAR: YES/);
  const dimensionOps = parsed.textOperations.filter(({ text }) => dimensionLabels.some((label) => text.includes(label)));
  assert.ok(dimensionOps.length >= 2, 'Four dimensions must occupy at least two lines');
  for (const operation of parsed.textOperations) {
    const estimatedRight = operation.x + [...operation.text].length * operation.size * 0.84;
    assert.ok(operation.x >= 0 && operation.y >= 0 && operation.y + operation.size * 1.4 <= 842);
    assert.ok(estimatedRight <= 595, `Text exceeds the A4 page: ${operation.text}`);
  }
});

test('PDF distinguishes shared mounting positions from hardware elements', () => {
  const value = quote(1);
  value.products[0].geometry.fasteners = {
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

  const parsed = parsePdf(createQuotePdf(value));
  assert.match(parsed.decodedText, /FASTENERS: 2 POSITIONS, 4 ELEMENTS/);
  assert.match(parsed.contentStreams, /% WC_SCHEMATIC_FASTENER/);
  assert.match(parsed.contentStreams, /% WC_SCHEMATIC_SIDE_LABEL/);
});

test('PDF schematic shows every selected hook-strap kit', () => {
  const value = quote(1);
  value.products[0].extras.hookStrapKits = 3;
  const parsed = parsePdf(createQuotePdf(value));
  assert.equal((parsed.contentStreams.match(/% WC_SCHEMATIC_HOOK_STRAP/g) ?? []).length, 3);
});

test('PDF describes the door zipper as centered or installed on both sides', () => {
  const value = quote(1);
  const door = value.products[0];
  door.type = 'door';
  door.position = 'left';
  delete door.purpose;
  door.zipperMode = 'both-sides';

  const parsed = parsePdf(createQuotePdf(value));
  assert.match(parsed.decodedText, /ZIPPER LAYOUT: BOTH SIDES/);
});

function parsePdf(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  assert.equal(source.slice(0, 8), '%PDF-1.7');
  const startMatch = source.match(/startxref\s+(\d+)\s+%%EOF$/);
  assert.ok(startMatch, 'startxref and %%EOF are required');
  const xrefOffset = Number(startMatch[1]);
  assert.equal(source.slice(xrefOffset, xrefOffset + 4), 'xref');
  const xrefSource = source.slice(xrefOffset);
  const xrefMatch = xrefSource.match(/^xref\s+0 (\d+)\s+([\s\S]*?)trailer\s+<<([\s\S]*?)>>/);
  assert.ok(xrefMatch, 'xref and trailer must parse');
  const objectCount = Number(xrefMatch[1]);
  const entries = xrefMatch[2].trim().split(/\r?\n/);
  assert.equal(entries.length, objectCount);
  const offsets = entries.slice(1).map((entry) => Number(entry.slice(0, 10)));
  const objects = new Map();
  offsets.forEach((offset, index) => {
    const id = index + 1;
    assert.equal(source.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`);
    const end = id < offsets.length ? offsets[index + 1] : xrefOffset;
    objects.set(id, source.slice(offset, end));
  });
  const rootMatch = xrefMatch[3].match(/\/Root (\d+) 0 R/);
  assert.ok(rootMatch && objects.get(Number(rootMatch[1]))?.includes('/Type /Catalog'));

  const pageObjects = [...objects.values()].filter((object) => /\/Type \/Page\b/.test(object));
  const fontObject = [...objects.values()].find((object) => /\/Subtype \/Type0\b/.test(object));
  const unicodeRef = Number(fontObject?.match(/\/ToUnicode (\d+) 0 R/)?.[1]);
  assert.ok(unicodeRef && objects.has(unicodeRef), 'Type0 font must have ToUnicode');
  const unicodeMap = parseToUnicode(streamOf(objects.get(unicodeRef)));
  const textOperations = [];
  for (const page of pageObjects) {
    const contentRef = Number(page.match(/\/Contents (\d+) 0 R/)?.[1]);
    const content = streamOf(objects.get(contentRef));
    const pattern = /\/F1\s+([\d.]+)\s+Tf\s+([\d.]+)\s+([\d.]+)\s+Td\s+<([0-9a-f]+)>\s+Tj/g;
    for (const match of content.matchAll(pattern)) {
      const text = (match[4].match(/.{4}/g) ?? []).map((code) => unicodeMap.get(code.toUpperCase()) ?? '�').join('');
      textOperations.push({ size: Number(match[1]), x: Number(match[2]), y: Number(match[3]), text });
    }
  }
  return { version: source.slice(0, 8), pageObjects, contentStreams: pageObjects.map((page) => streamOf(objects.get(Number(page.match(/\/Contents (\d+) 0 R/)?.[1])))).join('\n'), textOperations, decodedText: textOperations.map(({ text }) => text).join('\n') };
}

function streamOf(object) {
  const match = object?.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  assert.ok(match, 'Referenced stream must exist');
  return match[1];
}

function parseToUnicode(cmap) {
  const result = new Map();
  for (const match of cmap.matchAll(/<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>/g)) {
    result.set(match[1].toUpperCase(), String.fromCharCode(Number.parseInt(match[2], 16)));
  }
  return result;
}
