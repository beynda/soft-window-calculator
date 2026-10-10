export const PRODUCT_TYPES = Object.freeze(['window', 'door']);

export const MATERIALS = Object.freeze([
  'clear-pvc-700',
  'tinted-pvc-700',
  'none',
]);

export const HARDWARE = Object.freeze([
  'grommet',
  'plastic-turn-button',
  'metal-turn-button',
  'black-metal-turn-button',
  'strap-bracket-45',
  'hook-strap-kit',
  'weight-bar',
]);

export const SIDE_HARDWARE = Object.freeze(HARDWARE.filter((hardware) => !['hook-strap-kit', 'weight-bar'].includes(hardware)));

export const BORDER_COLORS = Object.freeze(['white', 'brown', 'gray', 'custom']);
export const FASTENER_SPACING_CM = Object.freeze([20, 30, 40]);
export const EDGE_OFFSET_RANGE_CM = Object.freeze({ min: 3, max: 15 });
export const BORDER_WIDTH_RANGE_CM = Object.freeze({ min: 7, max: 15 });

export const QUOTE_STATUS = Object.freeze({
  READY: 'ready',
  CONFIGURATION_REQUIRED: 'configuration-required',
});

export const CONFIGURATION_REQUIRED_TEXT = 'Pricing requires configuration';
