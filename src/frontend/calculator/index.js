import { t, msg, labels, locale, getPresentation, inputLength, canonicalLength } from '../../shared/presentation.js';
import { buildGeometry, calculateQuote, getAvailableOptions, getShape, listShapes } from '../../domain/index.js';
import { fastenerCountText } from '../../shared/fasteners.js';
import { SIDE_HARDWARE } from '../../shared/constants.js';
import { clearDraft, loadDraft, saveDraft } from './draft.js';

const STORAGE_KEY = 'beynda-soft-window-calculator-draft';

const LABELS = labels({
  window: 'Soft window', door: 'Soft door', right: 'Right', left: 'Left', top: 'Top', center: 'Centered', 'both-sides': 'Both sides',
  bottom: 'Bottom', 'extension-45': 'Extension at 45°', opening: 'Opening', fixed: 'Fixed',
  'clear-pvc-700': 'Clear PVC film, 700 microns', 'tinted-pvc-700': 'Tinted PVC film, 700 microns',
  none: 'Tarpaulin instead of PVC film', grommet: 'Grommets', 'plastic-turn-button': 'Plastic turn button',
  'metal-turn-button': 'Metal turn button', 'black-metal-turn-button': 'Black metal turn button',
  'strap-bracket-45': 'Bracket and strap', 'hook-strap-kit': 'Hook and strap', 'weight-bar': 'Weight bar', 'top-sides': 'Top and sides',
  'top-bottom': 'Top and bottom', all: 'All sides', white: 'White', brown: 'Brown', gray: 'Gray',
  width: 'Width', height: 'Height', wallHeight: 'Wall height', leftWallHeight: 'Left wall',
  rightWallHeight: 'Right wall', ridgeWidth: 'Ridge width', stemWidth: 'Stem width',
  crossbarHeight: 'Crossbar height', cutSize: 'Slope size', material: 'Material', border: 'Edging',
  fastener: 'Fasteners', zipper: 'Zipper', 'weight-bar-line': 'Weight bar', flashing: 'Bottom flashing',
  surcharge: 'Surcharge', vat: 'VAT', piece: 'pcs.', m: 'm', m2: 'm²', percent: '%',
});

const DEFAULT_DIMENSIONS = Object.freeze({
  width: 120, height: 140, wallHeight: 90, leftWallHeight: 90, rightWallHeight: 105,
  ridgeWidth: 35, stemWidth: 50, crossbarHeight: 35, cutSize: 20,
});

