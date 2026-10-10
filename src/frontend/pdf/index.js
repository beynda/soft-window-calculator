import { t, msg, labels, locale, getPresentation, withPresentation, length } from '../../shared/presentation.js';
import { PDF_FONT } from './font-data.js';
import { fastenerCountText } from '../../shared/fasteners.js';

const PAGE = Object.freeze({ width: 595, height: 842, left: 42, right: 553, top: 795, bottom: 48 });
const DIMENSIONS_BY_SHAPE = Object.freeze({
  rectangle: Object.freeze(['width', 'height']),
  'trapezoid-right': Object.freeze(['width', 'height', 'wallHeight']),
  'trapezoid-left': Object.freeze(['width', 'height', 'wallHeight']),
  'trapezoid-both': Object.freeze(['width', 'height', 'leftWallHeight', 'rightWallHeight']),
  'triangle-left': Object.freeze(['width', 'height']),
  'triangle-right': Object.freeze(['width', 'height']),
  'hexagon-peak': Object.freeze(['width', 'height', 'wallHeight', 'ridgeWidth']),
  't-shape': Object.freeze(['width', 'height', 'stemWidth', 'crossbarHeight']),
  octagon: Object.freeze(['width', 'height', 'cutSize']),
});

const LABELS = labels({
  window: 'Soft window', door: 'Soft door', right: 'Right', left: 'Left', top: 'Top', center: 'Centered', 'both-sides': 'Both sides',
  bottom: 'Bottom', 'extension-45': 'Extension at 45°', opening: 'Opening', fixed: 'Fixed',
  'clear-pvc-700': 'Clear PVC, 700 microns', 'tinted-pvc-700': 'Tinted PVC, 700 microns',
  none: 'Tarpaulin instead of PVC film', grommet: 'Grommets', 'plastic-turn-button': 'Plastic turn button',
  'metal-turn-button': 'Metal turn button', 'black-metal-turn-button': 'Black metal turn button',
  'strap-bracket-45': 'Bracket and strap', 'hook-strap-kit': 'Hook and strap', 'weight-bar': 'Weight bar', 'top-sides': 'Top and sides',
  'top-bottom': 'Top and bottom', all: 'All sides', white: 'White', brown: 'Brown', gray: 'Gray',
  width: 'Width', height: 'Height', wallHeight: 'Wall height', leftWallHeight: 'Left wall',
  rightWallHeight: 'Right wall', ridgeWidth: 'Ridge width', stemWidth: 'Stem width',
  crossbarHeight: 'Crossbar height', cutSize: 'Slope size',
});

const LATIN = Object.freeze({
  A: '01110/10001/10001/11111/10001/10001/10001', B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01111/10000/10000/10000/10000/10000/01111', D: '11110/10001/10001/10001/10001/10001/11110',
  E: '11111/10000/10000/11110/10000/10000/11111', F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01111/10000/10000/10111/10001/10001/01111', H: '10001/10001/10001/11111/10001/10001/10001',
  I: '11111/00100/00100/00100/00100/00100/11111', J: '00111/00010/00010/00010/10010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001', L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001', N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110', P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101', R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110', T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110', V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/10101/01010', X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100', Z: '11111/00001/00010/00100/01000/10000/11111',
});

