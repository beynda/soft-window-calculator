import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

import { buildDeployPackage } from '../../deployment/build.mjs';

const PROJECT_SECRET_VARIABLES = new Set([
  'ADMIN_PASSWORD_HASH',
  'QUOTE_IP_HASH_SALT',
  'QUOTE_IDEMPOTENCY_SALT',
]);
const SECRET_VARIABLE_MARKERS = [
  'PASSWORD',
  'PASSWD',
  'TOKEN',
  'SECRET',
  'PRIVATE',
  'CREDENTIAL',
  'AUTHORIZATION',
];

test('buildDeployPackage creates an autonomous PHP package with only local browser assets', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'window-calculator-build-'));
  try {
    const packageRoot = await buildDeployPackage({ outputRoot });
    const required = [
      'public/index.html', 'public/app.js', 'public/calculator.css',
      'src/domain/index.js', 'src/frontend/calculator/index.js',
      'api/quote/index.php', 'config/public.php', 'admin/index.php', 'archive/index.php',
      'server/api/QuoteService.php', 'server/archive/QuoteArchive.php', 'storage/config.json', 'storage/.htaccess',
      'INSTALL.md', 'embed-fragment.html', '.env.example',
    ];
    for (const path of required) assert.equal((await stat(join(packageRoot, path))).isFile(), true, path);

    const html = await readFile(join(packageRoot, 'public/index.html'), 'utf8');
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.match(html, /\.\/calculator\.css/);
    assert.match(html, /\.\/app\.js/);

    const env = await readFile(join(packageRoot, '.env.example'), 'utf8');
    for (const line of env.trim().split(/\r?\n/)) assert.match(line, /^[A-Z][A-Z0-9_]*=$/);
    assert.doesNotMatch(env, /FTP_|SMTP_/);

    await auditArtifact(packageRoot);

    const quoteWrapper = await readFile(join(packageRoot, 'api/quote/index.php'), 'utf8');
    assert.match(quoteWrapper, /require __DIR__ \. '\/\.\.\/\.\.\/server\/api\/quote\/index\.php';/);

    await writeFile(join(packageRoot, 'stale-from-previous-build.txt'), 'owned build residue');
    assert.equal(await buildDeployPackage({ outputRoot }), packageRoot);
    await assert.rejects(stat(join(packageRoot, 'stale-from-previous-build.txt')), { code: 'ENOENT' });

    await writeFile(join(packageRoot, 'unlisted-cdn.js'), "import 'https://cdn.example.invalid/widget.js';\n");
    await assert.rejects(auditArtifact(packageRoot), /external CDN/i);
    await rm(join(packageRoot, 'unlisted-cdn.js'));

    const secretMutations = [
      ['bare-password.env', 'PASSWORD'],
      ['admin-password-hash.env', 'ADMIN_PASSWORD_HASH'],
      ['quote-ip-hash-salt.env', 'QUOTE_IP_HASH_SALT'],
      ['quote-idempotency-salt.env', 'QUOTE_IDEMPOTENCY_SALT'],
      ['generic-token.env', 'CI_DEPLOY_TOKEN'],
    ];
    for (const [filename, key] of secretMutations) {
      const fakeSecret = `fake-${key.toLowerCase()}-never-print`;
      const mutationPath = join(packageRoot, filename);
      await writeFile(mutationPath, `${key}=${fakeSecret}\n`);
      await assert.rejects(
        auditArtifact(packageRoot),
        (error) => error.message === `credential assignment in ${filename}`
          && !error.message.includes(key)
          && !error.message.includes(fakeSecret),
        key,
      );
      await rm(mutationPath);
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('buildDeployPackage never removes an unowned target or follows a target symlink', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'window-calculator-safety-'));
  try {
    const outputRoot = join(parent, 'output');
    const packageRoot = join(outputRoot, 'window-calculator');
    await mkdir(packageRoot, { recursive: true });
    const sentinel = join(packageRoot, 'must-survive.txt');
    await writeFile(sentinel, 'user data');
    await assert.rejects(buildDeployPackage({ outputRoot }), /marker/i);
    assert.equal(await readFile(sentinel, 'utf8'), 'user data');

    await rm(outputRoot, { recursive: true, force: true });
    const outside = join(parent, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, '.window-calculator-build.json'), '{"owner":"buildDeployPackage","version":1}');
    await mkdir(outputRoot);
    await symlink(outside, packageRoot, 'junction');
    await assert.rejects(buildDeployPackage({ outputRoot }), /symbolic link/i);
    assert.equal((await lstat(packageRoot)).isSymbolicLink(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

async function auditArtifact(root) {
  const files = await walk(root);
  assert.ok(files.length > 20, 'artifact scan unexpectedly small');
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/,
    /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s/@]+@/i,
    /\bAuthorization\s*:\s*(?:Basic|Bearer)\s+[A-Za-z0-9._~+/-]{12,}={0,2}/i,
    /(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"\r\n]{4,}['"]/i,
  ];
  const externalCdnPatterns = [
    /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i,
    /@import\s+(?:url\()?['"]?https?:\/\//i,
    /\bimport\s+(?:[^'"\r\n]+from\s+)?['"]https?:\/\//i,
  ];
  for (const file of files) {
    const buffer = await readFile(file);
    if (!isText(file, buffer)) continue;
    const value = buffer.toString('utf8');
    for (const assignment of envAssignments(value)) {
      if (isSecretVariable(assignment.key) && assignment.value.trim() !== '') {
        throw new Error(`credential assignment in ${relative(root, file)}`);
      }
    }
    for (const pattern of credentialPatterns) {
      if (pattern.test(value)) throw new Error(`credential literal in ${relative(root, file)}`);
    }
    for (const pattern of externalCdnPatterns) {
      if (pattern.test(value)) throw new Error(`external CDN dependency in ${relative(root, file)}`);
    }
  }
}

function * envAssignments(value) {
  const pattern = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/gm;
  for (const match of value.matchAll(pattern)) yield { key: match[1], value: match[2] };
}

function isSecretVariable(key) {
  const normalizedKey = key.toUpperCase();
  return PROJECT_SECRET_VARIABLES.has(normalizedKey)
    || SECRET_VARIABLE_MARKERS.some((marker) => normalizedKey.includes(marker));
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symbolic link in artifact: ${path}`);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function isText(path, buffer) {
  if (buffer.includes(0)) return false;
  return !['.gif', '.ico', '.jpg', '.jpeg', '.pdf', '.png', '.webp', '.woff', '.woff2'].includes(extname(path).toLowerCase());
}