export function mountCalculator(root, publicConfig, dependencies = {}) {
  if (!root || typeof root.addEventListener !== 'function') throw new TypeError(t('Calculator root element was not found.'));
  const storage = dependencies.storage ?? globalThis.localStorage;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const askConfirmation = dependencies.confirm ?? globalThis.confirm?.bind(globalThis) ?? (() => true);
  const hadStoredDraft = Boolean(safeGet(storage, STORAGE_KEY));
  const restored = loadDraft(storage);
  let state;
  let notice = hadStoredDraft && !restored ? t('The corrupted draft was reset. You can start a new quote.') : '';

  try {
    state = restored ? normalizeRestored(restored) : initialState();
  } catch {
    clearDraft(storage);
    state = initialState();
    notice = t('The draft could not be restored and was reset. Form data was retained.');
  }
  const availabilityMessages = [];
  state.products = state.products.map((product) => constrainToPublicConfig(product, publicConfig, availabilityMessages));
  if (!notice && availabilityMessages.length) notice = availabilityMessages.join(' ');

  let quote = null;
  let errors = {};
  let destroyed = false;
  const selectedSideByProduct = new Map(state.products.map((product) => [product.id, firstSideId(product, publicConfig)]));

  const api = {
    getState: () => snapshot(),
    addProduct,
    removeProduct,
    selectProduct,
    updateProduct,
    loadProject,
    selectSide,
    validate: validateAndFocus,
    reset,
    destroy,
  };

  const onClick = (event) => {
    const target = event.target?.closest?.('[data-action]');
    if (!target || (root.contains && !root.contains(target))) return;
    const { action, productId, shapeId, productType } = target.dataset;
    if (action === 'add') addProduct(productType);
    if (action === 'select') selectProduct(productId);
    if (action === 'remove') removeProduct(productId);
    if (action === 'shape') updateProduct(state.activeProductId, 'shape', shapeId);
    if (action === 'select-side') selectSide(state.activeProductId, target.dataset.sideId);
    if (action === 'reset') reset();
    if (action === 'validate') validateAndFocus();
  };

  const onChange = (event) => {
    const hookStrapToggle = event.target?.closest?.('[data-action="toggle-hook-strap"]');
    if (hookStrapToggle?.dataset?.action === 'toggle-hook-strap' && (!root.contains || root.contains(hookStrapToggle))) {
      updateProduct(state.activeProductId, 'extras.hookStrapKits', hookStrapToggle.checked ? 2 : 0);
      return;
    }
    const hardwareToggle = event.target?.closest?.('[data-action="toggle-side-hardware"]');
    if (hardwareToggle?.dataset?.action === 'toggle-side-hardware' && (!root.contains || root.contains(hardwareToggle))) {
      toggleSideHardware(state.activeProductId, hardwareToggle.dataset.sideId, hardwareToggle.dataset.hardware, hardwareToggle.checked);
      return;
    }
    const input = event.target?.closest?.('[data-field-path]');
    if (!input || (root.contains && !root.contains(input))) return;
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (input.type === 'number' && value !== '') value = input.dataset.displayLength ? canonicalLength(value) : Number(value);
    updateProduct(state.activeProductId, input.dataset.fieldPath, value);
  };

  const onInput = (event) => {
    const input = event.target?.closest?.('[data-field-path]');
    if (!input || (root.contains && !root.contains(input)) || input.type !== 'color') return;
    onChange(event);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  recompute();

  function addProduct(type) {
    const limit = type === 'door' ? 2 : 10;
    const count = state.products.filter((product) => product.type === type).length;
    if (count >= limit) {
      notice = type === 'door' ? 'You can add at most 2 doors.' : 'You can add at most 10 windows.';
      render();
      return false;
    }
    const availability = [];
    const product = constrainToPublicConfig(createProduct(type, nextId(type, state.products)), publicConfig, availability);
    state.products.push(product);
    state.activeProductId = product.id;
    selectedSideByProduct.set(product.id, firstSideId(product, publicConfig));
    notice = [msg`${LABELS[type]} added.`, ...availability].join(' ');
    recompute();
    return true;
  }

  function removeProduct(id) {
    const index = state.products.findIndex((product) => product.id === id);
    if (index < 0) return false;
    state.products.splice(index, 1);
    selectedSideByProduct.delete(id);
    if (state.products.length === 0) state.products.push(createProduct('window', nextId('window', state.products)));
    if (!state.products.some((product) => product.id === state.activeProductId)) {
      state.activeProductId = state.products[Math.min(index, state.products.length - 1)].id;
    }
    notice = t('Product removed and total recalculated.');
    recompute();
    return true;
  }

  function selectProduct(id) {
    if (!state.products.some((product) => product.id === id)) return false;
    state.activeProductId = id;
    render();
    persist();
    return true;
  }

  function selectSide(id, sideId) {
    const product = state.products.find((item) => item.id === id);
    if (!product || !sideIds(product, publicConfig).includes(sideId)) return false;
    selectedSideByProduct.set(id, sideId);
    render();
    return true;
  }

  function toggleSideHardware(id, sideId, hardware, enabled) {
    const product = state.products.find((item) => item.id === id);
    if (!product || !sideIds(product, publicConfig).includes(sideId)) return false;
    const allowed = optionsFor(product, publicConfig).sideHardware;
    if (!allowed.includes(hardware)) return false;
    const current = product.hardwareBySide?.[sideId] ?? [];
    const selected = enabled ? [...new Set([...current, hardware])] : current.filter((item) => item !== hardware);
    return updateProduct(id, msg`hardwareBySide.${sideId}`, selected);
  }

  function updateProduct(id, path, value) {
    const index = state.products.findIndex((product) => product.id === id);
    if (index < 0) return false;
    const previous = state.products[index];
    const candidate = setPath(previous, path, value);
    const messages = [];

    if (path === 'shape') {
      candidate.dimensions = dimensionsForShape(candidate.type, value, candidate.dimensions);
      candidate.hardwareBySide = remapSideHardware(candidate, publicConfig);
      selectedSideByProduct.set(id, firstSideId(candidate, publicConfig));
    }
    if (path === 'border.perSide' && !value) delete candidate.border.widthsBySide;
    const options = optionsFor(candidate, publicConfig);
    candidate.hardwareBySide = sanitizeSideHardware(candidate, publicConfig);
    if (!candidate.hardwareBySide && !options.hardware.includes(candidate.hardware)) {
      candidate.hardware = options.hardware[0];
      messages.push(t('Incompatible hardware was reset.'));
    }
    if (!candidate.hardwareBySide && !options.installationModes.includes(candidate.installation.mode)) {
      candidate.installation.mode = options.installationModes[0];
      messages.push(t('Incompatible installation mode was reset.'));
    }
    if (!options.positions.includes(candidate.position)) {
      candidate.position = options.positions[0];
      messages.push(t('Incompatible position was reset.'));
    }

    if (path.startsWith('dimensions.') || path.startsWith('border.') || path.startsWith('installation.') || path.startsWith('hardwareBySide.') || path.startsWith('extras.')) {
      try {
        if (path.startsWith('dimensions.')) buildGeometry(toGeometryProduct(candidate, publicConfig));
        else calculateQuote({ version: 1, products: [candidate] }, publicConfig);
      } catch (error) {
        state.activeProductId = id;
        const errorField = error.field ?? path;
        errors = { [path]: error.message, [errorField]: error.message };
        notice = t('Check the value: the previous valid value was retained.');
        render();
        focusFirstError();
        return false;
      }
    }

    state.products[index] = candidate;
    notice = messages.join(' ');
    recompute();
    if (Object.keys(errors).length > 0) focusFirstError();
    return true;
  }

  function reset() {
    if (!askConfirmation(t('Start again? The current technical draft will be deleted.'))) return false;
    clearDraft(storage);
    state = initialState();
    selectedSideByProduct.clear();
    selectedSideByProduct.set(state.activeProductId, firstSideId(state.products[0], publicConfig));
    notice = t('New quote started.');
    recompute();
    dependencies.onReset?.();
    return true;
  }

  function loadProject(project) {
    const next = normalizeRestored({ ...project, activeProductId: project?.products?.[0]?.id });
    // Validate before replacing the current draft; never silently discard archived options.
    calculateQuote({ version: 1, products: next.products }, publicConfig);
    state = next;
    selectedSideByProduct.clear();
    for (const product of state.products) selectedSideByProduct.set(product.id, firstSideId(product, publicConfig));
    notice = t('Archived quote opened. Prices have been recalculated using current rates.');
    recompute();
  }

  function validateAndFocus() {
    recompute();
    if (Object.keys(errors).length > 0) {
      notice = t('Complete the required fields marked below.');
      render();
      focusFirstError();
      return false;
    }
    notice = quote?.status === 'configuration-required' ? t('Pricing must be configured by an administrator.') : t('Product options are complete.');
    render();
    return quote?.status === 'ready';
  }

  function recompute() {
    errors = {};
    try {
      quote = calculateQuote({ version: 1, products: state.products }, publicConfig);
      quote = { ...quote, presentation: getPresentation() };
    } catch (error) {
      quote = null;
      const context = productErrorContext(error.field, state.products);
      if (context.productId) state.activeProductId = context.productId;
      errors[context.field] = error.message;
    }
    persist();
    render();
  }

  function persist() {
    saveDraft({ version: 1, products: state.products, activeProductId: state.activeProductId, updatedAt: now() }, storage);
  }

  function snapshot() {
    return {
      version: 1,
      activeProductId: state.activeProductId,
      products: state.products.map((product) => {
        const available = optionsFor(product, publicConfig);
        return clone({ ...product, availableInstallationModes: available.installationModes, availablePositions: available.positions });
      }),
      quote,
      errors: { ...errors },
      notice,
    };
  }

  function render() {
    if (destroyed) return;
    root.innerHTML = renderCalculator(state, quote, errors, notice, publicConfig, selectedSideByProduct.get(state.activeProductId));
    for (const input of root.querySelectorAll?.('input[type=number][data-field-path]') ?? []) {
      if (!/^(dimensions\.|border\.widthCm$|installation\.(spacingCm|edgeOffsetCm)$)/.test(input.dataset.fieldPath)) continue;
      input.dataset.displayLength = 'true';
      for (const attr of ['value', 'min', 'max']) if (input.hasAttribute(attr)) input.setAttribute(attr, inputLength(input.getAttribute(attr)));
      input.step = 'any';
    }
  }

  function focusFirstError() {
    const field = Object.keys(errors)[0];
    if (!field) return;
    queueMicrotask(() => root.querySelector?.(`[data-field-path="${field}"][aria-invalid="true"]`)?.focus?.());
  }

  function destroy() {
    destroyed = true;
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
  }

  return api;
}

function initialState() {
  const product = createProduct('window', 'window-1');
  return { version: 1, products: [product], activeProductId: product.id };
}

function normalizeRestored(draft) {
  if (!draft.products.length || !draft.products.some(({ id }) => id === draft.activeProductId)) throw new TypeError('Invalid active product');
  for (const product of draft.products) {
    getShape(product.type, product.shape);
    buildGeometry(product);
  }
  return { version: 1, products: clone(draft.products), activeProductId: draft.activeProductId };
}

function createProduct(type, id) {
  const isDoor = type === 'door';
  return {
    id,
    type,
    shape: 'rectangle',
    position: isDoor ? 'left' : 'right',
    dimensions: { width: 120, height: isDoor ? 210 : 140 },
    ...(isDoor ? {} : { purpose: 'opening' }),
    material: 'clear-pvc-700',
    hardware: 'plastic-turn-button',
    hardwareBySide: { 'top-1': ['plastic-turn-button'] },
    ...(isDoor ? { zipperMode: 'center' } : {}),
    installation: { mode: 'top', edgeOffsetCm: 'auto', spacingCm: 30, replaceTopWithGrommets: false },
    border: { widthCm: 10, color: 'white' },
    extras: { weightBar: false, flashing: false, hookStrapKits: 0 },
  };
}

function renderCalculator(state, quote, errors, notice, config, selectedSideId) {
  const active = state.products.find(({ id }) => id === state.activeProductId) ?? state.products[0];
  const options = optionsFor(active, config);
  const shape = getShape(active.type, active.shape);
  const geometry = safeGeometry(active, config);
  return msg`<section class="wc-shell" aria-label="Soft Window Calculator">
    <header class="wc-header">
      <div><p class="wc-eyebrow">Beynda</p><h2>Calculate your soft window panels</h2></div>
      <button class="wc-button wc-button--quiet" type="button" data-action="reset">Start again</button>
    </header>
    ${notice ? `<div class="wc-notice" role="status">${escapeHtml(notice)}</div>` : ''}
    <nav class="wc-products" aria-label="Products in this quote">${state.products.map((product, index) => productTab(product, index, active.id)).join('')}
      <div class="wc-add"><button type="button" data-action="add" data-product-type="window">+ Soft window</button><button type="button" data-action="add" data-product-type="door">+ Soft door</button></div>
    </nav>
    <div class="wc-layout">
      <form class="wc-settings" novalidate>${renderSettings(active, options, shape, errors, config, state.products.length > 1 || active.type === 'door')}</form>
      <section class="wc-drawing" aria-labelledby="wc-drawing-title"><div class="wc-section-heading"><p>Step 2</p><h3 id="wc-drawing-title">Drawing and dimensions</h3></div>${renderDrawing(active, geometry, shape, errors, options, selectedSideId, config.ranges?.dimensions)}</section>
      <aside class="wc-summary" aria-labelledby="wc-summary-title"><div class="wc-section-heading"><p>Total</p><h3 id="wc-summary-title">Your quote</h3></div>${renderSummary(state.products, quote, config)}</aside>
    </div>
    <div class="wc-mobile-total"><span>${quote?.status === 'ready' ? t('Total') : t('Estimated quote')}</span><strong>${formatTotal(quote, config)}</strong></div>
  </section>`;
}

function productTab(product, index, activeId) {
  return msg`<div class="wc-product-chip ${product.id === activeId ? 'is-active' : ''}">
    <button type="button" data-action="select" data-product-id="${escapeHtml(product.id)}" aria-current="${product.id === activeId ? 'true' : 'false'}">
      <span>${index + 1}</span><strong>${LABELS[product.type]}</strong>
    </button><button type="button" class="wc-remove" data-action="remove" data-product-id="${escapeHtml(product.id)}" aria-label="Remove ${LABELS[product.type].toLowerCase()} ${index + 1}">×</button>
  </div>`;
}

function renderSettings(product, options, shape, errors, config, showPosition) {
  const ranges = config.ranges ?? {};
  const geometry = safeGeometry(product, config);
  const borderWidthError = errors['border.widthCm'];
  const customColorError = errors['border.customColor'];
  return msg`<div class="wc-section-heading"><p>Step 1</p><h3>Product settings</h3></div>
    ${product.type === 'window' ? msg`<fieldset><legend>Window shape</legend><div class="wc-shapes">${listShapes('window').map((item) => shapeButton(item, product.shape)).join('')}</div></fieldset>` : t('<p class="wc-door-note">Doors are always rectangular.</p>')}
    <div class="wc-form-grid">
      ${showPosition ? selectField('position', t('Position on the structure'), product.position, options.positions) : ''}
      ${product.type === 'window' ? selectField('purpose', t('Purpose'), product.purpose, options.purposes) : ''}
      ${selectField('material', t('Material'), product.material, options.materials)}
      ${selectField('installation.spacingCm', t('Fastener spacing'), product.installation.spacingCm, [20, 30, 40])}
      <label class="wc-field"><span>Edge offset</span><select data-field-path="installation.edgeOffsetCm"><option value="auto" ${product.installation.edgeOffsetCm === 'auto' ? 'selected' : ''}>Automatic</option>${rangeOptions(3, 15, product.installation.edgeOffsetCm)}</select></label>
      ${product.type === 'door' ? selectField('zipperMode', t('Zipper layout'), product.zipperMode, options.zipperModes) : ''}
      <label class="wc-field"><span>Edging width, cm</span><input type="number" min="${ranges.borderWidthCm?.min ?? 7}" max="${ranges.borderWidthCm?.max ?? 15}" value="${product.border.widthCm}" data-field-path="border.widthCm" required aria-invalid="${Boolean(borderWidthError)}">${borderWidthError ? `<small class="wc-error" role="alert">${escapeHtml(borderWidthError)}</small>` : ''}</label>
      <label class="wc-field"><span>Edging color</span><select data-field-path="border.color">${['white', 'brown', 'gray', 'custom'].map((value) => `<option value="${value}" ${product.border.color === value ? 'selected' : ''}>${LABELS[value] ?? t('Custom color')}</option>`).join('')}</select></label>
      ${product.border.color === 'custom' ? msg`<label class="wc-field"><span>Custom color</span><input type="color" value="${escapeHtml(product.border.customColor ?? '#1f6c5b')}" data-field-path="border.customColor" required aria-invalid="${Boolean(customColorError)}">${customColorError ? `<small class="wc-error" role="alert">${escapeHtml(customColorError)}</small>` : ''}</label>` : ''}
    </div>
    <div class="wc-checks"><label><input type="checkbox" data-field-path="border.perSide" ${product.border.perSide ? 'checked' : ''}> Set edging width by side</label></div>
    <fieldset class="wc-bottom-extras"><legend>Bottom side</legend><div class="wc-checks"><label><input type="checkbox" data-field-path="extras.weightBar" ${product.extras?.weightBar ? 'checked' : ''}> Bottom weight bar</label><label><input type="checkbox" data-field-path="extras.flashing" ${product.extras?.flashing ? 'checked' : ''}> Bottom flashing, 20 cm</label></div></fieldset>
    ${options.hardware.includes('hook-strap-kit') ? msg`<fieldset class="wc-extra-hardware"><legend>Additional hardware</legend><div class="wc-checks"><label><input type="checkbox" data-action="toggle-hook-strap" ${(product.extras?.hookStrapKits ?? 0) > 0 ? 'checked' : ''}> Hook and strap</label></div>${(product.extras?.hookStrapKits ?? 0) > 0 ? msg`<label class="wc-field"><span>Number of kits</span><input type="number" min="2" max="1000" step="1" value="${product.extras.hookStrapKits}" data-field-path="extras.hookStrapKits" required aria-invalid="${Boolean(errors['extras.hookStrapKits'])}">${errors['extras.hookStrapKits'] ? `<small class="wc-error" role="alert">${escapeHtml(errors['extras.hookStrapKits'])}</small>` : ''}</label>` : ''}</fieldset>` : ''}
    ${product.border.perSide && geometry ? msg`<fieldset class="wc-side-widths"><legend>Edging by side</legend><div class="wc-form-grid">${geometry.sides.map((side, index) => {
      const key = msg`border.widthsBySide.${side.id}`;
      const error = errors[key];
      return msg`<label class="wc-field"><span>${LABELS[side.role] ?? side.role}, segment ${index + 1}</span><input type="number" min="${ranges.borderWidthCm?.min ?? 7}" max="${ranges.borderWidthCm?.max ?? 15}" value="${product.border.widthsBySide?.[side.id] ?? product.border.widthCm}" data-field-path="${key}" required aria-invalid="${Boolean(error)}">${error ? `<small class="wc-error" role="alert">${escapeHtml(t(error))}</small>` : ''}</label>`;
    }).join('')}</div></fieldset>` : ''}`;
}

function renderDrawing(product, geometry, shape, errors, options, selectedSideId, dimensionLimits = {}) {
  const displayGeometry = geometry ? schematicGeometry(geometry) : null;
  const view = displayGeometry ? svgView(displayGeometry) : { viewBox: '0 0 200 160', polygon: '', fasteners: '' };
  const activeSide = geometry?.sides.find(({ id }) => id === selectedSideId) ?? geometry?.sides[0];
  return msg`<div class="wc-canvas" style="--border-color:${borderColor(product.border)}"><div class="wc-svg-stage"><svg viewBox="${view.viewBox}" role="img" aria-label="Drawing: ${escapeHtml(t(shape.name))}"><polygon class="wc-sheet" points="${view.polygon}"/>${displayGeometry ? renderBorderSegments(product, displayGeometry, activeSide?.id) : ''}${displayGeometry ? renderDrawingExtras(product, displayGeometry) : ''}${view.fasteners}</svg></div></div>
    <div class="wc-dimension-grid" aria-label="Product dimensions">${shape.dimensions.map((name) => numberField(product, name, errors, dimensionLimits)).join('')}</div>
    ${geometry ? msg`<dl class="wc-metrics"><div><dt>Area</dt><dd>${formatNumber(geometry.areaM2)} m²</dd></div><div><dt>Perimeter</dt><dd>${formatNumber(geometry.perimeterM)} m</dd></div><div><dt>Fasteners</dt><dd>${fastenerCountText(geometry.fasteners)}</dd></div></dl>${renderSideHardware(product, geometry, activeSide, options)}` : t('<p class="wc-error" role="alert">The drawing will appear once the dimensions are valid.</p>')}`;
}

function renderSideHardware(product, geometry, side, options) {
  if (!side) return '';
  const sideNumber = geometry.sides.indexOf(side) + 1;
  const selected = product.hardwareBySide?.[side.id] ?? [];
  return msg`<fieldset class="wc-side-hardware"><legend>Side hardware №${sideNumber} <small>${formatNumber(side.lengthCm)} cm</small></legend><p>Select another side number on the drawing to configure it.</p><div class="wc-hardware-options">${options.sideHardware.map((hardware) => msg`<label class="wc-hardware-option wc-hardware-option--${hardware}"><input type="checkbox" data-action="toggle-side-hardware" data-side-id="${side.id}" data-hardware="${hardware}" ${selected.includes(hardware) ? 'checked' : ''}><span class="wc-hardware-symbol" aria-hidden="true"></span><span>${LABELS[hardware]}</span></label>`).join('')}</div></fieldset>`;
}

function renderSummary(products, quote, config) {
  const normalized = new Map((quote?.products ?? []).map((product) => [product.id, product]));
  return msg`<div class="wc-summary-list">${products.map((source, index) => {
    const product = normalized.get(source.id);
    const geometry = product?.geometry ?? safeGeometry(source, config);
    const view = geometry ? svgView(geometry) : { viewBox: '0 0 200 160', polygon: '' };
    const lines = (quote?.lineItems ?? []).filter(({ productId }) => productId === source.id);
    return msg`<article class="wc-summary-card"><div class="wc-summary-product"><svg viewBox="${view.viewBox}" aria-hidden="true"><polygon points="${view.polygon}"/></svg><div><strong>${index + 1}. ${LABELS[source.type]}</strong><span>${LABELS[source.position]}</span><small>${Object.entries(source.dimensions).map(([key, value]) => msg`${LABELS[key]} ${value} cm`).join(' · ')}</small></div></div>
      <dl class="wc-spec-list"><div><dt>Material</dt><dd>${LABELS[source.material]}</dd></div><div><dt>Purpose</dt><dd>${source.type === 'door' ? t('Door') : LABELS[source.purpose]}</dd></div><div><dt>Hardware</dt><dd>${hardwareSummary(source, geometry)}</dd></div><div><dt>Hook and strap</dt><dd>${hookStrapSummary(source.extras?.hookStrapKits)}</dd></div>${source.type === 'door' ? msg`<div><dt>Zipper layout</dt><dd>${LABELS[source.zipperMode]}</dd></div>` : ''}<div><dt>Offset</dt><dd>${source.installation.edgeOffsetCm === 'auto' ? t('Automatic') : msg`${source.installation.edgeOffsetCm} cm`}</dd></div><div><dt>Spacing</dt><dd>${source.installation.spacingCm} cm</dd></div><div><dt>Weight bar</dt><dd>${source.extras?.weightBar ? t('Yes, along the bottom') : t('No')}</dd></div><div><dt>Flashing</dt><dd>${source.extras?.flashing ? t('Yes, 20 cm') : t('No')}</dd></div>${source.border.perSide ? msg`<div><dt>Edging color</dt><dd>${borderColorName(source.border)}</dd></div><div><dt>Edging by side</dt><dd>${borderSideSummary(source, geometry)}</dd></div>` : msg`<div><dt>Edging</dt><dd>${source.border.widthCm} cm · ${borderColorName(source.border)}</dd></div>`}</dl>
      ${geometry ? msg`<p>${formatNumber(geometry.areaM2)} m² · ${fastenerCountText(geometry.fasteners)}</p>` : ''}
      ${lines.length ? `<ul>${lines.map((line) => `<li><span>${escapeHtml(t(line.label))}</span><strong>${money(line.amount, quote.currency)}</strong></li>`).join('')}</ul>` : ''}
      <div class="wc-subtotal"><span>Product</span><strong>${product?.subtotal == null ? '-' : money(product.subtotal, quote.currency)}</strong></div></article>`;
  }).join('')}</div>
  <div class="wc-grand-total"><span>${quote?.status === 'configuration-required' ? t('Pricing requires configuration') : t('Total')}</span><strong>${formatTotal(quote, config)}</strong></div>`;
}

function shapeButton(shape, selected) {
  const sample = createProduct('window', 'sample');
  sample.shape = shape.id;
  sample.dimensions = dimensionsForShape('window', shape.id, DEFAULT_DIMENSIONS);
  delete sample.hardwareBySide;
  sample.installation.mode = 'none';
  const view = svgView(buildGeometry(sample));
  return `<button type="button" class="wc-shape ${shape.id === selected ? 'is-active' : ''}" data-action="shape" data-shape-id="${shape.id}" aria-pressed="${shape.id === selected}"><svg viewBox="${view.viewBox}" aria-hidden="true"><polygon points="${view.polygon}"/></svg><span>${escapeHtml(t(shape.name))}</span></button>`;
}

function numberField(product, name, errors, limits = {}) {
  const key = `dimensions.${name}`;
  const error = errors[key];
  const errorId = `error-${product.id}-${name}`;
  const minimum = ['width', 'height'].includes(name) ? (limits.min ?? 20) : (limits.minSegment ?? 5);
  const maximum = limits.max ?? 1500;
  return msg`<label class="wc-field wc-field--dimension" data-dimension-name="${name}"><span>${LABELS[name]}, cm</span><input type="number" min="${minimum}" max="${maximum}" step="1" value="${product.dimensions[name]}" data-field-path="${key}" required aria-invalid="${Boolean(error)}" ${error ? `aria-describedby="${errorId}"` : ''}>${error ? `<small class="wc-error" id="${errorId}" role="alert">${escapeHtml(t(error))}</small>` : ''}</label>`;
}

function selectField(path, label, selected, values) {
  return `<label class="wc-field"><span>${label}</span><select data-field-path="${path}" required>${values.map((value) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${path === 'installation.mode' && value === 'none' ? t('No installation') : LABELS[value] ?? value}</option>`).join('')}</select></label>`;
}

function svgView(geometry) {
  const points = geometry.polygon.slice(0, -1);
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const padding = Math.max(maxX - minX, maxY - minY) * 0.12 + 8;
  return {
    viewBox: `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`,
    polygon: points.map(({ x, y }) => `${x},${y}`).join(' '),
    fasteners: groupedFastenerPositions(geometry.fasteners.positions)
      .map((positions) => fastenerMarkerGroup(positions, geometry.sides))
      .join(''),
  };
}

function schematicGeometry(geometry) {
  const points = geometry.polygon.slice(0, -1);
  const xs = points.map(({ x }) => x); const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const sourceWidth = Math.max(maxX - minX, 1); const sourceHeight = Math.max(maxY - minY, 1);
  const ratio = Math.max(0.65, Math.min(2.4, sourceWidth / sourceHeight));
  const targetWidth = ratio >= 1 ? 240 : 180 * ratio;
  const targetHeight = ratio >= 1 ? 240 / ratio : 180;
  const mapPoint = ({ x, y }) => ({
    x: roundDisplay((x - minX) / sourceWidth * targetWidth),
    y: roundDisplay((y - minY) / sourceHeight * targetHeight),
  });
  const polygon = geometry.polygon.map(mapPoint);
  const sides = geometry.sides.map((side) => ({ ...side, start: mapPoint(side.start), end: mapPoint(side.end) }));
  const positions = geometry.fasteners.positions.map((position) => ({ ...position, ...mapPoint(position) }));
  return { ...geometry, polygon, sides, fasteners: { ...geometry.fasteners, positions } };
}

function groupedFastenerPositions(positions) {
  const groups = new Map();
  for (const position of positions) {
    const key = `${position.sideId}:${position.distanceCm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(position);
  }
  return [...groups.values()];
}

