import { getAvailableOptions } from './catalog.js';
import { buildGeometry } from './geometry.js';
import { DomainValidationError } from '../shared/errors.js';
import {
  BORDER_COLORS,
  BORDER_WIDTH_RANGE_CM,
  CONFIGURATION_REQUIRED_TEXT,
  QUOTE_STATUS,
  SIDE_HARDWARE,
} from '../shared/constants.js';

const HARDWARE_LABELS = Object.freeze({
  grommet: 'Grommets',
  'plastic-turn-button': 'Plastic turn button',
  'metal-turn-button': 'Metal turn button',
  'black-metal-turn-button': 'Black metal turn button',
  'strap-bracket-45': 'Bracket and strap',
  'hook-strap-kit': 'Hook and strap',
});

export function calculateQuote(project, config) {
  assertRecord(project, 'Quote project is missing.', 'project');
  assertRecord(config, 'Quote configuration is missing.', 'config');
  if (!Array.isArray(project.products) || project.products.length === 0) {
    throw new DomainValidationError('Add at least one product.', 'products', 'REQUIRED');
  }
  validateProductLimits(project.products);

  const normalizedProducts = project.products.map((product, index) => normalizeProduct(product, config, index));
  const missingTariffs = findMissingTariffs(normalizedProducts, config);
  const createdAt = new Date().toISOString();
  const base = {
    version: 1,
    quoteNumber: `Q-${Date.now().toString(36).toUpperCase()}`,
    createdAt,
    currency: config.currency ?? 'RUB',
    products: normalizedProducts,
  };

  if (missingTariffs.length > 0) {
    return Object.freeze({
      ...base,
      status: QUOTE_STATUS.CONFIGURATION_REQUIRED,
      statusText: CONFIGURATION_REQUIRED_TEXT,
      products: Object.freeze(normalizedProducts.map((product) => Object.freeze({ ...product, subtotal: null }))),
      missingTariffs: Object.freeze(missingTariffs),
      lineItems: Object.freeze([]),
      subtotal: null,
      tax: Object.freeze({ mode: config.vat?.mode ?? 'off', ratePercent: config.vat?.ratePercent ?? 0, amount: null }),
      total: null,
    });
  }

  return buildPricedQuote(base, normalizedProducts, config);
}