const GLYPHS = Object.freeze({
  ...LATIN,
  'А': LATIN.A, 'Б': '11110/10000/10000/11110/10001/10001/11110', 'В': LATIN.B, 'Г': '11111/10000/10000/10000/10000/10000/10000',
  'Д': '01110/01010/01010/01010/10001/11111/10001', 'Е': LATIN.E, 'Ё': '01010/11111/10000/11110/10000/10000/11111',
  'Ж': '10101/10101/01110/00100/01110/10101/10101', 'З': '11110/00001/00001/01110/00001/00001/11110',
  'И': '10001/10011/10101/10101/11001/10001/10001', 'Й': '01010/00100/10001/10011/10101/11001/10001', 'К': LATIN.K,
  'Л': '00111/01001/01001/01001/10001/10001/10001', 'М': LATIN.M, 'Н': LATIN.H, 'О': LATIN.O,
  'П': '11111/10001/10001/10001/10001/10001/10001', 'Р': LATIN.P, 'С': LATIN.C, 'Т': LATIN.T, 'У': LATIN.Y,
  'Ф': '00100/01110/10101/10101/01110/00100/00100', 'Х': LATIN.X, 'Ц': '10001/10001/10001/10001/10001/11111/00001',
  'Ч': '10001/10001/10001/01111/00001/00001/00001', 'Ш': '10101/10101/10101/10101/10101/10101/11111',
  'Щ': '10101/10101/10101/10101/10101/11111/00001', 'Ъ': '11000/01000/01000/01110/01001/01001/01110',
  'Ы': '10001/10001/10001/10111/11001/11001/10111', 'Ь': '10000/10000/10000/11110/10001/10001/11110',
  'Э': '01110/10001/00001/00111/00001/10001/01110', 'Ю': '10010/10101/10101/11101/10101/10101/10010',
  'Я': '01111/10001/10001/01111/00101/01001/10001',
  0: '01110/10001/10011/10101/11001/10001/01110', 1: '00100/01100/00100/00100/00100/00100/01110',
  2: '01110/10001/00001/00010/00100/01000/11111', 3: '11110/00001/00001/01110/00001/00001/11110',
  4: '00010/00110/01010/10010/11111/00010/00010', 5: '11111/10000/10000/11110/00001/00001/11110',
  6: '01110/10000/10000/11110/10001/10001/01110', 7: '11111/00001/00010/00100/01000/01000/01000',
  8: '01110/10001/10001/01110/10001/10001/01110', 9: '01110/10001/10001/01111/00001/00001/01110',
  '.': '00000/00000/00000/00000/00000/01100/01100', ',': '00000/00000/00000/00000/01100/01100/01000',
  ':': '00000/01100/01100/00000/01100/01100/00000', '-': '00000/00000/00000/11111/00000/00000/00000',
  '/': '00001/00010/00100/01000/10000/00000/00000', '(': '00010/00100/01000/01000/01000/00100/00010',
  ')': '01000/00100/00010/00010/00010/00100/01000', '%': '11001/11010/00100/01000/10110/00110/00000',
  '°': '01100/10010/10010/01100/00000/00000/00000', '?': '01110/10001/00001/00010/00100/00000/00100',
});

export function createQuotePdf(quote) {
  return withPresentation(quote?.presentation, () => createPdfContent(quote));
}

function createPdfContent(quote) {
  assertQuoteExportable(quote);
  const pages = layoutQuote(quote);
  return buildPdf(pages, quote);
}

export function isQuoteExportable(quote) {
  if (!isRecord(quote)
    || !Number.isInteger(quote.version)
    || quote.version < 1
    || quote.status !== 'ready'
    || quote.statusText !== null
    || !Array.isArray(quote.missingTariffs)
    || quote.missingTariffs.length !== 0
    || !isNonEmptyString(quote.quoteNumber)
    || !isNonEmptyString(quote.createdAt)
    || Number.isNaN(new Date(quote.createdAt).valueOf())
    || !isNonEmptyString(quote.currency)
    || !isAmount(quote.subtotal)
    || !isAmount(quote.total)
    || !isRecord(quote.tax)
    || !isNonEmptyString(quote.tax.mode)
    || !Number.isFinite(quote.tax.ratePercent)
    || !isAmount(quote.tax.amount)
    || !Array.isArray(quote.products)
    || quote.products.length === 0
    || !Array.isArray(quote.lineItems)
    || quote.lineItems.length === 0) return false;

  const productIds = new Set();
  for (const product of quote.products) {
    if (!isExportableProduct(product) || productIds.has(product.id)) return false;
    productIds.add(product.id);
  }
  const productsWithLines = new Set();
  const lineIds = new Set();
  for (const line of quote.lineItems) {
    if (!isExportableLineItem(line, productIds) || lineIds.has(line.id)) return false;
    lineIds.add(line.id);
    if (line.productId !== null) productsWithLines.add(line.productId);
  }
  return [...productIds].every((id) => productsWithLines.has(id));
}

export function assertQuoteExportable(quote) {
  if (isQuoteExportable(quote)) return;
  const error = new Error('Print and PDF are unavailable: check the options and rates.');
  error.code = 'QUOTE_NOT_EXPORTABLE';
  throw error;
}