function fastenerMarkerGroup(positions, sides) {
  const markers = positions.map((position, index) => fastenerMarker(position, sides, index, positions.length)).join('');
  return msg`<g class="wc-fastener-position" data-hardware-count="${positions.length}">${markers}</g>`;
}

function fastenerMarker(position, sides, markerIndex = 0, markerCount = 1) {
  const side = sides.find(({ id }) => id === position.sideId);
  const dx = (side?.end.x ?? position.x + 1) - (side?.start.x ?? position.x);
  const dy = (side?.end.y ?? position.y) - (side?.start.y ?? position.y);
  const length = Math.hypot(dx, dy) || 1;
  const markerOffset = (markerIndex - (markerCount - 1) / 2) * 4;
  const x = roundDisplay(position.x + dx / length * markerOffset);
  const y = roundDisplay(position.y + dy / length * markerOffset);
  const title = `<title>${escapeHtml(LABELS[position.hardware] ?? position.hardware ?? t('Fastener'))}</title>`;
  const classes = msg`wc-fastener wc-fastener--${escapeHtml(position.hardware ?? 'default')}`;
  if (position.hardware === 'plastic-turn-button') return `<rect class="${classes}" x="${x - 2.6}" y="${y - 2.6}" width="5.2" height="5.2" rx="1">${title}</rect>`;
  if (position.hardware === 'metal-turn-button') return `<path class="${classes}" d="M ${x} ${y - 3.2} L ${x + 3.2} ${y} L ${x} ${y + 3.2} L ${x - 3.2} ${y} Z">${title}</path>`;
  if (position.hardware === 'black-metal-turn-button') return `<path class="${classes}" d="M ${x} ${y - 3.3} L ${x + 3.3} ${y + 2.8} L ${x - 3.3} ${y + 2.8} Z">${title}</path>`;
  if (position.hardware === 'strap-bracket-45') return `<line class="${classes}" x1="${x - 3.5}" y1="${y}" x2="${x + 3.5}" y2="${y}">${title}</line>`;
  return `<circle class="${classes}" cx="${x}" cy="${y}" r="2.5">${title}</circle>`;
}