function normalizeProduct(product, config, index) {
  assertRecord(product, `Product №${index + 1} is missing.`, `products.${index}`);
  const field = (name) => `products.${index}.${name}`;
  requireString(product.id, 'Enter a product identifier.', field('id'));
  const options = getAvailableOptions({ type: product.type, purpose: product.purpose });
  if (!options.shapes.includes(product.shape)) {
    throw new DomainValidationError('Selected shape is unavailable for this product.', field('shape'), 'INCOMPATIBLE_OPTION');
  }
  if (!options.positions.includes(product.position)) {
    throw new DomainValidationError('Select a valid product position.', field('position'), 'INCOMPATIBLE_OPTION');
  }
  if (!options.materials.includes(product.material)) {
    throw new DomainValidationError('Select the product material.', field('material'), 'INCOMPATIBLE_OPTION');
  }
  if (Array.isArray(config.availableOptions?.materials) && !config.availableOptions.materials.includes(product.material)) {
    throw new DomainValidationError('Selected material is currently unavailable.', field('material'), 'OPTION_DISABLED');
  }
  const hasSideHardware = product.hardwareBySide && typeof product.hardwareBySide === 'object' && !Array.isArray(product.hardwareBySide);
  if (hasSideHardware) {
    const compatible = options.hardware.filter((hardware) => SIDE_HARDWARE.includes(hardware));
    const configured = Array.isArray(config.availableOptions?.hardware) ? config.availableOptions.hardware : compatible;
    for (const [sideId, selected] of Object.entries(product.hardwareBySide)) {
      if (!Array.isArray(selected)) throw new DomainValidationError('Side hardware must be a list.', field(`hardwareBySide.${sideId}`), 'INVALID_VALUE');
      for (const hardware of selected) {
        if (!compatible.includes(hardware)) throw new DomainValidationError('Selected hardware is incompatible with this product.', field(`hardwareBySide.${sideId}`), 'INCOMPATIBLE_OPTION');
        if (!configured.includes(hardware)) throw new DomainValidationError('Selected hardware is currently unavailable.', field(`hardwareBySide.${sideId}`), 'OPTION_DISABLED');
      }
    }
  } else {
    if (!options.hardware.includes(product.hardware)) {
      throw new DomainValidationError('Selected hardware is incompatible with this product.', field('hardware'), 'INCOMPATIBLE_OPTION');
    }
    if (Array.isArray(config.availableOptions?.hardware) && !config.availableOptions.hardware.includes(product.hardware)) {
      throw new DomainValidationError('Selected hardware is currently unavailable.', field('hardware'), 'OPTION_DISABLED');
    }
  }
  if (!product.installation || !options.installationModes.includes(product.installation.mode)) {
    throw new DomainValidationError('Select a valid installation mode.', field('installation.mode'), 'INCOMPATIBLE_OPTION');
  }
  if (product.type === 'door' && !options.zipperModes.includes(product.zipperMode)) {
    throw new DomainValidationError('Select the door zipper layout.', field('zipperMode'), 'REQUIRED');
  }
  const border = normalizeBorder(product.border, config.ranges?.borderWidthCm, field('border'));
  const extras = normalizeExtras(product.extras, options, config, field('extras'));

  const geometry = buildGeometry({
    ...product,
    dimensionLimits: config.ranges?.dimensions,
    installation: { ...product.installation, hardware: product.hardware, hardwareBySide: product.hardwareBySide },
  });
  return Object.freeze({
    ...product,
    dimensions: Object.freeze({ ...product.dimensions }),
    installation: Object.freeze({ ...product.installation }),
    ...(hasSideHardware ? { hardwareBySide: Object.freeze(Object.fromEntries(Object.entries(product.hardwareBySide).map(([sideId, selected]) => [sideId, Object.freeze([...new Set(selected)])]))) } : {}),
    border,
    extras: Object.freeze({
      weightBar: hasSideHardware ? false : product.hardware === 'weight-bar',
      flashing: false,
      ...extras,
      ...(!hasSideHardware && product.hardware === 'weight-bar' ? { weightBar: true } : {}),
    }),
    geometry,
  });
}

function findMissingTariffs(products, config) {
  const missing = new Set();
  for (const product of products) {
    requirePositiveTariff(config, `materials.${product.material}`, missing);
    for (const hardware of Object.keys(product.geometry.fasteners.byHardware)) {
      requirePositiveTariff(config, `hardware.${hardware}`, missing);
    }
    if (product.type === 'door') requirePositiveTariff(config, 'zipperPerMeter', missing);
    if (product.extras.weightBar) requirePositiveTariff(config, 'weightBarPerMeter', missing);
    if (product.extras.flashing) requirePositiveTariff(config, 'flashingPerMeter', missing);
    if (product.extras.hookStrapKits > 0) requirePositiveTariff(config, 'hardware.hook-strap-kit', missing);
  }
  if (['additive', 'included'].includes(config.vat?.mode)) {
    const rate = Number(config.vat?.ratePercent);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) missing.add('vat.ratePercent');
  }
  return [...missing].sort();
}

function buildPricedQuote(base, products, config) {
  const lineItems = [];
  const pricedProducts = [];
  for (const product of products) {
    const productLines = buildProductLines(product, config);
    lineItems.push(...productLines);
    pricedProducts.push(Object.freeze({
      ...product,
      subtotal: roundMoney(productLines.reduce((sum, line) => sum + line.amount, 0), config.currency),
    }));
  }
  const subtotal = roundMoney(lineItems.reduce((sum, line) => sum + line.amount, 0), config.currency);
  const tax = calculateTax(subtotal, config.vat, config.currency);
  if (tax.amount > 0) {
    lineItems.push(Object.freeze({
      id: 'vat',
      productId: null,
      component: 'vat',
      label: 'VAT',
      quantity: tax.ratePercent,
      unit: 'percent',
      unitPrice: null,
      amount: tax.amount,
      included: tax.mode === 'included',
    }));
  }
  const total = tax.mode === 'additive' ? roundMoney(subtotal + tax.amount, config.currency) : subtotal;
  return Object.freeze({
    ...base,
    products: Object.freeze(pricedProducts),
    status: QUOTE_STATUS.READY,
    statusText: null,
    missingTariffs: Object.freeze([]),
    lineItems: Object.freeze(lineItems),
    subtotal,
    tax: Object.freeze(tax),
    total,
  });
}