function isExportableProduct(product) {
  if (!isRecord(product)
    || !['window', 'door'].includes(product.type)
    || !['right', 'left', 'top', 'bottom', 'extension-45'].includes(product.position)
    || !isNonEmptyString(product.id)
    || !isNonEmptyString(product.shape)
    || !isNonEmptyString(product.material)
    || !isNonEmptyString(product.hardware)
    || (product.type === 'window' && !isNonEmptyString(product.purpose))
    || (product.type === 'door' && !['center', 'both-sides'].includes(product.zipperMode))
    || !hasShapeDimensions(product.shape, product.dimensions)
    || !isRecord(product.installation)
    || !isNonEmptyString(product.installation.mode)
    || ![20, 30, 40].includes(Number(product.installation.spacingCm))
    || !(product.installation.edgeOffsetCm === 'auto' || Number.isFinite(Number(product.installation.edgeOffsetCm)))
    || typeof product.installation.replaceTopWithGrommets !== 'boolean'
    || !isRecord(product.border)
    || !Number.isFinite(Number(product.border.widthCm))
    || !isNonEmptyString(product.border.color)
    || !isOptionalFiniteRecord(product.border.segmentWidths)
    || !isOptionalFiniteRecord(product.border.widthsBySide)
    || !isRecord(product.extras)
    || typeof product.extras.weightBar !== 'boolean'
    || typeof product.extras.flashing !== 'boolean'
    || !isAmount(product.subtotal)) return false;

  const geometry = product.geometry;
  if (!isRecord(geometry)
    || geometry.shape !== product.shape
    || !Number.isFinite(geometry.areaM2)
    || !Number.isFinite(geometry.perimeterM)
    || !Array.isArray(geometry.polygon)
    || geometry.polygon.length < 4
    || !geometry.polygon.every((point) => isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y))
    || !Array.isArray(geometry.sides)
    || geometry.sides.length < 3
    || !geometry.sides.every(isExportableSide)
    || !isRecord(geometry.fasteners)
    || !Number.isInteger(geometry.fasteners.total)
    || geometry.fasteners.total < 0
    || !Array.isArray(geometry.fasteners.positions)
    || !Array.isArray(geometry.fasteners.bySide)
    || !isRecord(geometry.fasteners.byHardware)) return false;
  return Object.values(geometry.fasteners.byHardware).every((count) => Number.isInteger(count) && count >= 0);
}

function isExportableSide(side) {
  return isRecord(side)
    && isNonEmptyString(side.id)
    && isNonEmptyString(side.role)
    && isRecord(side.start)
    && Number.isFinite(side.start.x)
    && Number.isFinite(side.start.y)
    && isRecord(side.end)
    && Number.isFinite(side.end.x)
    && Number.isFinite(side.end.y)
    && Number.isFinite(side.lengthCm)
    && side.lengthCm > 0;
}