function renderBorderSegments(product, geometry, selectedSideId) {
  return geometry.sides.map((side) => {
    const width = product.border.widthsBySide?.[side.id] ?? product.border.widthCm;
    const selected = side.id === selectedSideId;
    const label = segmentLabel(side, geometry.sides.indexOf(side) + 1, selected);
    return msg`<line class="wc-side-hit" data-action="select-side" data-side-id="${side.id}" x1="${side.start.x}" y1="${side.start.y}" x2="${side.end.x}" y2="${side.end.y}"/><line class="wc-border-segment" data-action="select-side" data-side-id="${side.id}" x1="${side.start.x}" y1="${side.start.y}" x2="${side.end.x}" y2="${side.end.y}" stroke-width="${width}"/>${label}`;
  }).join('');
}

function segmentLabel(side, number, selected = false) {
  const dx = side.end.x - side.start.x;
  const dy = side.end.y - side.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = Math.max(5, Math.min(10, length * 0.08));
  const x = (side.start.x + side.end.x) / 2 + nx * offset;
  const y = (side.start.y + side.end.y) / 2 + ny * offset;
  const selectedBackground = selected ? msg`<circle class="wc-segment-label-bg is-selected" cx="${x}" cy="${y}" r="8" aria-hidden="true"/>` : '';
  return msg`${selectedBackground}<text class="wc-segment-label ${selected ? 'is-selected' : ''}" role="button" tabindex="0" aria-pressed="${selected}" data-action="select-side" data-side-id="${side.id}" data-segment-number="${number}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${number}</text>`;
}