function buildProductLines(product, config) {
  const lines = [];
  addLine(lines, product, 'material', 'Material including edging', product.geometry.areaM2, 'm2', tariff(config, `materials.${product.material}`), {}, config.currency);

  for (const [hardware, count] of Object.entries(product.geometry.fasteners.byHardware)) {
    addLine(lines, product, 'fastener', `Fasteners - ${HARDWARE_LABELS[hardware] ?? hardware}`, count, 'piece', tariff(config, `hardware.${hardware}`), { option: hardware }, config.currency);
  }
  if (product.type === 'door') {
    addLine(lines, product, 'zipper', 'Zipper', zipperLength(product), 'm', tariff(config, 'zipperPerMeter'), {}, config.currency);
  }
  if (product.extras.weightBar) {
    addLine(lines, product, 'weight-bar', 'Weight bar', sideLength(product, 'bottom'), 'm', tariff(config, 'weightBarPerMeter'), {}, config.currency);
  }
  if (product.extras.flashing) {
    addLine(lines, product, 'flashing', 'Bottom flashing, 20 cm', sideLength(product, 'bottom'), 'm', tariff(config, 'flashingPerMeter'), {}, config.currency);
  }
  if (product.extras.hookStrapKits > 0) {
    addLine(lines, product, 'hook-strap-kit', 'Hook and strap', product.extras.hookStrapKits, 'kit', tariff(config, 'hardware.hook-strap-kit'), {}, config.currency);
  }

  const surchargeBase = lines.reduce((sum, line) => sum + line.amount, 0);
  for (const surcharge of [
    config.tariffs?.surcharges?.shapes?.[product.shape],
    config.tariffs?.surcharges?.products?.[product.type],
  ]) {
    if (!surcharge) continue;
    const amount = surcharge.type === 'percent'
      ? roundMoney(surchargeBase * Number(surcharge.value) / 100, config.currency)
      : roundMoney(Number(surcharge.value), config.currency);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new DomainValidationError('Surcharge must be a nonnegative number.', 'tariffs.surcharges', 'INVALID_CONFIG');
    }
    lines.push(Object.freeze({
      id: `${product.id}:surcharge:${lines.length + 1}`,
      productId: product.id,
      component: 'surcharge',
      label: surcharge.label ?? 'Surcharge',
      quantity: Number(surcharge.value),
      unit: surcharge.type === 'percent' ? 'percent' : 'fixed',
      unitPrice: surcharge.type === 'percent' ? surchargeBase : null,
      amount,
    }));
  }
  return lines;
}

function addLine(target, product, component, label, quantity, unit, unitPrice, extra = {}, currency = 'RUB') {
  target.push(Object.freeze({
    id: `${product.id}:${component}:${target.length + 1}`,
    productId: product.id,
    component,
    label,
    quantity: roundDecimal(quantity, 4),
    unit,
    unitPrice,
    amount: roundMoney(quantity * unitPrice, currency),
    ...extra,
  }));
}

function sideLength(product, role) {
  return product.geometry.sides
    .filter((side) => side.role === role)
    .reduce((sum, side) => sum + side.lengthCm / 100, 0);
}

function zipperLength(product) {
  const heightM = Number(product.dimensions?.height) / 100;
  return heightM * (product.zipperMode === 'both-sides' ? 2 : 1);
}

