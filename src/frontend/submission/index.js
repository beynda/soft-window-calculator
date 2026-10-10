import { t, msg } from '../../shared/presentation.js';
const DEFAULT_ENDPOINT = '/api/quote';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export class SubmissionError extends Error {
  constructor(message, { code = 'SUBMISSION_FAILED', status = 0, fieldErrors = {}, retryable = false } = {}) {
    super(message);
    this.name = 'SubmissionError';
    this.code = code;
    this.status = status;
    this.fieldErrors = Object.freeze({ ...fieldErrors });
    this.retryable = retryable;
  }
}

export function validateContact(input) {
  const contact = input && typeof input === 'object' ? input : {};
  const normalized = {
    name: typeof contact.name === 'string' ? contact.name.trim() : '',
    phone: typeof contact.phone === 'string' ? contact.phone.trim() : '',
    email: typeof contact.email === 'string' ? contact.email.trim() : '',
  };
  const errors = {};
  if (normalized.name.length < 2 || normalized.name.length > 120 || /[\x00-\x1f\x7f]/.test(normalized.name)) {
    errors.name = t('Enter your full name.');
  }
  const digits = normalized.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15 || !/^[+()\-\s\d]+$/.test(normalized.phone)) {
    errors.phone = t('Enter a valid phone number.');
  }
  if (normalized.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.email = 'Enter a valid e-mail.';
  }
  if (Object.keys(errors).length > 0) {
    throw new SubmissionError(t('Check contact details.'), { code: 'INVALID_CONTACT', fieldErrors: errors });
  }
  return Object.freeze(normalized);
}

export function createIdempotencyKey(uuid = () => globalThis.crypto?.randomUUID?.()) {
  const key = uuid();
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
    throw new SubmissionError(t('Could not prepare a secure submission.'), { code: 'IDEMPOTENCY_UNAVAILABLE' });
  }
  return key;
}

export async function submitQuote(input, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new SubmissionError(t('Submission is unavailable.'), { code: 'FETCH_UNAVAILABLE', retryable: true });
  }
  if (!input?.project || typeof input.project !== 'object' || Array.isArray(input.project)) {
    throw new SubmissionError(t('Quote is missing.'), { code: 'INVALID_PROJECT' });
  }
  const contact = validateContact(input.contact);
  if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new SubmissionError(t('Invalid idempotency key.'), { code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  const payload = {
    version: 1,
    project: projectForSubmission(input.project),
    contact,
    honeypot: typeof input.honeypot === 'string' ? input.honeypot : '',
  };

  let response;
  try {
    response = await fetchImpl(dependencies.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: dependencies.signal,
    });
  } catch (cause) {
    throw new SubmissionError(t('The quote could not be sent. Your data is saved: you can download PDF or retry submission.'), {
      code: 'NETWORK_ERROR', retryable: true,
    }, { cause });
  }

  const data = await readJson(response);
  if (!response.ok || data?.ok !== true) {
    throw new SubmissionError(
      typeof data?.message === 'string' ? data.message : t('Submission failed. The form and PDF remain available.'),
      {
        code: typeof data?.code === 'string' ? data.code : 'HTTP_ERROR',
        status: response.status,
        fieldErrors: data?.fieldErrors,
        retryable: response.status === 429 || response.status >= 500,
      },
    );
  }
  return Object.freeze(data);
}

export function projectForSubmission(project) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.products)) {
    throw new SubmissionError(t('Quote is missing.'), { code: 'INVALID_PROJECT' });
  }
  return {
    version: 1,
    ...(project.presentation ? { presentation: project.presentation } : {}),
    products: project.products.map((product) => compact({
      ...pick(product, ['id', 'type', 'shape', 'position', 'material', 'purpose', 'hardware', 'zipperMode']),
      ...(recordOrNull(product?.hardwareBySide) ? { hardwareBySide: Object.fromEntries(Object.entries(product.hardwareBySide).map(([sideId, selected]) => [sideId, Array.isArray(selected) ? [...selected] : []])) } : {}),
      dimensions: pick(product?.dimensions, ['width', 'height', 'wallHeight', 'leftWallHeight', 'rightWallHeight', 'ridgeWidth', 'stemWidth', 'crossbarHeight', 'cutSize']),
      installation: pick(product?.installation, ['mode', 'edgeOffsetCm', 'spacingCm', 'replaceTopWithGrommets']),
      border: {
        ...pick(product?.border, ['widthCm', 'color', 'customColor', 'perSide']),
        ...(recordOrNull(product?.border?.widthsBySide) ? { widthsBySide: { ...product.border.widthsBySide } } : {}),
        ...(recordOrNull(product?.border?.segmentWidths) ? { segmentWidths: { ...product.border.segmentWidths } } : {}),
      },
      extras: pick(product?.extras, ['weightBar', 'flashing', 'hookStrapKits']),
    })),
  };
}

export function mountQuoteSubmission(form, options = {}) {
  if (!form || typeof form.addEventListener !== 'function' || typeof options.getProject !== 'function') {
    throw new TypeError('mountQuoteSubmission requires a form and getProject().');
  }
  let idempotencyKey = null;
  let submitting = false;
  const submitButton = form.querySelector?.('[type="submit"]') ?? null;
  const status = form.querySelector?.('[data-submission-status]') ?? null;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (options.overrideSubmit?.(event)) return;
    if (submitting) return;
    clearFieldErrors(form);
    submitting = true;
    if (submitButton) submitButton.disabled = true;
    if (status) status.textContent = t('Submitting quote…');
    try {
      idempotencyKey ??= createIdempotencyKey(options.uuid);
      const result = await submitQuote({
        project: options.getProject(),
        contact: readContact(form),
        honeypot: fieldValue(form, 'website'),
        idempotencyKey,
      }, options);
      idempotencyKey = null;
      if (status) status.textContent = msg`Quote ${result.quoteNumber} submitted.`;
      options.onSuccess?.(result);
    } catch (error) {
      const failure = error instanceof SubmissionError
        ? error
        : new SubmissionError(t('Submission failed. The form and PDF remain available.'), { retryable: true });
      applyFieldErrors(form, failure.fieldErrors);
      if (status) status.textContent = failure.message;
      options.onError?.(failure);
    } finally {
      submitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  };
  form.addEventListener('submit', onSubmit);
  return Object.freeze({
    destroy() { form.removeEventListener?.('submit', onSubmit); },
    isSubmitting() { return submitting; },
  });
}

export function decodeQuotePdf(result) {
  if (!result || typeof result.pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.pdfBase64)) {
    throw new SubmissionError(t('The server did not return PDF.'), { code: 'INVALID_PDF_RESPONSE' });
  }
  const binary = globalThis.atob
    ? globalThis.atob(result.pdfBase64)
    : Buffer.from(result.pdfBase64, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readContact(form) {
  return {
    name: fieldValue(form, 'name'),
    phone: fieldValue(form, 'phone'),
    email: fieldValue(form, 'email'),
  };
}

function fieldValue(form, name) {
  const value = form.elements?.namedItem?.(name)?.value;
  return typeof value === 'string' ? value : '';
}

function clearFieldErrors(form) {
  for (const name of ['name', 'phone', 'email']) form.elements?.namedItem?.(name)?.setCustomValidity?.('');
}

function applyFieldErrors(form, errors) {
  let first = null;
  for (const [name, message] of Object.entries(errors ?? {})) {
    const field = form.elements?.namedItem?.(name);
    field?.setCustomValidity?.(message);
    first ??= field;
  }
  first?.focus?.();
}

function pick(source, keys) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function recordOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