function renderDrawingExtras(product, geometry) {
  const lines = [];
  const hookStrapKits = Math.max(0, Math.trunc(Number(product.extras?.hookStrapKits) || 0));
  const topSides = geometry.sides.filter(({ role }) => role === 'top');
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
    const x = roundDisplay(target.start.x + (target.end.x - target.start.x) * ratio);
    const y = roundDisplay(target.start.y + (target.end.y - target.start.y) * ratio);
    lines.push(msg`<path class="wc-hook-strap" d="M ${x + 4} ${y - 11} C ${x - 5} ${y - 11}, ${x - 5} ${y - 3}, ${x + 1} ${y - 3} C ${x + 5} ${y - 3}, ${x + 4} ${y + 3}, ${x} ${y + 3}"><title>Hook and strap kit ${index + 1}</title></path>`);
  }
  if (product.extras?.flashing) {
    for (const side of geometry.sides.filter(({ role }) => role === 'bottom')) {
      lines.push(msg`<line class="wc-flashing" x1="${side.start.x}" y1="${side.start.y}" x2="${side.end.x}" y2="${side.end.y}"><title>Bottom flashing, 20 cm</title></line>`);
    }
  }
  if (product.extras?.weightBar) {
    for (const side of geometry.sides.filter(({ role }) => role === 'bottom')) {
      lines.push(msg`<line class="wc-weight-bar" x1="${side.start.x}" y1="${side.start.y}" x2="${side.end.x}" y2="${side.end.y}"><title>Bottom weight bar</title></line>`);
    }
  }
  if (product.type === 'door') {
    const title = msg`Zipper ${LABELS[product.zipperMode].toLowerCase()}`;
    if (product.zipperMode === 'center') {
      const points = geometry.polygon.slice(0, -1);
      const xs = points.map(({ x }) => x);
      const ys = points.map(({ y }) => y);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2;
      lines.push(`<line class="wc-zipper" x1="${x}" y1="${Math.min(...ys)}" x2="${x}" y2="${Math.max(...ys)}"><title>${title}</title></line>`);
    } else {
      for (const side of geometry.sides.filter(({ role }) => role === 'left' || role === 'right')) {
        lines.push(`<line class="wc-zipper" x1="${side.start.x}" y1="${side.start.y}" x2="${side.end.x}" y2="${side.end.y}"><title>${title}</title></line>`);
      }
    }
  }
  return lines.join('');
}

