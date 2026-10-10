import { t, msg, locale } from '../../shared/presentation.js';
export function mountQuoteArchive(root, options = {}) {
  if (!root || typeof root.addEventListener !== 'function') throw new TypeError(t('Archive root is required.'));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = String(options.endpoint ?? '/archive/');
  if (typeof fetchImpl !== 'function') throw new TypeError(t('Archive fetch is required.'));
  let loaded = false;
  let busy = false;
  let activeNumber = '';
  let records = [];
  let query = '';
  let pagination = { page: 1, pages: 1, total: 0 };
  const opened = new Set();
  const render = () => { content.innerHTML = archiveWorkspace(records, endpoint, activeNumber, query, pagination, opened); };
  const listUrl = (search = query, page = pagination.page) => {
    const url = new URL(endpoint, globalThis.location?.href ?? 'http://localhost/');
    if (search) url.searchParams.set('q', search);
    url.searchParams.set('page', String(page));
    return url.toString();
  };

  root.innerHTML = archiveShell();
  const toggle = root.querySelector('[data-archive-toggle]');
  const panel = root.querySelector('[data-archive-panel]');
  const status = root.querySelector('[data-archive-status]');
  const content = root.querySelector('[data-archive-content]');

  const request = async (url = endpoint, init = {}) => {
    const response = await fetchImpl(url, { credentials: 'same-origin', ...init });
    let data = null;
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok || data?.ok !== true) {
      const error = new Error(data?.message ? t(data.message) : t('Archive is temporarily unavailable.'));
      error.code = data?.code;
      throw error;
    }
    return data;
  };

  const showState = (data) => {
    records = data.records ?? [];
    pagination = { page: data.page ?? 1, pages: data.pages ?? 1, total: data.total ?? records.length };
    render();
    status.textContent = '';
  };

  const load = async (search = query, page = pagination.page) => {
    if (busy) return;
    busy = true;
    status.textContent = t('Loading archive…');
    try {
      const data = await request(listUrl(search, page));
      query = search;
      showState(data);
      loaded = true;
    } catch (error) {
      status.textContent = error?.message ?? t('Archive is temporarily unavailable.');
      if (error?.code === 'AUTH_REQUIRED') {
        const link = root.ownerDocument.createElement('a');
        link.href = new URL('../admin/', new URL(endpoint, globalThis.location?.href ?? 'http://localhost/')).toString();
        link.textContent = t('Sign in');
        status.append(' ', link);
      }
    } finally {
      busy = false;
    }
  };

  const onClick = async (event) => {
    const pageButton = event.target?.closest?.('[data-archive-page]');
    if (pageButton) { await load(query, Number(pageButton.dataset.archivePage)); return; }
    if (event.target?.closest?.('[data-archive-toggle]')) {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening && !loaded) void load();
    }
    const edit = event.target?.closest?.('[data-archive-edit]');
    if (!edit || busy) return;
    busy = true;
    for (const button of content.querySelectorAll('button')) button.disabled = true;
    try {
      if (edit) {
        status.textContent = t('Opening quote…');
        const url = new URL(endpoint, globalThis.location?.href ?? 'http://localhost/');
        url.searchParams.set('edit', edit.dataset.archiveEdit);
        const data = await request(url.toString());
        if (await options.onEdit?.(data.record) === false) { status.textContent = ''; return; }
        activeNumber = data.record.quoteNumber;
        opened.clear();
        opened.add(activeNumber);
        status.textContent = msg`Quote opened ${activeNumber}. Make changes in the calculator, then save.`;
      }
    } catch (error) { status.textContent = error?.message ?? t('Action failed.'); }
    finally { busy = false; render(); }
  };

  const onSubmit = async (event) => {
    const form = event.target?.closest?.('form');
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    if (busy) return;
    if (form.dataset.archiveAction !== 'search') return;
    await load(String(form.elements?.namedItem?.('q')?.value ?? '').trim(), 1);
  };

  const onToggle = (event) => {
    const row = event.target;
    if (!root.contains(row) || !row?.dataset?.archiveRow) return;
    if (row.open) {
      opened.clear();
      opened.add(row.dataset.archiveRow);
      for (const other of content.querySelectorAll('details[data-archive-row][open]')) {
        if (other !== row) other.open = false;
      }
    } else opened.delete(row.dataset.archiveRow);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('toggle', onToggle, true);
  return Object.freeze({
    refresh: load,
    setActive(number) {
      activeNumber = number || '';
      render();
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      root.removeEventListener('toggle', onToggle, true);
    },
  });
}

