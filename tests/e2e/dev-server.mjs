import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const requestedPort = Number(process.argv.find((value) => value.startsWith('--port='))?.split('=')[1] ?? 4173);
const events = [];
const archiveRecords = [];
const starter = JSON.parse(await readFile(join(root, 'storage', 'config.json'), 'utf8'));
const testConfig = {
  ...starter,
  tariffs: {
    ...starter.tariffs,
    materials: { ...starter.tariffs.materials, 'clear-pvc-700': 1000, 'tinted-pvc-700': 1200 },
    border: { perMeter: 100, baseWidthCm: 10 },
    hardware: {
      ...starter.tariffs.hardware,
      grommet: 10,
      'plastic-turn-button': 20,
      'metal-turn-button': 25,
      'black-metal-turn-button': 30,
      'strap-bracket-45': 35,
    },
    zipperPerMeter: 50,
    weightBarPerMeter: 80,
    flashingPerMeter: 70,
  },
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/config/public.php') return json(response, 200, testConfig);
    if (request.method === 'GET' && url.pathname === '/_test/logs') return json(response, 200, events);
    if (request.method === 'POST' && /^\/api\/quote\/?$/.test(url.pathname)) {
      const body = await readBody(request);
      const payload = JSON.parse(body);
      const quoteNumber = `Q-E2E-${String(events.length + 1).padStart(3, '0')}`;
      events.push({ event: 'quote_mail_simulated', recipientKind: 'company-and-client', quoteNumber });
      archiveRecords.unshift({
        quoteNumber, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 47_304_000_000).toISOString(),
        contact: payload.contact, total: 12345, currency: payload.project.presentation?.market ?? 'RUB', productCount: payload.project.products.length,
        delivery: { company: { status: 'sent' }, client: { status: 'sent' } },
      });
      return json(response, 201, {
        ok: true,
        quoteNumber,
        pdfFilename: `${quoteNumber}.pdf`,
        pdfBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),
      });
    }
    if (url.pathname === '/archive/' && request.method === 'GET') {
      if (url.searchParams.has('pdf')) {
        response.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="calculation.pdf"' });
        response.end('%PDF-1.7\n%%EOF\n');
        return;
      }
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const records = query ? archiveRecords.filter((record) => JSON.stringify(record).toLowerCase().includes(query)) : archiveRecords;
      return json(response, 200, { ok: true, records });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { location: '/public/', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const pathname = url.pathname === '/' ? '/public/index.html' : url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const filePath = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return json(response, 403, { error: 'FORBIDDEN' });
    if (!(await stat(filePath)).isFile()) return json(response, 404, { error: 'NOT_FOUND' });
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentType(extname(filePath)),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    json(response, error?.code === 'ENOENT' ? 404 : 500, { error: error?.code === 'ENOENT' ? 'NOT_FOUND' : 'SERVER_ERROR' });
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`http://127.0.0.1:${address.port}\n`);
});
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 262144) request.destroy(new Error('BODY_TOO_LARGE'));
      else chunks.push(chunk);
    });
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function contentType(extension) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' })[extension] ?? 'application/octet-stream';
}