function safeGeometry(product, config) {
  try { return buildGeometry(toGeometryProduct(product, config)); } catch { return null; }
}

function toGeometryProduct(product, config) {
  return { ...product, dimensionLimits: config.ranges?.dimensions, installation: { ...product.installation, hardware: product.hardware, hardwareBySide: product.hardwareBySide } };
}

function dimensionsForShape(type, shapeId, current = {}) {
  const shape = getShape(type, shapeId);
  return Object.fromEntries(shape.dimensions.map((name) => [name, Number(current[name]) || DEFAULT_DIMENSIONS[name]]));
}

function optionsFor(product, config) {
  const domainOptions = getAvailableOptions({ type: product.type, purpose: product.purpose ?? 'opening' });
  const configuredMaterials = config.availableOptions?.materials;
  const configuredHardware = config.availableOptions?.hardware;
  const hardware = (Array.isArray(configuredHardware) ? domainOptions.hardware.filter((value) => configuredHardware.includes(value)) : domainOptions.hardware)
    .filter((value) => value !== 'weight-bar');
  return {
    ...domainOptions,
    materials: Array.isArray(configuredMaterials) ? domainOptions.materials.filter((value) => configuredMaterials.includes(value)) : domainOptions.materials,
    hardware,
    sideHardware: hardware.filter((value) => SIDE_HARDWARE.includes(value)),
  };
}

