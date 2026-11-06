import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(root, 'vendor', 'cernere-composite');
const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(directory.length + 1).replaceAll('\\', '/'))
    .sort();
}

test('vendored Composite dist is generated from the pinned source', () => {
  const output = mkdtempSync(join(tmpdir(), 'tendentia-composite-dist-'));
  try {
    const pin = JSON.parse(readFileSync(join(vendor, 'source-pin.json'), 'utf8'));
    assert.match(pin.revision, /^[0-9a-f]{40}$/);
    assert.deepEqual(Object.keys(pin.hashes).sort(), files(join(vendor, 'source')));
    for (const [name, digest] of Object.entries(pin.hashes)) {
      const bytes = readFileSync(join(vendor, 'source', name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, name);
    }
    execFileSync(process.execPath, [compiler, '-p', join(vendor, 'tsconfig.json'), '--outDir', output], {
      cwd: root,
      stdio: 'pipe',
    });
    const expected = files(join(vendor, 'dist'));
    assert.deepEqual(files(output), expected);
    for (const relative of expected) {
      assert.deepEqual(readFileSync(join(output, relative)), readFileSync(join(vendor, 'dist', relative)), relative);
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
