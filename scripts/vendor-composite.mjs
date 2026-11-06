// Source-only import from the accepted local Cr revision. Never runs SDK/install hooks.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const revision = '801756d1e354c486cbe0321acdc48909eed8afee';
const repository = process.argv[2];
if (!repository) throw new Error('Usage: node scripts/vendor-composite.mjs <reviewed-Cernere-repository>');
const files = ['composite', 'service-session', 'service-identity', 'captured-operation', 'upload-body', 'upload', 'delegation', 'types'];
const directory = new URL('../vendor/cernere-composite/source/', import.meta.url);
mkdirSync(directory, { recursive: true });
const hashes = {};
for (const file of [...files.map(name => `packages/composite/src/${name}.ts`), 'LICENSE']) {
  const bytes = execFileSync('git', ['show', `${revision}:${file}`], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
  const name = file.split('/').at(-1);
  writeFileSync(new URL(name, directory), bytes);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(new URL('../source-pin.json', directory), JSON.stringify({ revision, hashes }, null, 2) + '\n');
