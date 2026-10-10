import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputRoot = join(projectRoot, 'deployment', 'dist');
const markerName = '.window-calculator-build.json';
const marker = Object.freeze({ owner: 'buildDeployPackage', version: 1, package: 'window-calculator' });

export async function buildDeployPackage({ outputRoot = defaultOutputRoot } = {}) {
  const resolvedOutput = resolve(outputRoot);
  if (resolvedOutput === projectRoot || resolvedOutput === parse(resolvedOutput).root) {
    throw new Error('The build directory must not be the project or filesystem root.');
  }
  await mkdir(resolvedOutput, { recursive: true });
  const outputInfo = await lstat(resolvedOutput);
  if (outputInfo.isSymbolicLink()) throw new Error('Output root must not be a symbolic link.');
  const canonicalOutput = await realpath(resolvedOutput);
  const packageRoot = join(canonicalOutput, marker.package);
  if (dirname(packageRoot) !== canonicalOutput) throw new Error('Resolved package path escapes output root.');

  const existing = await lstatOrNull(packageRoot);
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error('Build target must not be a symbolic link.');
    if (!existing.isDirectory()) throw new Error('Build target exists and is not a directory.');
    const canonicalPackage = await realpath(packageRoot);
    if (dirname(canonicalPackage) !== canonicalOutput || canonicalPackage !== packageRoot) {
      throw new Error('Resolved build target escapes output root.');
    }
    await assertOwnedBuild(packageRoot);
    await assertNoSymbolicLinks(packageRoot);
    await rm(packageRoot, { recursive: true, force: false });
  }
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, markerName), `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  for (const directory of ['public', 'src', 'server']) {
    await cp(join(projectRoot, directory), join(packageRoot, directory), { recursive: true });
  }
  await mkdir(join(packageRoot, 'storage'), { recursive: true });
  await cp(join(projectRoot, 'storage', 'config.json'), join(packageRoot, 'storage', 'config.json'));
  await cp(join(projectRoot, 'licenses'), join(packageRoot, 'licenses'), { recursive: true });
  await cp(join(projectRoot, 'THIRD_PARTY_NOTICES.md'), join(packageRoot, 'THIRD_PARTY_NOTICES.md'));
  await cp(join(projectRoot, 'LICENSE'), join(packageRoot, 'LICENSE'));
  await cp(join(projectRoot, '.env.example'), join(packageRoot, '.env.example'));
  await cp(join(projectRoot, 'docs', 'INSTALL.md'), join(packageRoot, 'INSTALL.md'));
  await cp(join(projectRoot, 'deployment', 'router.php'), join(packageRoot, 'router.php'));
  await writeFile(join(packageRoot, '.htaccess'), 'RedirectMatch 404 ^/(?:.*\/)?(?:storage|server)(?:\/|$)\n<FilesMatch "^\\.">\nRequire all denied\n</FilesMatch>\n', 'utf8');
  await cp(join(projectRoot, 'docs', 'embed-fragment.html'), join(packageRoot, 'embed-fragment.html'));
  await writeFile(join(packageRoot, 'storage', '.htaccess'), 'Require all denied\nDeny from all\n', 'utf8');
  await writeFile(join(packageRoot, 'storage', 'index.html'), '', 'utf8');
  await writeWrapper(join(packageRoot, 'api', 'quote', 'index.php'), '../../server/api/quote/index.php');
  await writeWrapper(join(packageRoot, 'config', 'public.php'), '../server/config/public.php');
  await writeWrapper(join(packageRoot, 'admin', 'index.php'), '../server/admin/index.php');
  await writeWrapper(join(packageRoot, 'admin', 'backup.php'), '../server/admin/backup.php');
  await writeWrapper(join(packageRoot, 'archive', 'index.php'), '../server/archive/index.php');
  return packageRoot;
}

async function assertOwnedBuild(packageRoot) {
  const path = join(packageRoot, markerName);
  const info = await lstatOrNull(path);
  if (!info || info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Refusing to remove build target without a regular ${markerName} marker.`);
  }
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('Build marker is unreadable or invalid.'); }
  if (value?.owner !== marker.owner || value?.version !== marker.version || value?.package !== marker.package) {
    throw new Error('Build marker does not identify a buildDeployPackage artifact.');
  }
}

async function assertNoSymbolicLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing to remove build containing symbolic link: ${path}`);
    if (info.isDirectory()) await assertNoSymbolicLinks(path);
  }
}

async function lstatOrNull(path) {
  try { return await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function writeWrapper(path, target) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `<?php\n\ndeclare(strict_types=1);\n\nrequire __DIR__ . '/${target}';\n`, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await buildDeployPackage()}\n`);
}
