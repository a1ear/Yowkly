/** Only same-site relative paths are allowed as post-auth redirects (no //evil.com, no /\evil.com). */
export function safeNext(next: unknown, fallback = '/') {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.includes('\n')) return fallback;
  return next.slice(0, 500);
}