export function renderArchiveRecords(records, endpoint = '/archive/', activeNumber = '', opened = new Set()) {
  if (!Array.isArray(records) || records.length === 0) return t('<p class="wc-archive__empty">No quotes found.</p>');
  return msg`<div class="wc-archive__columns" aria-hidden="true"><span>Date</span><span>Quote number</span><span>Customer</span><span>Phone</span><span>Amount</span><span></span></div><div class="wc-archive__records">${records.map((record) => {
    const quoteNumber = String(record?.quoteNumber ?? '');
    const pdfUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}pdf=${encodeURIComponent(quoteNumber)}`;
    const productCount = Number(record?.productCount ?? 0);
    return msg`<details class="wc-archive-card" name="wc-archive-record" data-archive-row="${escapeHtml(quoteNumber)}"${opened.has(quoteNumber) ? ' open' : ''}>
      <summary class="wc-archive-card__row"><span class="wc-archive-card__date">${escapeHtml(formatDate(record?.createdAt))}</span><strong class="wc-archive-card__number">${escapeHtml(quoteNumber)}</strong><span class="wc-archive-card__name">${escapeHtml(record?.contact?.name)}</span><span class="wc-archive-card__phone">${escapeHtml(record?.contact?.phone)}</span><strong class="wc-archive-card__total">${escapeHtml(formatMoney(record?.total, record?.currency))}</strong><span class="wc-archive-card__chevron" aria-hidden="true">⌄</span></summary>
      <div class="wc-archive-card__body"><dl>
        <div><dt>E-mail</dt><dd>${escapeHtml(record?.contact?.email)}</dd></div>
        <div><dt>Contents</dt><dd>${productCount} ${productsWord(productCount)}</dd></div>
      </dl>
      <div class="wc-archive-card__actions">
        <a class="wc-archive-card__pdf" href="${escapeHtml(pdfUrl)}">Download PDF</a>
        <button type="button" data-archive-edit="${escapeHtml(quoteNumber)}">Edit</button>
      </div></div>
    </details>`;
  }).join('')}</div>`;
}

function archiveShell() {
  return msg`<button class="wc-archive__toggle" type="button" data-archive-toggle aria-expanded="false">Quote archive</button>
    <section class="wc-archive__panel" data-archive-panel hidden aria-label="Quote archive">
      <div class="wc-archive__heading"><div><h3>Quote archive</h3><p>Quotes and PDF are retained for 18 months.</p></div></div>
      <p class="wc-archive__status" data-archive-status role="status" aria-live="polite"></p>
      <div data-archive-content></div>
    </section>`;
}

function archiveWorkspace(records, endpoint, activeNumber, query, pagination, opened) {
  return msg`<div class="wc-archive__toolbar">
      <form data-archive-action="search"><label><span class="wc-visually-hidden">Search archive</span><input type="search" name="q" maxlength="120" value="${escapeHtml(query)}" placeholder="Number, name, phone or e-mail"></label><button type="submit">Search</button></form>
    </div>${renderArchiveRecords(records, endpoint, activeNumber, opened)}
    <nav class="wc-archive__pagination" aria-label="Archive pages"><button type="button" data-archive-page="${pagination.page - 1}"${pagination.page <= 1 ? ' disabled' : ''}>Back</button><span>Page ${pagination.page} of ${pagination.pages} · Found: ${pagination.total}</span><button type="button" data-archive-page="${pagination.page + 1}"${pagination.page >= pagination.pages ? ' disabled' : ''}>Next</button></nav>`;
}

function formatDate(value) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || 'RUB', maximumFractionDigits: currency === 'RUB' ? 0 : 2 }).format(amount); }
  catch { return `${amount.toLocaleString('en-US')} ₽`; }
}

function productsWord(count) {
  return count === 1 ? t('product') : t('products');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