function constrainToPublicConfig(product, config, messages) {
  const result = clone(product);
  const options = optionsFor(result, config);
  if (options.materials.length && !options.materials.includes(result.material)) {
    result.material = options.materials[0];
    messages.push(t('Unavailable material was replaced with an allowed option.'));
  }
  if (options.hardware.length && !options.hardware.includes(result.hardware)) {
    result.hardware = options.hardware[0];
    messages.push(t('Unavailable hardware was replaced with an allowed option.'));
  }
  result.hardwareBySide = sanitizeSideHardware(result, config);
  if (!options.hardware.includes('hook-strap-kit') && (result.extras?.hookStrapKits ?? 0) > 0) {
    result.extras = { ...result.extras, hookStrapKits: 0 };
    messages.push(t('The unavailable hook and strap kit was removed.'));
  }
  return result;
}

function setPath(source, path, value) {
  const result = clone(source);
  const parts = path.split('.');
  let cursor = result;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
  return result;
}

function productErrorContext(field, products) {
  const match = /^products\.(\d+)\.(.+)$/.exec(field ?? '');
  if (!match) return { productId: null, field: field ?? 'project' };
  return { productId: products[Number(match[1])]?.id ?? null, field: match[2] };
}

function rangeOptions(min, max, selected) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index).map((value) => msg`<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${value} cm</option>`).join('');
}

