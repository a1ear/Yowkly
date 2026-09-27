// Pure, dependency-light checks used by the scan worker (unit-tested in tests/worker).
import yauzl from 'yauzl';

// ── Limits (PLAN.md §4.1) ─────────────────────────────────────────────
const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 500 * 1024 * 1024;
const MAX_RATIO = 100;
const BLOCKED = /\.(exe|dll|bat|cmd|com|sh|bash|ps1|psm1|vbs|vbe|js[ex]|wsf|wsh|msi|msp|jar|scr|pif|cpl|app|apk|dmg|pkg|deb|rpm|run|bin|lnk|reg|hta|iso|img)$/i;
export const ZIP_BASED = new Set(['zip', 'sketch', 'xd', 'penpot']);

/** Real file type must match the extension. */
export function magicOk(ext, head) {
  const starts = (s) => head.subarray(0, s.length).toString('latin1') === s;
  const zip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
  switch (ext) {
    case 'zip': case 'sketch': case 'xd': case 'penpot': return zip;
    case 'fig': return starts('fig-kiwi') || zip;
    case 'psd': return starts('8BPS');
    case 'pdf': return starts('%PDF-');
    case 'ai': return starts('%PDF-') || starts('%!PS');
    default: return false;
  }
}

export function inspectZip(file) {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true, strictFileNames: false }, (err, zip) => {
      if (err) return resolve({ ok: false, reason: 'The archive is corrupt or encrypted.' });
      let entries = 0, unpacked = 0, packed = 0;
      const manifest = [];
      const done = (r) => { zip.close(); resolve(r); };
      zip.on('entry', (e) => {
        entries++;
        unpacked += e.uncompressedSize;
        packed += e.compressedSize;
        const name = e.fileName.replace(/\\/g, '/');
        const mode = (e.externalFileAttributes >>> 16) & 0o170000;
        if (entries > MAX_ENTRIES) return done({ ok: false, reason: `Archives can hold at most ${MAX_ENTRIES} files.` });
        if (unpacked > MAX_UNPACKED) return done({ ok: false, reason: 'The archive unpacks to more than 500 MB.' });
        if (packed > 0 && unpacked / packed > MAX_RATIO && unpacked > 10 * 1024 * 1024) return done({ ok: false, reason: 'The archive looks like a zip bomb (extreme compression ratio).' });
        if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) return done({ ok: false, reason: `Unsafe path in archive: ${name}` });
        if (mode === 0o120000) return done({ ok: false, reason: `Symbolic links aren't allowed: ${name}` });
        if (e.generalPurposeBitFlag & 0x1) return done({ ok: false, reason: 'Password-protected archives can’t be scanned.' });
        if (BLOCKED.test(name)) return done({ ok: false, reason: `Executable files aren't allowed: ${name.split('/').pop()}` });
        if (!name.endsWith('/') && manifest.length < 2000) manifest.push({ path: name, size: e.uncompressedSize });
        zip.readEntry();
      });
      zip.on('end', () => done({ ok: true, manifest: { entries: manifest, total: entries, unpacked } }));
      zip.on('error', (e) => done({
        ok: false,
        // yauzl itself refuses "../" and absolute entry names; report them as what they are.
        reason: /invalid relative path|absolute path/.test(e?.message ?? '')
          ? `Unsafe path in archive: ${e.message.split(': ').pop()}`
          : 'The archive is corrupt.',
      }));
      zip.readEntry();
    });
  });
}

