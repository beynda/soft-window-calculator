import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SubmissionError,
  createIdempotencyKey,
  submitQuote,
  validateContact,
} from '../../../src/frontend/submission/index.js';

const project = Object.freeze({
  version: 1,
  products: [Object.freeze({ id: 'window-1', type: 'window' })],
});

test('validateContact accepts usable staff contact fields without consent', () => {
  assert.deepEqual(validateContact({
    name: '  Test User  ',
    phone: '+7 (000) 000-00-00',
    email: ' IVAN@example.test ',
  }), {
    name: 'Test User',
    phone: '+7 (000) 000-00-00',
    email: 'IVAN@example.test',
  });

  assert.throws(
    () => validateContact({ name: '', phone: '123', email: 'bad', consent: false }),
    (error) => error instanceof SubmissionError
      && error.code === 'INVALID_CONTACT'
      && Object.keys(error.fieldErrors).sort().join(',') === 'email,name,phone',
  );
});

test('submitQuote sends only project and ephemeral contact data in a POST body', async () => {
  const calls = [];
  const result = await submitQuote({
    project: {
      ...project,
      quote: { total: 1 },
      errors: { private: 'not transport data' },
      products: [{ ...project.products[0], subtotal: 1, availablePositions: ['right'] }],
    },
    contact: { name: 'Test', phone: '+7 000 000 00 00', email: 'ivan@example.test', consent: true },
    idempotencyKey: '86f97636-6647-4f35-b4b5-44bcb66d33fe',
    honeypot: '',
    quote: { total: 1 },
    pdf: 'untrusted',
  }, {
    endpoint: '/api/quote',
    fetch: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ ok: true, quoteNumber: 'Q-SERVER', pdfBase64: 'JVBERi0=' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.quoteNumber, 'Q-SERVER');
  assert.equal(calls[0][0], '/api/quote');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['Idempotency-Key'], '86f97636-6647-4f35-b4b5-44bcb66d33fe');
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(Object.keys(body).sort(), ['contact', 'honeypot', 'project', 'version']);
  assert.equal(JSON.stringify(body).includes('untrusted'), false);
  assert.equal(JSON.stringify(body).includes('"total":1'), false);
  assert.equal(JSON.stringify(body).includes('availablePositions'), false);
  assert.equal(JSON.stringify(body).includes('private'), false);
});

test('submitQuote reports a retryable English error without mutating form or project data', async () => {
  const contact = { name: 'Sample', phone: '+7 000 000 00 00', email: 'ivan@example.test', consent: true };
  const snapshot = structuredClone({ contact, project });

  await assert.rejects(
    submitQuote({
      project,
      contact,
      idempotencyKey: createIdempotencyKey(() => '123e4567-e89b-42d3-a456-426614174000'),
    }, {
      fetch: async () => { throw new TypeError('network down'); },
    }),
    (error) => error instanceof SubmissionError
      && error.retryable === true
      && /download PDF/.test(error.message),
  );

  assert.deepEqual({ contact, project }, snapshot);
});

test('idempotency keys are validated before any network request', async () => {
  let called = false;
  await assert.rejects(
    submitQuote({
      project,
      contact: { name: 'Test', phone: '+7 000 000 00 00', email: 'ivan@example.test', consent: true },
      idempotencyKey: 'not safe',
    }, { fetch: async () => { called = true; } }),
    (error) => error.code === 'INVALID_IDEMPOTENCY_KEY',
  );
  assert.equal(called, false);
});