function isExportableLineItem(line, productIds) {
  return isRecord(line)
    && isNonEmptyString(line.id)
    && (line.productId === null || productIds.has(line.productId))
    && isNonEmptyString(line.component)
    && isNonEmptyString(line.label)
    && Number.isFinite(line.quantity)
    && isNonEmptyString(line.unit)
    && (line.unitPrice === null || Number.isFinite(line.unitPrice))
    && isAmount(line.amount);
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isAmount(value) { return Number.isFinite(value) && value >= 0; }
function isFiniteRecord(value) { return isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every((item) => Number.isFinite(Number(item))); }
function isOptionalFiniteRecord(value) { return value === undefined || isFiniteRecord(value); }
function hasShapeDimensions(shape, dimensions) {
  const required = DIMENSIONS_BY_SHAPE[shape];
  return Boolean(required)
    && isRecord(dimensions)
    && required.every((name) => Object.hasOwn(dimensions, name) && Number.isFinite(Number(dimensions[name])));
}

function layoutQuote(quote) {
  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = [];
    pages.push(page);
    y = PAGE.top;
    page.push(textOp('BEYNDA', PAGE.left, y, 18, [0.05, 0.32, 0.27]));
    page.push(textOp(msg`QUOTE ${quote.quoteNumber}`, PAGE.left, y - 25, 11));
    page.push(textOp(msg`DATE: ${formatDate(quote.createdAt)}`, 390, y - 25, 9));
    page.push(lineOp(PAGE.left, y - 34, PAGE.right, y - 34, [0.16, 0.46, 0.38], 1.5));
    y -= 52;
  };
  const ensure = (height) => {
    if (!page || y - height < PAGE.bottom + 22) newPage();
  };

  newPage();
  quote.products.forEach((product, index) => {
    const lines = quote.lineItems.filter(({ productId }) => productId === product.id);
    const dimensions = productDimensionLines(product);
    const details = productDetails(product);
    const estimated = 84 + dimensions.length * 14 + details.length * 14 + lines.length * 13;
    const finalTotalSpace = index === quote.products.length - 1 ? 58 : 0;
    ensure(Math.min(estimated + finalTotalSpace, 310));
    page.push(rectOp(PAGE.left, y - 8, PAGE.right - PAGE.left, 1, [0.78, 0.84, 0.81]));
    y -= 22;
    page.push(textOp(`${index + 1}. ${label(product.type)} - ${label(product.position)}`, 178, y, 9.5, [0.05, 0.32, 0.27]));
    addSchematic(page, product, PAGE.left + 6, y - 9, 116, 108);
    dimensions.forEach((dimensionLine, dimensionIndex) => page.push(textOp(dimensionLine, 178, y - 17 - dimensionIndex * 14, 8)));
    const areaY = y - 18 - dimensions.length * 14;
    page.push(textOp(msg`AREA: ${number(product.geometry.areaM2)} M2  FASTENERS: ${fastenerCountText(product.geometry.fasteners).replace(' · ', ', ').toUpperCase()}`, 178, areaY, 8));
    details.forEach((detail, detailIndex) => page.push(textOp(detail, 178, areaY - 15 - detailIndex * 14, 7.2)));
    y -= 34 + dimensions.length * 14 + details.length * 14;
    for (const line of lines) {
      ensure(16);
      const details = `${number(line.quantity)} ${unit(line.unit)}${line.unitPrice == null ? '' : ` X ${money(line.unitPrice, quote.currency)}`}`;
      page.push(textOp(`${t(line.label)}: ${details}`, PAGE.left + 12, y, 8));
      page.push(textOp(money(line.amount, quote.currency), 458, y, 8));
      y -= 13;
    }
    ensure(22);
    page.push(textOp(msg`PRODUCT SUBTOTAL: ${money(product.subtotal, quote.currency)}`, 338, y - 2, 9, [0.05, 0.32, 0.27]));
    y -= 28;
  });

  ensure(62);
  page.push(lineOp(PAGE.left, y, PAGE.right, y, [0.16, 0.46, 0.38], 2));
  page.push(textOp(msg`GRAND TOTAL: ${money(quote.total, quote.currency)}`, 300, y - 27, 14, [0.05, 0.32, 0.27]));
  pages.forEach((current, index) => current.push(textOp(msg`PAGE ${index + 1} OF ${pages.length}`, 240, 25, 7, [0.35, 0.38, 0.37])));
  return pages;
}

function buildPdf(pages, quote) {
  const pdf = new PdfBuilder();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const fontId = pdf.reserve();
  const descendantId = pdf.reserve();
  const descriptorId = pdf.reserve();
  const fontFileId = pdf.reserve();
  const cidToGidId = pdf.reserve();
  const unicodeId = pdf.reserve();
  const metadataId = pdf.reserve();

  const charset = collectCharacters(pages);
  const fontBytes = base64Bytes(PDF_FONT.data);
  pdf.set(fontFileId, streamObject(`<< /Length1 ${fontBytes.length} >>`, fontBytes));
  pdf.set(cidToGidId, streamObject('<< >>', base64Bytes(PDF_FONT.cidToGid)));
  pdf.set(unicodeId, streamObject('<< >>', utf8(toUnicodeCMap(charset))));
  pdf.set(descriptorId, `<< /Type /FontDescriptor /FontName /${PDF_FONT.name} /Flags 32 /FontBBox [${PDF_FONT.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${PDF_FONT.ascent} /Descent ${PDF_FONT.descent} /CapHeight ${PDF_FONT.capHeight} /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
  const widths = charset.map((character) => {
    const code = supportedCode(character);
    return `${code} [${PDF_FONT.widths[String(code)]}]`;
  }).join(' ');
  pdf.set(descendantId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${PDF_FONT.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /W [${widths}] /CIDToGIDMap ${cidToGidId} 0 R >>`);
  pdf.set(fontId, `<< /Type /Font /Subtype /Type0 /BaseFont /${PDF_FONT.name} /Encoding /Identity-H /DescendantFonts [${descendantId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
  pdf.set(metadataId, streamObject('<< /Type /Metadata /Subtype /XML >>', utf8(metadataXml(quote))));

  const pageIds = [];
  for (const operations of pages) {
    const contentId = pdf.add(streamObject('<< >>', ascii(renderPage(operations))));
    const pageId = pdf.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /Metadata ${metadataId} 0 R >>`);
  return pdf.serialize(catalogId);
}

