import assert from 'node:assert/strict';
import test from 'node:test';

import { getAvailableOptions, getShape, listShapes } from '../../src/domain/catalog.js';

test('catalog exposes exactly nine window shapes and one rectangular door shape', () => {
  const windows = listShapes('window');
  const doors = listShapes('door');

  assert.equal(windows.length, 9);
  assert.equal(new Set(windows.map(({ id }) => id)).size, 9);
  assert.deepEqual(doors.map(({ id }) => id), ['rectangle']);
  assert.equal(getShape('window', 'hexagon-peak').name, 'Hexagon with ridge');
  assert.equal(getShape('door', 'rectangle').productType, 'door');
  assert.throws(() => getShape('door', 't-shape'), /is unavailable for door/i);
});

test('compatibility rules centralize purpose, hardware, installation, and zipper options', () => {
  const opening = getAvailableOptions({ type: 'window', purpose: 'opening' });
  const fixed = getAvailableOptions({ type: 'window', purpose: 'fixed' });
  const door = getAvailableOptions({ type: 'door' });

  assert.deepEqual(opening.materials, ['clear-pvc-700', 'tinted-pvc-700', 'none']);
  assert.ok(opening.hardware.includes('strap-bracket-45'));
  assert.ok(opening.hardware.includes('weight-bar'));
  assert.ok(!fixed.hardware.includes('strap-bracket-45'));
  assert.ok(!fixed.hardware.includes('weight-bar'));
  assert.deepEqual(door.installationModes, ['top', 'top-bottom']);
  assert.deepEqual(door.zipperModes, ['center', 'both-sides']);
  assert.deepEqual(opening.zipperModes, []);
  assert.throws(() => opening.hardware.push('unknown'), TypeError);
});
