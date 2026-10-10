import { getAvailableOptions, getShape } from './catalog.js';
import { DomainValidationError } from '../shared/errors.js';
import { EDGE_OFFSET_RANGE_CM, FASTENER_SPACING_CM, SIDE_HARDWARE } from '../shared/constants.js';

const DEFAULT_LIMITS = Object.freeze({ min: 20, max: 1500, minSegment: 5 });
const PIECE_HARDWARE = SIDE_HARDWARE;

const BUILDERS = Object.freeze({
  rectangle: ({ width: w, height: h }) => ({
    points: [[0, 0], [w, 0], [w, h], [0, h]],
    roles: ['top', 'right', 'bottom', 'left'],
  }),
  'trapezoid-right': ({ width: w, height: h, wallHeight }) => ({
    points: [[0, 0], [w, h - wallHeight], [w, h], [0, h]],
    roles: ['top', 'right', 'bottom', 'left'],
  }),
  'trapezoid-left': ({ width: w, height: h, wallHeight }) => ({
    points: [[0, h - wallHeight], [w, 0], [w, h], [0, h]],
    roles: ['top', 'right', 'bottom', 'left'],
  }),
  'trapezoid-both': ({ width: w, height: h, leftWallHeight, rightWallHeight }) => ({
    points: [[0, h - leftWallHeight], [w, h - rightWallHeight], [w, h], [0, h]],
    roles: ['top', 'right', 'bottom', 'left'],
  }),
  'triangle-left': ({ width: w, height: h }) => ({
    points: [[0, 0], [w, h], [0, h]],
    roles: ['top', 'bottom', 'left'],
  }),
  'triangle-right': ({ width: w, height: h }) => ({
    points: [[w, 0], [w, h], [0, h]],
    roles: ['right', 'bottom', 'top'],
  }),
  'hexagon-peak': ({ width: w, height: h, wallHeight, ridgeWidth }) => ({
    points: [[0, h], [0, h - wallHeight], [(w - ridgeWidth) / 2, 0], [(w + ridgeWidth) / 2, 0], [w, h - wallHeight], [w, h]],
    roles: ['left', 'top', 'top', 'top', 'right', 'bottom'],
  }),
  't-shape': ({ width: w, height: h, stemWidth, crossbarHeight }) => {
    const left = (w - stemWidth) / 2;
    const right = left + stemWidth;
    return {
      points: [[0, 0], [w, 0], [w, crossbarHeight], [right, crossbarHeight], [right, h], [left, h], [left, crossbarHeight], [0, crossbarHeight]],
      roles: ['top', 'right', 'bottom', 'right', 'bottom', 'left', 'bottom', 'left'],
    };
  },
  octagon: ({ width: w, height: h, cutSize: c }) => ({
    points: [[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]],
    roles: ['top', 'top', 'right', 'right', 'bottom', 'bottom', 'left', 'left'],
  }),
});

export function buildGeometry(product) {
  if (!product || typeof product !== 'object') {
    throw new DomainValidationError('No product was provided for geometry construction.', null, 'REQUIRED');
  }
  const shape = getShape(product.type, product.shape);
  validateInstallationCompatibility(product);
  const dimensions = validateDimensions(shape, product.dimensions, product.dimensionLimits);
  const built = BUILDERS[shape.id](dimensions);
  const polygon = built.points.map(([x, y]) => Object.freeze({ x, y }));
  polygon.push(polygon[0]);

  const sides = built.roles.map((role, index) => {
    const start = polygon[index];
    const end = polygon[index + 1];
    const lengthCm = round(Math.hypot(end.x - start.x, end.y - start.y), 4);
    return Object.freeze({ id: `${role}-${index + 1}`, role, start, end, lengthCm });
  });
  const areaCm2 = Math.abs(shoelaceArea(built.points));
  if (areaCm2 <= 0) {
    throw new DomainValidationError('Dimensions produce a degenerate shape.', 'dimensions', 'DEGENERATE_GEOMETRY');
  }

  return Object.freeze({
    shape: shape.id,
    polygon: Object.freeze(polygon),
    sides: Object.freeze(sides),
    areaM2: round(areaCm2 / 10_000, 4),
    perimeterM: round(sides.reduce((sum, side) => sum + side.lengthCm, 0) / 100, 4),
    fasteners: calculateFasteners(sides, {
      ...product.installation,
      hardware: product.installation?.hardware ?? product.hardware,
      hardwareBySide: product.hardwareBySide,
    }),
  });
}

function validateInstallationCompatibility(product) {
  const mode = product.installation?.mode;
  if (mode === undefined) return;
  const options = getAvailableOptions({ type: product.type, purpose: product.purpose ?? 'opening' });
  if (!options.installationModes.includes(mode)) {
    const suffix = product.type === 'door' ? ' for a door' : '';
    throw new DomainValidationError(`An unsupported installation mode was selected${suffix}.`, 'installation.mode', 'INCOMPATIBLE_OPTION');
  }
}

