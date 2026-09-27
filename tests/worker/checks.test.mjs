// Crafts hostile archives and confirms the scan worker's structural checks reject them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yazl from 'yazl';
import { inspectZip, magicOk } from '../../worker/checks.mjs';

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'checks-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

function makeZip(name, entries) {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile();
    for (const e of entries) z.addBuffer(e.data ?? Buffer.from('hello'), e.path, { mode: e.mode, compress: e.compress ?? true });
    const out = join(dir, name);
    z.outputStream.pipe(createWriteStream(out)).on('close', () => resolve(out));
    z.end();
  });
}

test('a normal template zip passes and yields a manifest', async () => {
  const f = await makeZip('ok.zip', [{ path: 'kit/index.html' }, { path: 'kit/styles.css' }, { path: 'kit/README.md' }]);
  const r = await inspectZip(f);
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.entries.map((e) => e.path), ['kit/index.html', 'kit/styles.css', 'kit/README.md']);
});

test('executables anywhere in the archive are rejected', async () => {
  const f = await makeZip('exe.zip', [{ path: 'kit/index.html' }, { path: 'kit/tools/setup.exe' }]);
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /setup\.exe/);
});

test('path traversal entries are rejected', async () => {
  // yazl refuses "../" itself, so patch the name bytes after writing.
  const f = await makeZip('trav.zip', [{ path: 'aa/evil.txt' }]);
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(f);
  const patched = Buffer.from(buf.toString('latin1').split('aa/evil.txt').join('../evil.txt'), 'latin1');
  await writeFile(f, patched);
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Unsafe path/);
});

test('symlinks are rejected', async () => {
  const f = await makeZip('link.zip', [{ path: 'kit/link', mode: 0o120777, data: Buffer.from('/etc/passwd') }]);
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Symbolic links/);
});

test('zip bombs (extreme compression ratio) are rejected', async () => {
  const f = await makeZip('bomb.zip', [{ path: 'zeros.bin', data: Buffer.alloc(40 * 1024 * 1024) }]);
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /zip bomb/);
});

test('too many entries are rejected', async () => {
  const f = await makeZip('many.zip', Array.from({ length: 5001 }, (_, i) => ({ path: `f/${i}.txt`, compress: false })));
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at most 5000/);
});

test('corrupt archives are rejected', async () => {
  const f = join(dir, 'corrupt.zip');
  await writeFile(f, Buffer.from('PK\u0003\u0004 not really a zip'));
  const r = await inspectZip(f);
  assert.equal(r.ok, false);
});

test('magic bytes must match the extension', () => {
  const b = (s) => Buffer.from(s.padEnd(16, '\0'), 'latin1');
  assert.equal(magicOk('zip', b('PK\u0003\u0004')), true);
  assert.equal(magicOk('psd', b('8BPS')), true);
  assert.equal(magicOk('pdf', b('%PDF-1.7')), true);
  assert.equal(magicOk('fig', b('fig-kiwi')), true);
  assert.equal(magicOk('ai', b('%!PS-Adobe')), true);
  assert.equal(magicOk('zip', b('MZ\u0090')), false, 'a Windows executable renamed to .zip');
  assert.equal(magicOk('psd', b('PK\u0003\u0004')), false);
  assert.equal(magicOk('pdf', b('<html>')), false);
});
