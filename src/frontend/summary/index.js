import { t, msg, labels, locale, getPresentation, withPresentation } from '../../shared/presentation.js';
import { assertQuoteExportable, createQuotePdf, isQuoteExportable } from '../pdf/index.js';
import { fastenerCountText } from '../../shared/fasteners.js';

const LABELS = labels({
  window: 'Soft window', door: 'Soft door', right: 'Right', left: 'Left', top: 'Top', bottom: 'Bottom', center: 'Centered', 'both-sides': 'Both sides',
  'extension-45': 'Extension at 45°', opening: 'Opening', fixed: 'Fixed', 'clear-pvc-700': 'Clear PVC film, 700 microns',
  'tinted-pvc-700': 'Tinted PVC film, 700 microns', none: 'Tarpaulin instead of PVC film', grommet: 'Grommets',
  'plastic-turn-button': 'Plastic turn button', 'metal-turn-button': 'Metal turn button',
  'black-metal-turn-button': 'Black metal turn button', 'strap-bracket-45': 'Bracket and strap', 'hook-strap-kit': 'Hook and strap', 'weight-bar': 'Weight bar',
  'top-sides': 'Top and sides', 'top-bottom': 'Top and bottom', all: 'All sides', white: 'White', brown: 'Brown', gray: 'Gray',
  width: 'Width', height: 'Height', wallHeight: 'Wall height', leftWallHeight: 'Left wall', rightWallHeight: 'Right wall',
  ridgeWidth: 'Ridge width', stemWidth: 'Stem width', crossbarHeight: 'Crossbar height', cutSize: 'Slope size',
});

export { isQuoteExportable };

export function renderQuoteSummary(quote) {
  return withPresentation(quote?.presentation, () => renderSummaryContent(quote));
}

function renderSummaryContent(quote) {
  if (!quote || !Array.isArray(quote.products)) throw new TypeError(t('Model Quote is missing.'));
  const items = quote.products.map((product, index) => renderProduct(product, index, quote)).join('');
  const total = quote.status === 'ready' ? money(quote.total, quote.currency) : escapeHtml(quote.statusText ?? t('Pricing requires configuration'));
  return msg`<section class="quote-summary" aria-labelledby="quote-summary-title"><header class="quote-summary__header"><p>Beynda</p><h2 id="quote-summary-title">Quote ${escapeHtml(quote.quoteNumber ?? '')}</h2><time datetime="${escapeHtml(quote.createdAt ?? '')}">${formatDate(quote.createdAt)}</time></header><div class="quote-summary__items">${items}</div><footer class="quote-summary__total"><span>Grand total</span><strong>${total}</strong></footer></section>`;
}

export function createQuotePrintHtml(quote) {
  return withPresentation(quote?.presentation, () => printHtmlContent(quote));
}

function printHtmlContent(quote) {
  assertQuoteExportable(quote);
  return msg`<!doctype html><html lang="${getPresentation().language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quote ${escapeHtml(quote.quoteNumber)}</title><style>${PRINT_CSS}</style></head><body>${renderQuoteSummary(quote)}</body></html>`;
}

export function printQuote(quote, dependencies = {}) {
  assertQuoteExportable(quote);
  const windowRef = dependencies.windowRef ?? globalThis.window;
  const printWindow = windowRef?.open?.('', '_blank');
  if (!printWindow?.document) {
    const error = new Error(t('The browser blocked the print window. Allow pop-ups and try again.'));
    error.code = 'PRINT_WINDOW_BLOCKED';
    throw error;
  }
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(createQuotePrintHtml(quote));
  printWindow.document.close();
  printWindow.focus?.();
  printWindow.print?.();
  return printWindow;
}

export function downloadQuotePdf(quote, dependencies = {}) {
  assertQuoteExportable(quote);
  const documentRef = dependencies.documentRef ?? globalThis.document;
  const URLRef = dependencies.URLRef ?? globalThis.URL;
  const BlobCtor = dependencies.BlobCtor ?? globalThis.Blob;
  if (!documentRef?.createElement || !URLRef?.createObjectURL || !BlobCtor) throw new TypeError(t('Download PDF is unavailable in this environment.'));
  const bytes = createQuotePdf(quote);
  const filename = quotePdfFilename(quote);
  const url = URLRef.createObjectURL(new BlobCtor([bytes], { type: 'application/pdf' }));
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body?.append?.(anchor);
  try { anchor.click(); } finally { anchor.remove?.(); URLRef.revokeObjectURL?.(url); }
  return { bytes, filename };
}

