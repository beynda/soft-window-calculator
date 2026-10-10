import { DomainValidationError } from '../shared/errors.js';
import { HARDWARE, MATERIALS } from '../shared/constants.js';

const WINDOW_SHAPES = [
  { id: 'rectangle', name: 'Rectangle', dimensions: ['width', 'height'] },
  { id: 'trapezoid-right', name: 'Trapezoid, right slope', dimensions: ['width', 'height', 'wallHeight'] },
  { id: 'trapezoid-left', name: 'Trapezoid, left slope', dimensions: ['width', 'height', 'wallHeight'] },
  { id: 'trapezoid-both', name: 'Trapezoid, two slopes', dimensions: ['width', 'height', 'leftWallHeight', 'rightWallHeight'] },
  { id: 'triangle-left', name: 'Right triangle, right angle on the left', dimensions: ['width', 'height'] },
  { id: 'triangle-right', name: 'Right triangle, right angle on the right', dimensions: ['width', 'height'] },
  { id: 'hexagon-peak', name: 'Hexagon with ridge', dimensions: ['width', 'height', 'wallHeight', 'ridgeWidth'] },
  { id: 't-shape', name: 'T-shaped', dimensions: ['width', 'height', 'stemWidth', 'crossbarHeight'] },
  { id: 'octagon', name: 'Octagon', dimensions: ['width', 'height', 'cutSize'] },
].map((shape) => Object.freeze({ ...shape, productType: 'window', dimensions: Object.freeze(shape.dimensions) }));

const DOOR_SHAPES = [
  Object.freeze({
    id: 'rectangle',
    name: 'Rectangular door',
    productType: 'door',
    dimensions: Object.freeze(['width', 'height']),
  }),
];

const SHAPES = Object.freeze({
  window: Object.freeze(WINDOW_SHAPES),
  door: Object.freeze(DOOR_SHAPES),
});

const WINDOW_INSTALLATION_MODES = Object.freeze(['none', 'top', 'top-sides', 'top-bottom', 'all']);
const DOOR_INSTALLATION_MODES = Object.freeze(['top', 'top-bottom']);
const BASE_HARDWARE = Object.freeze(HARDWARE.slice(0, 4));

export function listShapes(productType) {
  assertProductType(productType);
  return SHAPES[productType];
}

export function getShape(productType, shapeId) {
  assertProductType(productType);
  const shape = SHAPES[productType].find(({ id }) => id === shapeId);
  if (!shape) {
    const noun = productType === 'door' ? 'door' : 'window';
    throw new DomainValidationError(`Shape «${shapeId}» is unavailable for ${noun}.`, 'shape', 'INCOMPATIBLE_SHAPE');
  }
  return shape;
}

export function getAvailableOptions(product) {
  if (!product || typeof product !== 'object') {
    throw new DomainValidationError('Product type is missing.', 'type', 'REQUIRED');
  }
  assertProductType(product.type);

  const isDoor = product.type === 'door';
  const purpose = isDoor ? 'opening' : product.purpose;
  if (!isDoor && !['opening', 'fixed'].includes(purpose)) {
    throw new DomainValidationError('Select an opening or fixed window.', 'purpose', 'REQUIRED');
  }

  return Object.freeze({
    shapes: freezeList(SHAPES[product.type].map(({ id }) => id)),
    materials: freezeList(MATERIALS),
    purposes: freezeList(isDoor ? [] : ['opening', 'fixed']),
    hardware: freezeList(purpose === 'fixed' ? BASE_HARDWARE : HARDWARE),
    installationModes: freezeList(isDoor ? DOOR_INSTALLATION_MODES : WINDOW_INSTALLATION_MODES),
    zipperModes: freezeList(isDoor ? ['center', 'both-sides'] : []),
    positions: freezeList(isDoor ? ['left', 'right'] : ['right', 'left', 'top', 'bottom', 'extension-45']),
  });
}

function freezeList(values) {
  return Object.freeze([...values]);
}

function assertProductType(productType) {
  if (!Object.hasOwn(SHAPES, productType)) {
    throw new DomainValidationError('Product type must be window or door.', 'type', 'INVALID_PRODUCT_TYPE');
  }
}
