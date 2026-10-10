import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGeometry } from '../../src/domain/geometry.js';

const CASES = [
  ['rectangle', { width: 100, height: 80 }, 0.8],
  ['trapezoid-right', { width: 100, height: 80, wallHeight: 40 }, 0.6],
  ['trapezoid-left', { width: 100, height: 80, wallHeight: 40 }, 0.6],
  ['trapezoid-both', { width: 100, height: 80, leftWallHeight: 40, rightWallHeight: 60 }, 0.5],
  ['triangle-left', { width: 100, height: 80 }, 0.4],
  ['triangle-right', { width: 100, height: 80 }, 0.4],
  ['hexagon-peak', { width: 100, height: 80, wallHeight: 40, ridgeWidth: 20 }, 0.64],
  ['t-shape', { width: 100, height: 80, stemWidth: 40, crossbarHeight: 20 }, 0.44],
  ['octagon', { width: 100, height: 80, cutSize: 10 }, 0.78],
];

test('buildGeometry builds a closed polygon and metrics for all nine window shapes', () => {
  for (const [shape, dimensions, expectedAreaM2] of CASES) {
    const geometry = buildGeometry({
      type: 'window',
      shape,
      dimensions,
      installation: { mode: 'none', edgeOffsetCm: 5, spacingCm: 20 },
    });

    assert.deepEqual(geometry.polygon[0], geometry.polygon.at(-1), shape);
    assert.equal(geometry.sides.length, geometry.polygon.length - 1, shape);
    assert.equal(geometry.areaM2, expectedAreaM2, shape);
    assert.ok(geometry.perimeterM > 0, shape);
    assert.equal(geometry.fasteners.total, 0, shape);
  }
});

test('buildGeometry enforces boundary dimensions and product-specific installation rules', () => {
  assert.equal(buildGeometry({
    type: 'window',
    shape: 'rectangle',
    dimensions: { width: 20, height: 1500 },
    installation: { mode: 'none' },
  }).areaM2, 3);

  assert.throws(
    () => buildGeometry({ type: 'window', shape: 'rectangle', dimensions: { width: 19, height: 80 } }),
    (error) => error.field === 'dimensions.width' && /between 20 and 1500 cm/.test(error.message),
  );
  assert.throws(
    () => buildGeometry({ type: 'window', shape: 'trapezoid-right', dimensions: { width: 100, height: 80, wallHeight: 81 } }),
    (error) => error.field === 'dimensions.wallHeight' && /must be/.test(error.message),
  );
  assert.throws(
    () => buildGeometry({
      type: 'door',
      shape: 'rectangle',
      dimensions: { width: 100, height: 200 },
      installation: { mode: 'all', edgeOffsetCm: 5, spacingCm: 20 },
    }),
    (error) => error.field === 'installation.mode' && /door/.test(error.message),
  );
});

test('fasteners honor selected sides, offset, step, and top replacement without shared-corner duplicates', () => {
  const geometry = buildGeometry({
    type: 'window',
    shape: 'rectangle',
    dimensions: { width: 100, height: 100 },
    installation: {
      mode: 'all',
      edgeOffsetCm: 10,
      spacingCm: 30,
      hardware: 'plastic-turn-button',
      replaceTopWithGrommets: true,
    },
  });

  assert.equal(geometry.fasteners.total, 16);
  assert.deepEqual(geometry.fasteners.byHardware, {
    grommet: 4,
    'plastic-turn-button': 12,
  });
  assert.equal(new Set(geometry.fasteners.bySide.map(({ sideId }) => sideId)).size, 4);
  assert.throws(
    () => buildGeometry({
      type: 'window',
      shape: 'rectangle',
      dimensions: { width: 100, height: 100 },
      installation: { mode: 'top', edgeOffsetCm: 16, spacingCm: 20 },
    }),
    /between 3 and 15 cm/,
  );
});

test('automatic centering exposes exact positions without duplicate shared corners', () => {
  const geometry = buildGeometry({
    type: 'window',
    shape: 'rectangle',
    dimensions: { width: 100, height: 100 },
    hardware: 'grommet',
    installation: { mode: 'top-sides', edgeOffsetCm: 'auto', spacingCm: 40 },
  });

  assert.deepEqual(
    geometry.fasteners.positions.map(({ role, x, y }) => [role, x, y]),
    [
      ['top', 16.6667, 0],
      ['top', 50, 0],
      ['top', 83.3333, 0],
      ['right', 100, 16.6667],
      ['right', 100, 50],
      ['right', 100, 83.3333],
      ['left', 0, 83.3333],
      ['left', 0, 50],
      ['left', 0, 16.6667],
    ],
  );
  assert.equal(geometry.fasteners.total, geometry.fasteners.positions.length);
  assert.equal(
    new Set(geometry.fasteners.positions.map(({ x, y }) => `${x}:${y}`)).size,
    geometry.fasteners.positions.length,
  );
});

test('side hardware supports several fixture types with one shared spacing', () => {
  const geometry = buildGeometry({
    type: 'window',
    shape: 'rectangle',
    dimensions: { width: 120, height: 100 },
    hardwareBySide: {
      'top-1': ['grommet', 'plastic-turn-button'],
      'right-2': ['metal-turn-button'],
    },
    installation: { mode: 'all', edgeOffsetCm: 'auto', spacingCm: 30 },
  });

  assert.deepEqual(geometry.fasteners.byHardware, {
    grommet: 4,
    'plastic-turn-button': 4,
    'metal-turn-button': 4,
  });
  assert.equal(geometry.fasteners.total, 12);
  assert.deepEqual(
    geometry.fasteners.bySide.map(({ sideId, hardware, count }) => [sideId, hardware, count]),
    [
      ['top-1', 'grommet', 4],
      ['top-1', 'plastic-turn-button', 4],
      ['right-2', 'metal-turn-button', 4],
    ],
  );
  const topPositions = geometry.fasteners.positions.filter(({ sideId }) => sideId === 'top-1');
  assert.equal(new Set(topPositions.map(({ x, y }) => `${x}:${y}`)).size, 4);
  assert.ok(topPositions.every((position) => !('laneIndex' in position) && !('laneCount' in position)));
});

test('default size limit is fifteen metres', () => {
  assert.equal(buildGeometry({
    type: 'window',
    shape: 'rectangle',
    dimensions: { width: 1500, height: 1500 },
    installation: { mode: 'none' },
  }).areaM2, 225);

  assert.throws(
    () => buildGeometry({ type: 'window', shape: 'rectangle', dimensions: { width: 1501, height: 100 } }),
    (error) => error.field === 'dimensions.width' && /and 1500 cm/.test(error.message),
  );
});