export function quotePdfFilename(quote) {
  const safeNumber = String(quote?.quoteNumber ?? 'quote').replace(/[^a-zа-яё0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'quote';
  return `quote-${safeNumber}.pdf`;
}

function renderProduct(product, index, quote) {
  const points = thumbnailPoints(product.geometry?.polygon);
  const dimensions = Object.entries(product.dimensions ?? {}).map(([name, value]) => msg`<li>${escapeHtml(label(name))}: ${formatNumber(value)} cm</li>`).join('');
  const fasteners = Object.entries(product.geometry?.fasteners?.byHardware ?? {}).map(([hardware, count]) => msg`${escapeHtml(label(hardware))}: ${count} pcs.`).join(', ');
  const lines = quote.lineItems.filter(({ productId }) => productId === product.id).map((line) => `<tr><th scope="row">${escapeHtml(t(line.label))}</th><td>${formatNumber(line.quantity)} ${escapeHtml(unit(line.unit))}${line.unitPrice == null ? '' : ` × ${money(line.unitPrice, quote.currency)}`}</td><td>${money(line.amount, quote.currency)}</td></tr>`).join('');
  const border = /^#[0-9a-f]{6}$/i.test(product.border?.color ?? '') ? msg`custom ${product.border.color}` : label(product.border?.color);
  const segmentWidths = product.border?.segmentWidths ?? product.border?.widthsBySide;
  const hasSegmentWidths = Boolean(segmentWidths && Object.keys(segmentWidths).length);
  const segmentWidthsHtml = hasSegmentWidths
    ? msg`<div><dt>Edging by side</dt><dd>${Object.entries(segmentWidths).map(([segment, width]) => msg`${escapeHtml(sideName(product, segment))}: ${formatNumber(width)} cm`).join(', ')}</dd></div>`
    : '';
  const borderHtml = hasSegmentWidths
    ? msg`<div><dt>Edging color</dt><dd>${escapeHtml(border)}</dd></div>`
    : msg`<div><dt>Edging</dt><dd>${formatNumber(product.border?.widthCm)} cm, ${escapeHtml(border)}</dd></div>`;
  const offset = product.installation?.edgeOffsetCm === 'auto' ? t('Automatic') : msg`${formatNumber(product.installation?.edgeOffsetCm)} cm`;
  const doorZipper = product.type === 'door' ? msg`<div><dt>Zipper layout</dt><dd>${escapeHtml(label(product.zipperMode))}</dd></div>` : '';
  return msg`<article class="quote-product"><header><svg viewBox="0 0 120 84" role="img" aria-label="Thumbnail: ${escapeHtml(label(product.type))}"><polygon points="${points}"/></svg><div><h3>${index + 1}. ${escapeHtml(label(product.type))}</h3><p>${escapeHtml(label(product.position))}</p></div></header><div class="quote-product__grid"><section><h4>Dimensions</h4><ul>${dimensions}</ul><p><strong>${formatNumber(product.geometry.areaM2)} m²</strong> · perimeter ${formatNumber(product.geometry.perimeterM)} m</p></section><section><h4>Options</h4><dl><div><dt>Purpose</dt><dd>${product.type === 'door' ? t('Door') : escapeHtml(label(product.purpose))}</dd></div><div><dt>Material</dt><dd>${escapeHtml(label(product.material))}</dd></div><div><dt>Hardware by side</dt><dd>${escapeHtml(hardwareDetails(product))}</dd></div><div><dt>Hook and strap</dt><dd>${hookStrapText(product.extras?.hookStrapKits)}</dd></div><div><dt>Spacing / edge offset</dt><dd>${formatNumber(product.installation?.spacingCm)} cm / ${offset}</dd></div>${doorZipper}${borderHtml}${segmentWidthsHtml}<div><dt>Bottom weight bar</dt><dd>${yesNo(product.extras?.weightBar)}</dd></div><div><dt>Fasteners</dt><dd>${fastenerCountText(product.geometry.fasteners)}${fasteners ? ` (${fasteners})` : ''}</dd></div><div><dt>Bottom flashing, 20 cm</dt><dd>${yesNo(product.extras?.flashing)}</dd></div></dl></section></div>${lines ? msg`<table><thead><tr><th>Component</th><th>Quote</th><th>Amount</th></tr></thead><tbody>${lines}</tbody></table>` : t('<p class="quote-product__notice">Pricing requires configuration.</p>')}<p class="quote-product__subtotal"><span>Product subtotal</span><strong>${product.subtotal == null ? '-' : money(product.subtotal, quote.currency)}</strong></p></article>`;
}

function sideName(product, sideId) {
  const index = (product.geometry?.sides ?? []).findIndex(({ id }) => id === sideId);
  const side = product.geometry?.sides?.[index];
  return index >= 0 ? msg`${label(side.role)}, segment ${index + 1}` : t('Segment');
}

function hardwareDetails(product) {
  if (!product.hardwareBySide || typeof product.hardwareBySide !== 'object') return label(product.hardware);
  const sideOrder = new Map((product.geometry?.sides ?? []).map((side, index) => [side.id, index + 1]));
  const rows = Object.entries(product.hardwareBySide)
    .filter(([, selected]) => Array.isArray(selected) && selected.length)
    .map(([sideId, selected]) => msg`side №${sideOrder.get(sideId) ?? sideId}: ${selected.map(label).join(', ')}`);
  return rows.length ? rows.join('; ') : t('No fasteners');
}

function thumbnailPoints(polygon) {
  const points = Array.isArray(polygon) ? polygon.slice(0, -1) : [];
  if (points.length < 3) return '';
  const xs = points.map(({ x }) => x); const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min(104 / Math.max(maxX - minX, 1), 68 / Math.max(maxY - minY, 1));
  const width = (maxX - minX) * scale; const height = (maxY - minY) * scale;
  return points.map(({ x, y }) => `${svgNumber(8 + (104 - width) / 2 + (x - minX) * scale)},${svgNumber(8 + (68 - height) / 2 + (y - minY) * scale)}`).join(' ');
}

function label(value) { return LABELS[value] ?? (value === 'none' ? t('No installation') : String(value ?? '-')); }
function yesNo(value) { return value ? t('Yes') : t('No'); }
function hookStrapText(value) { const quantity = Number(value) || 0; return quantity ? msg`${quantity} kits.` : t('No'); }
function unit(value) { return ({ m: t('m'), m2: t('m²'), piece: t('pcs.'), kit: t('kits.'), percent: '%', fixed: getPresentation().market })[value] ?? String(value ?? ''); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? escapeHtml(String(value ?? '')) : new Intl.DateTimeFormat(locale(), { timeZone: 'UTC' }).format(date); }
function formatNumber(value) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value)); }
function svgNumber(value) { return String(Math.round(value * 100) / 100); }
function money(value, currency) { return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency ?? 'RUB', maximumFractionDigits: currency === 'RUB' ? 0 : 2 }).format(Number(value)).replaceAll('\u00a0', ' '); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