export function calculateFasteners(sides, installation = {}) {
  if (installation.hardwareBySide !== undefined) {
    return calculateSideFasteners(sides, installation);
  }
  const mode = installation?.mode ?? 'none';
  if (mode === 'none' || installation.hardware === 'weight-bar') return emptyFasteners();
  const selectedRoles = rolesForMode(mode);
  const selectedSides = sides.filter(({ role }) => selectedRoles.has(role));
  const spacingCm = Number(installation.spacingCm);
  if (!FASTENER_SPACING_CM.includes(spacingCm)) {
    throw new DomainValidationError('Fastener spacing must be 20, 30 or 40 cm.', 'installation.spacingCm', 'OUT_OF_RANGE');
  }
  const automatic = installation.edgeOffsetCm === 'auto';
  const edgeOffsetCm = automatic ? null : Number(installation.edgeOffsetCm);
  if (!automatic && (!Number.isFinite(edgeOffsetCm) || edgeOffsetCm < EDGE_OFFSET_RANGE_CM.min || edgeOffsetCm > EDGE_OFFSET_RANGE_CM.max)) {
    throw new DomainValidationError('Fastener offset must be between 3 and 15 cm.', 'installation.edgeOffsetCm', 'OUT_OF_RANGE');
  }

  const bySide = selectedSides.map((side) => {
    const count = automatic
      ? Math.max(1, Math.ceil(side.lengthCm / spacingCm))
      : side.lengthCm < edgeOffsetCm * 2
        ? 0
        : Math.ceil((side.lengthCm - edgeOffsetCm * 2) / spacingCm) + 1;
    const hardware = installation.replaceTopWithGrommets && side.role === 'top'
      ? 'grommet'
      : installation.hardware;
    const distances = automatic
      ? centeredDistances(side.lengthCm, count)
      : offsetDistances(side.lengthCm, edgeOffsetCm, count);
    const positions = distances.map((distanceCm) => {
      const ratio = side.lengthCm === 0 ? 0 : distanceCm / side.lengthCm;
      return Object.freeze({
        sideId: side.id,
        role: side.role,
        hardware,
        distanceCm: round(distanceCm, 4),
        x: round(side.start.x + (side.end.x - side.start.x) * ratio, 4),
        y: round(side.start.y + (side.end.y - side.start.y) * ratio, 4),
      });
    });
    return Object.freeze({
      sideId: side.id,
      role: side.role,
      lengthCm: side.lengthCm,
      count: positions.length,
      hardware,
      positions: Object.freeze(positions),
    });
  });
  const uniquePositions = new Map();
  for (const side of bySide) {
    for (const position of side.positions) {
      const key = `${position.x}:${position.y}`;
      if (!uniquePositions.has(key)) uniquePositions.set(key, position);
    }
  }
  const positions = Object.freeze([...uniquePositions.values()]);
  const byHardware = {};
  for (const position of positions) {
    if (position.hardware) {
      byHardware[position.hardware] = (byHardware[position.hardware] ?? 0) + 1;
    }
  }
  return Object.freeze({
    total: positions.length,
    positions,
    bySide: Object.freeze(bySide),
    byHardware: Object.freeze(byHardware),
  });
}

function calculateSideFasteners(sides, installation) {
  const hardwareBySide = installation.hardwareBySide;
  if (!hardwareBySide || typeof hardwareBySide !== 'object' || Array.isArray(hardwareBySide)) {
    throw new DomainValidationError('Per-side hardware must be an object.', 'hardwareBySide', 'INVALID_VALUE');
  }
  const knownSides = new Set(sides.map(({ id }) => id));
  for (const sideId of Object.keys(hardwareBySide)) {
    if (!knownSides.has(sideId)) {
      throw new DomainValidationError('An unknown product side was selected.', `hardwareBySide.${sideId}`, 'INVALID_VALUE');
    }
  }
  const spacingCm = Number(installation.spacingCm);
  if (!FASTENER_SPACING_CM.includes(spacingCm)) {
    throw new DomainValidationError('Fastener spacing must be 20, 30 or 40 cm.', 'installation.spacingCm', 'OUT_OF_RANGE');
  }
  const automatic = installation.edgeOffsetCm === 'auto';
  const edgeOffsetCm = automatic ? null : Number(installation.edgeOffsetCm);
  if (!automatic && (!Number.isFinite(edgeOffsetCm) || edgeOffsetCm < EDGE_OFFSET_RANGE_CM.min || edgeOffsetCm > EDGE_OFFSET_RANGE_CM.max)) {
    throw new DomainValidationError('Fastener offset must be between 3 and 15 cm.', 'installation.edgeOffsetCm', 'OUT_OF_RANGE');
  }

  const bySide = [];
  const positions = [];
  const byHardware = {};
  for (const side of sides) {
    const selected = hardwareBySide[side.id] ?? [];
    if (!Array.isArray(selected) || selected.some((hardware) => !PIECE_HARDWARE.includes(hardware))) {
      throw new DomainValidationError('Unsupported hardware was selected for this side.', `hardwareBySide.${side.id}`, 'INCOMPATIBLE_OPTION');
    }
    const uniqueHardware = [...new Set(selected)];
    const count = automatic
      ? Math.max(1, Math.ceil(side.lengthCm / spacingCm))
      : side.lengthCm < edgeOffsetCm * 2
        ? 0
        : Math.ceil((side.lengthCm - edgeOffsetCm * 2) / spacingCm) + 1;
    const distances = automatic
      ? centeredDistances(side.lengthCm, count)
      : offsetDistances(side.lengthCm, edgeOffsetCm, count);
    uniqueHardware.forEach((hardware) => {
      const lanePositions = distances.map((distanceCm) => {
        const ratio = side.lengthCm === 0 ? 0 : distanceCm / side.lengthCm;
        return Object.freeze({
          sideId: side.id,
          role: side.role,
          hardware,
          distanceCm: round(distanceCm, 4),
          x: round(side.start.x + (side.end.x - side.start.x) * ratio, 4),
          y: round(side.start.y + (side.end.y - side.start.y) * ratio, 4),
        });
      });
      positions.push(...lanePositions);
      byHardware[hardware] = (byHardware[hardware] ?? 0) + lanePositions.length;
      bySide.push(Object.freeze({
        sideId: side.id,
        role: side.role,
        lengthCm: side.lengthCm,
        count: lanePositions.length,
        hardware,
        positions: Object.freeze(lanePositions),
      }));
    });
  }
  return Object.freeze({
    total: positions.length,
    positions: Object.freeze(positions),
    bySide: Object.freeze(bySide),
    byHardware: Object.freeze(byHardware),
  });
}

