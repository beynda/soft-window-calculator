import { t, msg, getPresentation, setPresentation, marketConfig, normalizePresentation } from '../src/shared/presentation.js';
import { mountCalculator } from '../src/frontend/calculator/index.js';
import { downloadQuotePdf, isQuoteExportable, printQuote, renderQuoteSummary } from '../src/frontend/summary/index.js';
import { mountQuoteSubmission, validateContact, projectForSubmission, createIdempotencyKey } from '../src/frontend/submission/index.js';
import { mountQuoteArchive } from '../src/frontend/archive/index.js';

const DEFAULT_CONFIG_URL = new URL('../config/public.php', import.meta.url);
const DEFAULT_QUOTE_URL = new URL('../api/quote/', import.meta.url);
const DEFAULT_ARCHIVE_URL = new URL('../archive/', import.meta.url);

export async function startCalculator(host, dependencies = {}) {
  if (!host) throw new TypeError(t('Calculator container was not found.'));
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  let response;
  try {
    const configUrl = host.dataset.demo === 'true' ? new URL('../config/demo.json', import.meta.url) : DEFAULT_CONFIG_URL;
    response = await fetchImpl(dependencies.configUrl ?? configUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    host.innerHTML = t('<p class="wc-load-error" role="alert">The calculator is unavailable: configuration could not be loaded.</p>');
    return null;
  }

  const baseConfig = await response.json();
  const config = marketConfig(baseConfig, getPresentation().market);
  if (host.dataset.demo === 'true') return mountDemo(host, config, dependencies);
  host.innerHTML = t('<div data-calculator-ui></div>') + deliveryMarkup();
  const calculatorRoot = host.querySelector('[data-calculator-ui]');
  let editing = null;
  let saving = false;
  let retry = null;
  let savedSignature = '';
  const controller = mountCalculator(calculatorRoot, config, { ...dependencies.calculator, onReset() {
    editing = null; retry = null; savedSignature = '';
    archive.setActive('');
    sync();
  } });
  const summary = host.querySelector('[data-quote-summary]');
  const form = host.querySelector('[data-quote-form]');
  const printButton = host.querySelector('[data-public-action="print"]');
  const pdfButton = host.querySelector('[data-public-action="pdf"]');
  const submitButton = form.querySelector('[type="submit"]');
  const saveButton = form.querySelector('[data-edit-save]');
  const readiness = host.querySelector('[data-quote-readiness]');
  let syncQueued = false;

  const currentQuote = () => {
    const quote = controller.getState().quote;
    return quote && editing ? { ...quote, quoteNumber: editing.quoteNumber, createdAt: editing.quote.createdAt ?? editing.createdAt } : quote;
  };
  const currentProject = () => ({ version: 1, presentation: getPresentation(), products: controller.getState().products });
  const sync = () => {
    syncQueued = false;
    const quote = currentQuote();
    const ready = isQuoteExportable(quote);
    printButton.disabled = !ready;
    pdfButton.disabled = !ready;
    submitButton.disabled = !ready || saving;
    saveButton.hidden = !editing;
    saveButton.disabled = !ready || saving;
    form.querySelector('h3').textContent = editing ? t('Save quote') : t('Submit quote');
    submitButton.textContent = editing ? t('Save and submit') : t('Get quote');
    readiness.textContent = ready
      ? (editing ? msg`Editing ${editing.quoteNumber}. Current rates apply. Saving will replace the quote and PDF in the archive.` : t('Your quote is ready to print, save or submit.'))
      : t('Pricing must be configured by an administrator. Your draft and dimensions are saved locally.');
    summary.innerHTML = quote ? renderQuoteSummary(quote) : t('<p class="wc-summary-placeholder">Enter dimensions to see the summary.</p>');
  };
  const scheduleSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  for (const eventName of ['click', 'change', 'input']) calculatorRoot.addEventListener(eventName, scheduleSync);
  printButton.addEventListener('click', () => safeExport(() => printQuote(currentQuote()), readiness));
  pdfButton.addEventListener('click', () => safeExport(() => downloadQuotePdf(currentQuote()), readiness));
  const saveClick = () => { void saveEdited(false).then(() => archive.refresh()).catch(() => {}); };
  saveButton.addEventListener('click', saveClick);
  const submission = mountQuoteSubmission(form, {
    endpoint: dependencies.quoteUrl ?? DEFAULT_QUOTE_URL,
    fetch: fetchImpl,
    getProject: currentProject,
    uuid: dependencies.uuid,
    overrideSubmit() {
      if (!editing) return false;
      void saveEdited(true).then(() => archive.refresh()).catch(() => {});
      return true;
    },
    onSuccess(result) { void archive.refresh(); dependencies.onSubmissionSuccess?.(result); },
    onError: dependencies.onSubmissionError,
  });
  const archive = mountQuoteArchive(host.querySelector('[data-quote-archive]'), {
    endpoint: dependencies.archiveUrl ?? DEFAULT_ARCHIVE_URL,
    fetch: fetchImpl,
    async onEdit(record) {
      if (saving || submission.isSubmitting()) throw new Error(t('Wait for submission to finish.'));
      const confirm = dependencies.calculator?.confirm ?? globalThis.confirm;
      if (confirm && !confirm(t('Open the archived quote instead of the current draft? Unsaved changes will be replaced.'))) return false;
      controller.loadProject(record.project);
      editing = record;
      retry = null;
      for (const name of ['name', 'phone', 'email']) form.elements.namedItem(name).value = record.contact[name] ?? '';
      savedSignature = signature();
      form.querySelector('[data-submission-status]').textContent = '';
      sync();
      calculatorRoot.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return true;
    },
  });

  function contactValues() {
    return Object.fromEntries(['name', 'phone', 'email'].map((name) => {
      const field = form.elements.namedItem(name);
      return [name, field.value];
    }));
  }
  function signature() { return JSON.stringify([projectForSubmission(currentProject()), contactValues()]); }
  async function saveEdited(send) {
    if (!editing) throw new Error('First select «Edit» for the required quote.');
    if (saving) throw new Error(t('Save is already in progress.'));
    const status = form.querySelector('[data-submission-status]');
    try {
      if (!controller.validate()) throw new Error(t('Check dimensions and options.'));
      const payload = { version: 1, project: projectForSubmission(currentProject()), contact: validateContact(contactValues()), honeypot: form.elements.namedItem('website').value, quoteNumber: editing.quoteNumber, editToken: editing.editToken, send };
      const body = JSON.stringify(payload);
      if (!retry || retry.body !== body) retry = { body, key: createIdempotencyKey(dependencies.uuid) };
      saving = true;
      calculatorRoot.inert = true;
      form.inert = true;
      sync();
      status.textContent = send ? t('Saving and submitting…') : t('Saving…');
      const response = await fetchImpl(dependencies.archiveUrl ?? DEFAULT_ARCHIVE_URL, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': retry.key, 'X-CSRF-Token': editing.csrfToken ?? '' }, body });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.message ?? t('Save failed. Try again.'));
      editing.editToken = data.editToken;
      editing.quote = data.quote;
      savedSignature = signature();
      retry = null;
      status.textContent = send ? msg`Quote ${editing.quoteNumber} saved and submitted.` : msg`Quote ${editing.quoteNumber} saved.`;
      return data;
    } catch (error) {
      status.textContent = Object.values(error?.fieldErrors ?? {}).join(' ') || error?.message || t('Save failed. Try again.');
      if (error?.fieldErrors) form.elements.namedItem(Object.keys(error.fieldErrors)[0])?.focus();
      throw new Error(status.textContent);
    } finally { saving = false; calculatorRoot.inert = false; form.inert = false; sync(); }
  }
  const beforeUnload = (event) => {
    if (saving || (editing && signature() !== savedSignature)) { event.preventDefault(); event.returnValue = ''; }
  };
  globalThis.addEventListener?.('beforeunload', beforeUnload);
  sync();

  return Object.freeze({ controller, sync, destroy() {
    controller.destroy();
    submission.destroy();
    archive.destroy();
    saveButton.removeEventListener('click', saveClick);
    globalThis.removeEventListener?.('beforeunload', beforeUnload);
    for (const eventName of ['click', 'change', 'input']) calculatorRoot.removeEventListener(eventName, scheduleSync);
  } });
}

function mountDemo(host, config, dependencies) {
  host.innerHTML = '<div data-calculator-ui></div>' + msg`<section class="wc-delivery"><h2>Quote summary</h2><p>Calculate locally and download a PDF. No contact details required.</p><div class="wc-export"><button type="button" data-public-action="pdf">Download PDF</button><button type="button" data-public-action="print">Print</button></div><p data-demo-status role="status"></p><div class="wc-summary-host" data-quote-summary></div><p><a href="https://github.com/beynda/soft-window-calculator">Source code on GitHub</a> · <a href="https://beynda.com">Beynda</a></p></section>`;
  const calculator = host.querySelector('[data-calculator-ui]');
  const controller = mountCalculator(calculator, config, dependencies.calculator ?? {});
  const summary = host.querySelector('[data-quote-summary]');
  const status = host.querySelector('[data-demo-status]');
  const pdf = host.querySelector('[data-public-action="pdf"]');
  const print = host.querySelector('[data-public-action="print"]');
  const render = () => {
    const quote = controller.getState().quote;
    pdf.disabled = print.disabled = !isQuoteExportable(quote);
    summary.innerHTML = quote ? renderQuoteSummary(quote) : '';
  };
  for (const event of ['click', 'input', 'change']) calculator.addEventListener(event, () => queueMicrotask(render));
  pdf.addEventListener('click', () => safeExport(() => downloadQuotePdf(controller.getState().quote), status));
  print.addEventListener('click', () => safeExport(() => printQuote(controller.getState().quote), status));
  render();
  return controller;
}

function deliveryMarkup() {
  return msg`<section class="wc-delivery" aria-labelledby="wc-delivery-title">
    <header class="wc-delivery__head"><div><h2 id="wc-delivery-title">Quote summary and delivery</h2><p>Download PDF without submitting contact details, or send the quote to your email.</p></div><p data-quote-readiness role="status"></p></header>
    <div class="wc-delivery__grid">
      <div><div class="wc-export" aria-label="Export quote"><button type="button" data-public-action="pdf">Download PDF</button><button type="button" data-public-action="print">Print</button></div><div class="wc-summary-host" data-quote-summary></div></div>
      <form class="wc-contact" data-quote-form novalidate>
        <h3>Submit quote</h3>
        <p class="wc-contact__hint">The quote will be emailed to you and copied to the company.</p>
        <label>Full name<input type="text" name="name" autocomplete="name" maxlength="120" required></label>
        <label>Phone<input type="tel" name="phone" autocomplete="tel" inputmode="tel" required></label>
        <label>E-mail recipient<input type="email" name="email" autocomplete="email" maxlength="254" required></label>
        <label class="wc-contact__trap" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        <div class="wc-export"><button type="button" data-edit-save hidden>Save</button><button type="submit">Get quote</button></div>
        <p class="wc-submission-status" data-submission-status role="status" aria-live="polite"></p>
      </form>
    </div>
    <div class="wc-archive" data-quote-archive></div>
    <p class="wc-admin-link"><a href="../admin/">Admin panel</a></p>
  </section>`;
}

function safeExport(action, status) {
  try { action(); } catch (error) { status.textContent = error?.message ?? t('Export is unavailable.'); }
}

const autoHost = globalThis.document?.querySelector?.('[data-window-calculator]');
if (autoHost) {
  const url = new URL(globalThis.location.href);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('beynda-calculator-presentation') ?? '{}'); } catch {}
  const preferences = normalizePresentation({ language: url.searchParams.get('lang') ?? saved.language ?? 'en', units: url.searchParams.get('units') ?? saved.units ?? 'in', market: url.searchParams.get('currency') ?? saved.market ?? 'USD' });
  setPresentation(preferences);
  document.cookie = `beynda_language=${preferences.language}; Path=/; SameSite=Lax`;
  document.documentElement.lang = preferences.language;
  document.title = `${t('Soft Window Calculator')} - Beynda`;
  const toolbar = document.createElement('section');
  toolbar.className = 'wc-preferences';
  toolbar.setAttribute('aria-label', t('Language'));
  toolbar.innerHTML = msg`<div class="wc-preferences__controls"><label>Language<select data-preference="language"><option value="en" lang="en">English</option><option value="ru" lang="ru">Русский</option></select></label><label>Units<select data-preference="units"><option value="cm">Centimeters</option><option value="in">Inches</option></select></label><label>Currency<select data-preference="market"><option value="USD">USD</option><option value="EUR">EUR</option><option value="RUB">RUB</option></select></label></div><p><strong>Demo rates</strong>: Illustrative prices. Set your own rates before use.</p>`;
  for (const select of toolbar.querySelectorAll('select')) {
    if (select.dataset.preference === 'market') for (const option of select.options) {
      option.hidden = preferences.language === 'ru' ? option.value !== 'RUB' : option.value === 'RUB';
      option.disabled = option.hidden;
    }
    select.value = preferences[select.dataset.preference];
    select.disabled = preferences.language === 'ru' && select.dataset.preference !== 'language';
    select.addEventListener('change', () => {
      const contactForm = autoHost.querySelector('[data-quote-form]');
      if (contactForm?.inert || (contactForm && ['name', 'phone', 'email'].some(name => contactForm.elements.namedItem(name)?.value) && !globalThis.confirm(t('Changing display settings reloads this page. Dimensions are retained; contact fields will be cleared. Continue?')))) {
        select.value = preferences[select.dataset.preference];
        return;
      }
      const next = { ...preferences, [select.dataset.preference]: select.value };
      if (select.dataset.preference === 'language') { next.units = next.language === 'ru' ? 'cm' : 'in'; next.market = next.language === 'ru' ? 'RUB' : 'USD'; }
      const normalized = normalizePresentation(next);
      try { localStorage.setItem('beynda-calculator-presentation', JSON.stringify(normalized)); } catch {}
      url.searchParams.set('lang', normalized.language);
      url.searchParams.set('units', normalized.units);
      url.searchParams.set('currency', normalized.market);
      globalThis.location.assign(url.href);
    });
  }
  autoHost.before(toolbar);
  startCalculator(autoHost);
}