function nextId(type, products) {
  let index = 1;
  while (products.some(({ id }) => id === `${type}-${index}`)) index += 1;
  return `${type}-${index}`;
}

function borderColor(border) {
  return ({ white: '#f4f0e7', brown: '#70452f', gray: '#718078' })[border.color] ?? border.customColor ?? border.color ?? '#f4f0e7';
}

function borderColorName(border) {
  if (border.color === 'custom') return border.customColor ?? t('Custom color');
  return LABELS[border.color] ?? border.color;
}

function borderSideSummary(product, geometry) {
  return geometry.sides.map((side, index) => msg`${LABELS[side.role] ?? t('Side')}, segment ${index + 1}: ${product.border.widthsBySide?.[side.id] ?? product.border.widthCm} cm`).join(' · ');
}

function hardwareSummary(product, geometry) {
  if (!geometry) return t('Not selected');
  const rows = geometry.sides.map((side, index) => {
    const selected = product.hardwareBySide?.[side.id] ?? [];
    return selected.length ? `№${index + 1}: ${selected.map((hardware) => LABELS[hardware]).join(', ')}` : null;
  }).filter(Boolean);
  return rows.length ? rows.join(' · ') : t('No fasteners');
}

function geometrySidesWithoutFasteners(product, config) {
  try {
    const source = clone(product);
    delete source.hardwareBySide;
    source.hardware = source.hardware === 'weight-bar' ? 'grommet' : (source.hardware ?? 'grommet');
    source.installation = { ...source.installation, hardware: source.hardware, edgeOffsetCm: 'auto', spacingCm: 30 };
    return buildGeometry({ ...source, dimensionLimits: config.ranges?.dimensions }).sides;
  } catch {
    return [];
  }
}

function sideIds(product, config) {
  return geometrySidesWithoutFasteners(product, config).map(({ id }) => id);
}

function firstSideId(product, config) {
  return sideIds(product, config)[0] ?? '';
}

function sanitizeSideHardware(product, config) {
  const sides = geometrySidesWithoutFasteners(product, config);
  const allowed = new Set(optionsFor(product, config).sideHardware);
  const existing = product.hardwareBySide && typeof product.hardwareBySide === 'object' && !Array.isArray(product.hardwareBySide)
    ? product.hardwareBySide
    : null;
  const result = {};
  if (existing) {
    for (const side of sides) {
      const selected = existing[side.id];
      if (Array.isArray(selected)) result[side.id] = [...new Set(selected.filter((hardware) => allowed.has(hardware)))];
    }
    return result;
  }
  const legacyHardware = allowed.has(product.hardware) ? product.hardware : [...allowed][0];
  const roles = new Set({
    none: [], top: ['top'], 'top-sides': ['top', 'left', 'right'], 'top-bottom': ['top', 'bottom'], all: ['top', 'right', 'bottom', 'left'],
  }[product.installation?.mode] ?? ['top']);
  for (const side of sides) result[side.id] = legacyHardware && roles.has(side.role) ? [legacyHardware] : [];
  return result;
}

function remapSideHardware(product, config) {
  const existing = product.hardwareBySide ?? {};
  const allowed = new Set(optionsFor(product, config).sideHardware);
  return Object.fromEntries(sideIds(product, config).map((sideId, index) => {
    const selected = existing[sideId];
    if (Array.isArray(selected)) return [sideId, [...new Set(selected.filter((hardware) => allowed.has(hardware)))]];
    return [sideId, index === 0 && allowed.has(product.hardware) ? [product.hardware] : []];
  }));
}

function formatTotal(quote, config) {
  if (!quote || quote.status !== 'ready') return t('Pricing requires configuration');
  return money(quote.total, quote.currency ?? config.currency);
}

function money(value, currency = 'RUB') {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || 'RUB', maximumFractionDigits: currency === 'RUB' ? 0 : 2 }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);
}

function hookStrapSummary(quantity) {
  const count = Number(quantity) || 0;
  if (!count) return t('No');
  const tail = count === 1 ? t('kit') : t('kits');
  return `${count} ${tail}`;
}

function roundDisplay(value) { return Math.round(value * 1000) / 1000; }

function safeGet(storage, key) {
  try { return storage?.getItem(key); } catch { return null; }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