function renderPage(operations) {
  return operations.map((operation) => {
    if (operation.kind === 'text') {
      const hex = [...operation.text].map((character) => supportedCode(character).toString(16).padStart(4, '0')).join('');
      const [r, g, b] = operation.color;
      return `BT ${r} ${g} ${b} rg /F1 ${operation.size} Tf ${operation.x} ${operation.y} Td <${hex}> Tj ET`;
    }
    if (operation.kind === 'line') {
      const [r, g, b] = operation.color;
      return `q ${r} ${g} ${b} RG ${operation.width} w ${operation.x1} ${operation.y1} m ${operation.x2} ${operation.y2} l S Q`;
    }
    if (operation.kind === 'rect') {
      const [r, g, b] = operation.color;
      return `q ${r} ${g} ${b} rg ${operation.x} ${operation.y} ${operation.width} ${operation.height} re f Q`;
    }
    if (operation.kind === 'path') {
      const [first, ...rest] = operation.points;
      if (!first) return '';
      return `q 0.08 0.34 0.29 RG 1.4 w ${first.x} ${first.y} m ${rest.map(({ x, y }) => `${x} ${y} l`).join(' ')} h S Q`;
    }
    if (operation.kind === 'raw') return operation.source;
    return '';
  }).join('\n');
}

