import assert from 'node:assert/strict';
import test from 'node:test';

import * as domain from '../../src/domain/index.js';

test('domain barrel exposes the stable seams used by browser, PDF, and server code', () => {
  assert.deepEqual(
    Object.keys(domain).sort(),
    ['buildGeometry', 'calculateFasteners', 'calculateQuote', 'getAvailableOptions', 'getShape', 'listShapes'],
  );
});