function calculateTax(subtotal, vat = {}, currency = 'RUB') {
  const mode = vat.mode ?? 'off';
  const ratePercent = mode === 'off' ? 0 : Number(vat.ratePercent);
  if (mode === 'additive') return { mode, ratePercent, amount: roundMoney(subtotal * ratePercent / 100, currency) };
  if (mode === 'included') return { mode, ratePercent, amount: roundMoney(subtotal * ratePercent / (100 + ratePercent), currency) };
  if (mode === 'off') return { mode, ratePercent: 0, amount: 0 };
  throw new DomainValidationError('VAT mode must be off, additive or included.', 'vat.mode', 'INVALID_CONFIG');
}

function validateProductLimits(products) {
  const windows = products.filter(({ type }) => type === 'window').length;
  const doors = products.filter(({ type }) => type === 'door').length;
  if (windows > 10) throw new DomainValidationError('A quote may contain at most 10 windows.', 'products', 'LIMIT_EXCEEDED');
  if (doors > 2) throw new DomainValidationError('A quote may contain at most 2 doors.', 'products', 'LIMIT_EXCEEDED');
}

function normalizeBorder(border, configuredRange, field) {
  assertRecord(border, 'Complete the edging options.', field);
  const range = { ...BORDER_WIDTH_RANGE_CM, ...(configuredRange ?? {}) };
  const width = Number(border.widthCm);
  if (!Number.isFinite(width) || width < range.min || width > range.max) {
    throw new DomainValidationError(`Edging width must be between ${range.min} and ${range.max} cm.`, `${field}.widthCm`, 'OUT_OF_RANGE');
  }
  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value ?? '');
  let normalizedColor = border.color;
  let colorPreset;
  if (border.color === 'custom') {
    if (!isHex(border.customColor)) {
      throw new DomainValidationError('Enter a valid custom color value.', `${field}.customColor`, 'INVALID_COLOR');
    }
    normalizedColor = border.customColor;
    colorPreset = 'custom';
  } else if (isHex(border.color)) {
    colorPreset = 'custom';
  } else if (!BORDER_COLORS.includes(border.color) || border.color === 'custom') {
    throw new DomainValidationError('Select a valid edging color.', `${field}.color`, 'INVALID_COLOR');
  }
  if (border.widthsBySide) {
    for (const [side, value] of Object.entries(border.widthsBySide)) {
      const sideWidth = Number(value);
      if (!Number.isFinite(sideWidth) || sideWidth < range.min || sideWidth > range.max) {
        throw new DomainValidationError(`Side edging width «${side}» must be between ${range.min} and ${range.max} cm.`, `${field}.widthsBySide.${side}`, 'OUT_OF_RANGE');
      }
    }
  }
  const normalized = { ...border, color: normalizedColor };
  delete normalized.customColor;
  if (colorPreset) normalized.colorPreset = colorPreset;
  return Object.freeze(normalized);
}

function requirePositiveTariff(config, path, missing) {
  const value = tariff(config, path);
  if (!Number.isFinite(value) || value <= 0) missing.add(path);
}

function tariff(config, path) {
  return path.split('.').reduce((value, key) => value?.[key], config.tariffs);
}

function requireString(value, message, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new DomainValidationError(message, field, 'REQUIRED');
}

function assertRecord(value, message, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainValidationError(message, field, 'REQUIRED');
}

function normalizeExtras(extras, options, config, field) {
  const value = extras && typeof extras === 'object' && !Array.isArray(extras) ? extras : {};
  const quantity = Number(value.hookStrapKits ?? 0);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity === 1 || quantity > 1000) {
    throw new DomainValidationError('Hook and strap kits require a minimum of 2 kits.', `${field}.hookStrapKits`, 'OUT_OF_RANGE');
  }
  if (quantity > 0) {
    const configured = Array.isArray(config.availableOptions?.hardware) ? config.availableOptions.hardware : options.hardware;
    if (!options.hardware.includes('hook-strap-kit') || !configured.includes('hook-strap-kit')) {
      throw new DomainValidationError('Hook and strap kit is currently unavailable.', `${field}.hookStrapKits`, 'OPTION_DISABLED');
    }
  }
  return { weightBar: false, flashing: false, ...value, hookStrapKits: quantity };
}

function roundMoney(value, currency = 'RUB') {
  const factor = currency === 'RUB' ? 1 : 100;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function roundDecimal(value, precision) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