const PRINT_CSS = `@page { size: A4; margin: 14mm; } * { box-sizing: border-box; } body { margin: 0; color: #1c2521; font: 10pt/1.42 Arial, sans-serif; } .quote-summary__header { border-bottom: 2px solid #277563; padding-bottom: 6mm; } .quote-summary__header p { color: #277563; font-weight: 700; margin: 0; } h2 { margin: 1mm 0; } .quote-product { break-inside: avoid; border-bottom: 1px solid #cad7d2; padding: 5mm 0; } .quote-product header { display: flex; gap: 5mm; align-items: center; } .quote-product svg { width: 32mm; height: 23mm; } .quote-product polygon { fill: #eef8f4; stroke: #277563; stroke-width: 2; } h3, h4, p { margin: 1.5mm 0; } .quote-product__grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 7mm; } ul { margin: 0; padding-left: 5mm; } dl div { display: grid; grid-template-columns: 34mm 1fr; } dd { margin: 0; } table { border-collapse: collapse; width: 100%; margin-top: 3mm; } th, td { border-bottom: 1px solid #dae3df; padding: 1.5mm; text-align: left; } th:last-child, td:last-child { text-align: right; } .quote-product__subtotal, .quote-summary__total { display: flex; justify-content: space-between; font-size: 11pt; } .quote-summary__total { border-top: 2px solid #277563; padding-top: 4mm; font-size: 15pt; } button, [data-controls] { display: none !important; }`;