function addSchematic(page, product, x, top, width, height) {
  const geometry = product?.geometry;
  const points = Array.isArray(geometry?.polygon) ? geometry.polygon.slice(0, -1) : [];
  if (points.length < 3) return;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min(width / Math.max(maxX - minX, 1), height / Math.max(maxY - minY, 1));
  const drawnWidth = (maxX - minX) * scale;
  const drawnHeight = (maxY - minY) * scale;
  const originX = x + (width - drawnWidth) / 2;
  const originTop = top - (height - drawnHeight) / 2;
  const mapPoint = (point) => ({ x: round(originX + (point.x - minX) * scale), y: round(originTop - (point.y - minY) * scale) });
  const mapped = points.map(mapPoint);
  const [first, ...rest] = mapped;
  page.push({ kind: 'raw', source: `% WC_SCHEMATIC_START\nq 0.91 0.96 0.94 rg ${first.x} ${first.y} m ${rest.map(({ x: px, y: py }) => `${px} ${py} l`).join(' ')} h f Q` });
  page.push({
    kind: 'path',
    points: mapped,
  });

  for (const [index, side] of (geometry.sides ?? []).entries()) {
    const start = mapPoint(side.start); const end = mapPoint(side.end);
    page.push(lineOp(start.x, start.y, end.x, end.y, [0.94, 0.9, 0.82], Math.max(3, Number(product.border?.widthsBySide?.[side.id] ?? product.border?.segmentWidths?.[side.id] ?? product.border?.widthCm ?? 10) * 0.32)));
    const labelX = round((start.x + end.x) / 2); const labelY = round((start.y + end.y) / 2);
    const sideNumberHex = String(index + 1).split('').map((digit) => digit.codePointAt(0).toString(16).padStart(4, '0')).join('');
    page.push({ kind: 'raw', source: `% WC_SCHEMATIC_SIDE_LABEL\nq 1 1 1 rg ${labelX - 5} ${labelY - 5} 10 10 re f Q\nBT /F1 7 Tf ${labelX - 2} ${labelY - 2} Td <${sideNumberHex}> Tj ET` });
  }

  const grouped = new Map();
  for (const position of geometry.fasteners?.positions ?? []) {
    const key = `${position.sideId}:${position.distanceCm}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(position);
  }
  for (const positions of grouped.values()) positions.forEach((position, markerIndex) => {
    const side = geometry.sides?.find(({ id }) => id === position.sideId);
    const start = side ? mapPoint(side.start) : mapPoint(position);
    const end = side ? mapPoint(side.end) : { x: start.x + 1, y: start.y };
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const offset = (markerIndex - (positions.length - 1) / 2) * 4;
    const point = mapPoint(position);
    point.x = round(point.x + (end.x - start.x) / length * offset);
    point.y = round(point.y + (end.y - start.y) / length * offset);
    page.push({ kind: 'raw', source: schematicFastener(position.hardware, point.x, point.y) });
  });

  const hookStrapKits = Math.max(0, Math.trunc(Number(product.extras?.hookStrapKits) || 0));
  const topSides = (geometry.sides ?? []).filter(({ role }) => role === 'top');
  const topLength = topSides.reduce((sum, side) => sum + Math.hypot(side.end.x - side.start.x, side.end.y - side.start.y), 0);
  for (let index = 0; index < hookStrapKits && topLength > 0; index += 1) {
    let distance = topLength * (index + 1) / (hookStrapKits + 1);
    let target = topSides.at(-1);
    for (const side of topSides) {
      const length = Math.hypot(side.end.x - side.start.x, side.end.y - side.start.y);
      if (distance <= length) { target = side; break; }
      distance -= length;
    }
    const length = Math.hypot(target.end.x - target.start.x, target.end.y - target.start.y) || 1;
    const ratio = Math.min(1, distance / length);
    const sourcePoint = {
      x: target.start.x + (target.end.x - target.start.x) * ratio,
      y: target.start.y + (target.end.y - target.start.y) * ratio,
    };
    const point = mapPoint(sourcePoint);
    page.push({ kind: 'raw', source: `% WC_SCHEMATIC_HOOK_STRAP\nq 0.31 0.37 0.35 RG 1.8 w ${point.x + 4} ${point.y + 10} m ${point.x - 5} ${point.y + 10} ${point.x - 5} ${point.y + 2} ${point.x + 1} ${point.y + 2} c ${point.x + 5} ${point.y + 2} ${point.x + 4} ${point.y - 4} ${point.x} ${point.y - 4} c S Q` });
  }

  for (const side of geometry.sides ?? []) {
    if (side.role !== 'bottom') continue;
    const start = mapPoint(side.start); const end = mapPoint(side.end);
    if (product.extras?.flashing) page.push(lineOp(start.x, start.y - 3, end.x, end.y - 3, [0.23, 0.45, 0.58], 2.4));
    if (product.extras?.weightBar) page.push(lineOp(start.x, start.y + 3, end.x, end.y + 3, [0.24, 0.24, 0.24], 2.4));
  }
  if (product.type === 'door') {
    if (product.zipperMode === 'center') {
      const centerX = round((Math.min(...mapped.map(({ x: px }) => px)) + Math.max(...mapped.map(({ x: px }) => px))) / 2);
      page.push(lineOp(centerX, Math.min(...mapped.map(({ y: py }) => py)), centerX, Math.max(...mapped.map(({ y: py }) => py)), [0.83, 0.45, 0.08], 2));
    } else {
      for (const side of geometry.sides?.filter(({ role }) => role === 'left' || role === 'right') ?? []) {
        const start = mapPoint(side.start); const end = mapPoint(side.end);
        page.push(lineOp(start.x, start.y, end.x, end.y, [0.83, 0.45, 0.08], 2));
      }
    }
  }
}

function schematicFastener(hardware, x, y) {
  const prefix = '% WC_SCHEMATIC_FASTENER\n';
  if (hardware === 'plastic-turn-button') return `${prefix}q 0.95 0.63 0.11 rg 0.65 0.39 0 RG ${x - 2.4} ${y - 2.4} 4.8 4.8 re B Q`;
  if (hardware === 'metal-turn-button') return `${prefix}q 0.55 0.61 0.65 rg 0.26 0.32 0.37 RG ${x} ${y + 3} m ${x + 3} ${y} l ${x} ${y - 3} l ${x - 3} ${y} l h B Q`;
  if (hardware === 'black-metal-turn-button') return `${prefix}q 0.2 0.2 0.2 rg ${x} ${y + 3} m ${x + 3} ${y - 2.6} l ${x - 3} ${y - 2.6} l h f Q`;
  if (hardware === 'strap-bracket-45') return `${prefix}q 0.48 0.29 0.58 RG 2.5 w ${x - 3.5} ${y} m ${x + 3.5} ${y} l S Q`;
  const radius = 2.5; const control = radius * 0.55228475;
  return `${prefix}q 0.09 0.4 0.33 RG 1.2 w ${x + radius} ${y} m ${x + radius} ${y + control} ${x + control} ${y + radius} ${x} ${y + radius} c ${x - control} ${y + radius} ${x - radius} ${y + control} ${x - radius} ${y} c ${x - radius} ${y - control} ${x - control} ${y - radius} ${x} ${y - radius} c ${x + control} ${y - radius} ${x + radius} ${y - control} ${x + radius} ${y} c S Q`;
}

function productDetails(product) {
  const offset = product.installation.edgeOffsetCm === 'auto' ? 'AUTO' : `${number(product.installation.edgeOffsetCm)} CM`;
  const segmentWidths = product.border.segmentWidths ?? product.border.widthsBySide;
  const details = [
    msg`MATERIAL: ${label(product.material)}  PURPOSE: ${product.type === 'door' ? 'DOOR' : label(product.purpose)}`,
    ...hardwareDetailLines(product),
    msg`SPACING: ${number(product.installation.spacingCm)} CM  OFFSET: ${offset}`,
    segmentWidths && Object.keys(segmentWidths).length
      ? msg`EDGING COLOR: ${borderColor(product.border)}`
      : msg`EDGING: ${number(product.border.widthCm)} CM, ${borderColor(product.border)}`,
  ];
  if (segmentWidths && Object.keys(segmentWidths).length) {
    details.push(...wrapLabeledValues(
      'EDGING BY SIDE:',
      Object.entries(segmentWidths).map(([segment, width]) => `${sideDescription(product, segment)}: ${number(width)} CM`),
    ));
  }
  details.push(`BOTTOM SIDE - FLASHING 20 CM: ${yesNo(product.extras?.flashing)}  WEIGHT BAR: ${yesNo(product.extras?.weightBar)}`);
  details.push(`HOOK AND STRAP: ${(product.extras?.hookStrapKits ?? 0) > 0 ? msg`${product.extras.hookStrapKits} KITS.` : 'NO'}`);
  if (product.type === 'door') details.push(`ZIPPER LAYOUT: ${label(product.zipperMode).toUpperCase()}`);
  return details;
}

function sideDescription(product, sideId) {
  const index = (product.geometry?.sides ?? []).findIndex(({ id }) => id === sideId);
  const side = product.geometry?.sides?.[index];
  return index >= 0 ? `SIDE №${index + 1} (${label(side.role).toUpperCase()})` : 'SIDE';
}

function hardwareDetailLines(product) {
  if (!product.hardwareBySide || typeof product.hardwareBySide !== 'object') return [msg`HARDWARE: ${label(product.hardware)}`];
  const sideOrder = new Map((product.geometry?.sides ?? []).map((side, index) => [side.id, index + 1]));
  const rows = Object.entries(product.hardwareBySide)
    .filter(([, selected]) => Array.isArray(selected) && selected.length)
    .map(([sideId, selected]) => `SIDE №${sideOrder.get(sideId) ?? sideId}: ${selected.map(label).join(', ')}`);
  return rows.length ? wrapLabeledValues('HARDWARE:', rows) : ['HARDWARE: NO FASTENERS'];
}

function productDimensionLines(product) {
  const dimensions = Object.entries(product.dimensions).map(([name, value]) => `${label(name)} ${number(value)} CM`);
  const lines = [];
  for (let index = 0; index < dimensions.length; index += 2) lines.push(dimensions.slice(index, index + 2).join('  '));
  return lines;
}

function wrapLabeledValues(prefix, values, maxCharacters = 64) {
  const lines = [];
  let current = prefix;
  for (const value of values) {
    const addition = `${current === prefix ? ' ' : ', '}${value}`;
    if (current.length + addition.length > maxCharacters && current !== prefix) {
      lines.push(current);
      current = value;
    } else {
      current += addition;
    }
  }
  lines.push(current);
  return lines;
}

function collectCharacters(pages) {
  const characters = new Set(['?', ' ']);
  for (const page of pages) for (const operation of page) {
    if (operation.kind === 'text') for (const character of operation.text) characters.add(supportedCode(character) === character.codePointAt(0) ? character : '?');
  }
  return [...characters];
}

function toUnicodeCMap(charset) {
  const mappings = charset.map((character) => `<${supportedCode(character).toString(16).padStart(4, '0')}> <${unicodeHex(character)}>`).join('\n');
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /BeyndaCalculatorUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${charset.length} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function metadataXml(quote) {
  const fields = [
    'Beynda', quote.quoteNumber, formatDate(quote.createdAt),
    ...quote.products.flatMap((product, index) => [
      `${index + 1}. ${label(product.type)} - ${label(product.position)}`,
      ...Object.entries(product.dimensions ?? {}).map(([name, value]) => msg`${label(name)}: ${value} cm`),
      msg`Area: ${product.geometry.areaM2} m2`, msg`Fasteners: ${fastenerCountText(product.geometry.fasteners)}`,
      msg`Material: ${label(product.material)}`, ...hardwareDetailLines(product),
      ...quote.lineItems.filter(({ productId }) => productId === product.id).map((line) => `${t(line.label)}: ${line.amount}`),
    ]),
    msg`Grand total: ${quote.total} ${quote.currency}`,
  ];
  return `<?xpacket begin="\uFEFF"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:ts="https://beynda-soft-window.example/pdf/1.0/" ts:quoteNumber="${xml(quote.quoteNumber)}"><ts:summary><rdf:Bag>${fields.map((field) => `<rdf:li>${xml(String(field))}</rdf:li>`).join('')}</rdf:Bag></ts:summary></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
}

class PdfBuilder {
  constructor() { this.objects = [null]; }
  reserve() { this.objects.push(null); return this.objects.length - 1; }
  add(value) { this.objects.push(value); return this.objects.length - 1; }
  set(id, value) { this.objects[id] = value; }
  serialize(rootId) {
    const chunks = [ascii('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
    const offsets = [0];
    let length = chunks[0].length;
    for (let id = 1; id < this.objects.length; id += 1) {
      offsets[id] = length;
      const body = typeof this.objects[id] === 'string' ? ascii(this.objects[id]) : this.objects[id];
      const chunk = concat([ascii(`${id} 0 obj\n`), body, ascii('\nendobj\n')]);
      chunks.push(chunk);
      length += chunk.length;
    }
    const xrefOffset = length;
    const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    chunks.push(ascii(`xref\n0 ${this.objects.length}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${this.objects.length} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return concat(chunks);
  }
}

function streamObject(dictionary, bytes) {
  return concat([ascii(`${dictionary.slice(0, -2)} /Length ${bytes.length} >>\nstream\n`), bytes, ascii('\nendstream')]);
}

function textOp(text, x, y, size, color = [0.12, 0.14, 0.13]) { return { kind: 'text', text: t(String(text)).replace(/([0-9]+(?:[.,][0-9]+)?) CM\b/g, (_, value) => getPresentation().units === 'in' ? length(Number(value.replace(',', '.'))).toUpperCase() : getPresentation().language === 'ru' ? `${value} СМ` : `${value} CM`), x, y, size, color }; }
function lineOp(x1, y1, x2, y2, color, width) { return { kind: 'line', x1, y1, x2, y2, color, width }; }
function rectOp(x, y, width, height, color) { return { kind: 'rect', x, y, width, height, color }; }
function label(value) { return LABELS[value] ?? String(value ?? '-'); }
function yesNo(value) { return value ? 'YES' : 'NO'; }
function borderColor(border) { return border?.colorPreset === 'custom' || /^#[0-9a-f]{6}$/i.test(border?.color ?? '') ? `CUSTOM ${border.color}` : label(border?.color); }
function unit(value) { return ({ m: t('M'), m2: t('M2'), piece: t('PCS.'), kit: t('KITS.'), percent: '%', fixed: getPresentation().market })[value] ?? String(value ?? ''); }
function number(value) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2, useGrouping: false }).format(Number(value)); }
function money(value, currency) { return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: currency === 'RUB' ? 0 : 2, useGrouping: false }).format(Number(value))} ${currency === 'RUB' ? 'RUB.' : currency}`; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat(locale(), { timeZone: 'UTC' }).format(date); }
function unicodeHex(character) { return [...character].map((part) => part.codePointAt(0).toString(16).padStart(4, '0')).join('').toUpperCase(); }
function supportedCode(character) { const code = character.codePointAt(0); return Object.hasOwn(PDF_FONT.widths, String(code)) ? code : 63; }
function base64Bytes(value) { const binary = globalThis.atob ? globalThis.atob(value) : Buffer.from(value, 'base64').toString('binary'); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function xml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function round(value) { return Math.round(value * 100) / 100; }
function utf8(value) { return new TextEncoder().encode(value); }
function ascii(value) { return Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff); }
function concat(chunks) { const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
