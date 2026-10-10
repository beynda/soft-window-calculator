
const STORAGE_KEY = 'beynda-soft-window-calculator-draft';
const SCHEMA_VERSION = 1;

export function loadDraft(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!isValidDraft(draft)) throw new TypeError('Unsupported draft schema');
    return cloneTechnicalDraft(draft);
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // An unavailable storage backend is equivalent to having no draft.
    }
    return null;
  }
}

export function saveDraft(draft, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    const technicalDraft = cloneTechnicalDraft(draft);
    if (!isValidDraft(technicalDraft)) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(technicalDraft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function cloneTechnicalDraft(draft) {
  return JSON.parse(JSON.stringify({
    version: draft?.version,
    activeProductId: draft?.activeProductId,
    updatedAt: draft?.updatedAt,
    products: Array.isArray(draft?.products) ? draft.products.map(sanitizeProduct) : draft?.products,
  }));
}

function sanitizeProduct(product) {
  const dimensions = pick(product?.dimensions, ['width', 'height', 'wallHeight', 'leftWallHeight', 'rightWallHeight', 'ridgeWidth', 'stemWidth', 'crossbarHeight', 'cutSize']);
  const installation = pick(product?.installation, ['mode', 'edgeOffsetCm', 'spacingCm', 'replaceTopWithGrommets']);
  const border = pick(product?.border, ['widthCm', 'color', 'customColor', 'perSide']);
  if (product?.border?.widthsBySide && typeof product.border.widthsBySide === 'object') {
    border.widthsBySide = Object.fromEntries(Object.entries(product.border.widthsBySide)
      .filter(([sideId, value]) => /^[a-z]+-\d+$/.test(sideId) && Number.isFinite(Number(value)))
      .map(([sideId, value]) => [sideId, value]));
  }
  const hardwareBySide = product?.hardwareBySide && typeof product.hardwareBySide === 'object' && !Array.isArray(product.hardwareBySide)
    ? Object.fromEntries(Object.entries(product.hardwareBySide)
      .filter(([sideId, selected]) => /^[a-z]+-\d+$/.test(sideId) && Array.isArray(selected))
      .map(([sideId, selected]) => [sideId, [...new Set(selected.filter((hardware) => [
        'grommet', 'plastic-turn-button', 'metal-turn-button', 'black-metal-turn-button', 'strap-bracket-45',
      ].includes(hardware)))]]))
    : null;
  const zipperMode = product?.type === 'door'
    ? (['center', 'both-sides'].includes(product?.zipperMode) ? product.zipperMode : 'center')
    : undefined;
  return {
    ...pick(product, ['id', 'type', 'shape', 'position', 'material', 'purpose', 'hardware']),
    ...(zipperMode ? { zipperMode } : {}),
    ...(Object.keys(dimensions).length ? { dimensions } : {}),
    ...(Object.keys(installation).length ? { installation } : {}),
    ...(hardwareBySide && Object.keys(hardwareBySide).length ? { hardwareBySide } : {}),
    ...(Object.keys(border).length ? { border } : {}),
    ...(product?.extras ? { extras: pick(product.extras, ['weightBar', 'flashing', 'hookStrapKits']) } : {}),
  };
}

function pick(source, keys) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function isValidDraft(draft) {
  return draft?.version === SCHEMA_VERSION
    && typeof draft.activeProductId === 'string'
    && typeof draft.updatedAt === 'string'
    && !Number.isNaN(Date.parse(draft.updatedAt))
    && Array.isArray(draft.products)
    && draft.products.length > 0
    && draft.products.every((product) => product && typeof product === 'object'
      && typeof product.id === 'string'
      && ['window', 'door'].includes(product.type));
}