function emptyFasteners() {
  return Object.freeze({
    total: 0,
    positions: Object.freeze([]),
    bySide: Object.freeze([]),
    byHardware: Object.freeze({}),
  });
}

function centeredDistances(lengthCm, count) {
  const interval = lengthCm / count;
  return Array.from({ length: count }, (_, index) => interval * (index + 0.5));
}

function offsetDistances(lengthCm, edgeOffsetCm, count) {
  if (count === 0) return [];
  if (count === 1) return [lengthCm / 2];
  const interval = (lengthCm - edgeOffsetCm * 2) / (count - 1);
  return Array.from({ length: count }, (_, index) => edgeOffsetCm + interval * index);
}

function validateDimensions(shape, input, customLimits) {
  if (!input || typeof input !== 'object') {
    throw new DomainValidationError('Enter product dimensions.', 'dimensions', 'REQUIRED');
  }
  const limits = { ...DEFAULT_LIMITS, ...(customLimits ?? {}) };
  const dimensions = {};
  for (const name of shape.dimensions) {
    const value = Number(input[name]);
    if (!Number.isFinite(value)) {
      throw new DomainValidationError(`Dimension «${name}» must be a number.`, `dimensions.${name}`, 'INVALID_NUMBER');
    }
    dimensions[name] = value;
  }
  for (const name of ['width', 'height']) {
    if (dimensions[name] < limits.min || dimensions[name] > limits.max) {
      throw new DomainValidationError(`Dimension «${name}» must be between ${limits.min} and ${limits.max} cm.`, `dimensions.${name}`, 'OUT_OF_RANGE');
    }
  }
  validateShapeDimensions(shape.id, dimensions, limits.minSegment);
  return dimensions;
}

function validateShapeDimensions(shapeId, d, minimum) {
  const requireBetween = (name, min, max) => {
    if (d[name] < min || d[name] > max) {
      throw new DomainValidationError(`Dimension «${name}» must be between ${min} and ${max} cm.`, `dimensions.${name}`, 'IMPOSSIBLE_GEOMETRY');
    }
  };
  if (['trapezoid-right', 'trapezoid-left'].includes(shapeId)) {
    requireBetween('wallHeight', minimum, d.height);
  } else if (shapeId === 'trapezoid-both') {
    requireBetween('leftWallHeight', minimum, d.height);
    requireBetween('rightWallHeight', minimum, d.height);
  } else if (shapeId === 'hexagon-peak') {
    requireBetween('wallHeight', minimum, d.height - minimum);
    requireBetween('ridgeWidth', minimum, d.width - minimum * 2);
  } else if (shapeId === 't-shape') {
    requireBetween('stemWidth', minimum, d.width - minimum * 2);
    requireBetween('crossbarHeight', minimum, d.height - minimum);
  } else if (shapeId === 'octagon') {
    requireBetween('cutSize', minimum, (Math.min(d.width, d.height) - minimum) / 2);
  }
}

function rolesForMode(mode) {
  const modes = {
    top: ['top'],
    'top-sides': ['top', 'left', 'right'],
    'top-bottom': ['top', 'bottom'],
    all: ['top', 'right', 'bottom', 'left'],
  };
  if (!Object.hasOwn(modes, mode)) {
    throw new DomainValidationError('An unsupported installation mode was selected.', 'installation.mode', 'INCOMPATIBLE_OPTION');
  }
  return new Set(modes[mode]);
}

function shoelaceArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
