import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'deployment', 'demo');
await mkdir(join(output, 'config'), { recursive: true });
for (const directory of ['public', 'src', 'licenses']) {
  await cp(join(root, directory), join(output, directory), { recursive: true });
}
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(output, file));
const config = JSON.parse(await readFile(join(root, 'storage/config.json'), 'utf8'));
const keys = ['version', 'currency', 'companyAddress', 'ranges', 'availableOptions', 'tariffs', 'vat', 'texts', 'marketRates'];
await writeFile(join(output, 'config/demo.json'), JSON.stringify(Object.fromEntries(keys.filter(key => key in config).map(key => [key, config[key]])), null, 2) + '\n');
const html = (await readFile(join(root, 'public/index.html'), 'utf8'))
  .replace('data-window-calculator>', 'data-window-calculator data-demo="true">')
  .replace('./calculator.css', './public/calculator.css')
  .replace('./app.js', './public/app.js');
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, '.nojekyll'), '');
process.stdout.write(output + '\n');
