import type { NextConfig } from 'next';

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:54321';
const supabaseWs = supabase.replace(/^http/, 'ws');
const media = process.env.NEXT_PUBLIC_MEDIA_URL?.trim() ? new URL(process.env.NEXT_PUBLIC_MEDIA_URL.trim()).origin : '';
// The media bucket must be served from its PUBLIC address (r2.dev or a custom
// domain). The *.r2.cloudflarestorage.com API address only accepts signed
// requests, so every image would show as broken.
if (/\.r2\.cloudflarestorage\.com$/.test(media.replace(/^https?:\/\//, ''))) {
  throw new Error('NEXT_PUBLIC_MEDIA_URL must be the PUBLIC address of the media bucket (R2 > yowkly-media > Settings > Public Development URL, https://pub-….r2.dev), not the private S3 API address ' + media);
}
// Browsers PUT uploads straight to R2 with pre-signed URLs.
const r2 = process.env.R2_ENDPOINT?.trim() ? new URL(process.env.R2_ENDPOINT.trim()).origin
  : process.env.R2_ACCOUNT_ID?.trim() ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : 'https://*.r2.cloudflarestorage.com';
const dev = process.env.NODE_ENV !== 'production';

// Inline scripts are required by Next's hydration unless every page is rendered
// per-request with a nonce, which would disable page caching. We compensate by
// never rendering user HTML (no dangerouslySetInnerHTML with user input).
const csp = [
  "default-src 'self'",
  // In development @vercel/analytics loads its debug script from Vercel's CDN; in production it's same-origin.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase} ${media} ${r2}`,
  "font-src 'self'",
  `connect-src 'self' ${supabase} ${supabaseWs} ${r2}`,
  "frame-src https:",          // live demo previews (sandboxed iframes)
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${supabase} https://github.com https://accounts.google.com`,
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Client-side page cache: a page you opened in the last 30 s (or a prefetched
    // static one in the last 5 min) shows instantly instead of waiting on the server.
    // Actions that change data refresh the affected pages, so this never hides your own edits.
    staleTimes: { dynamic: 30, static: 300 },
  },
  async redirects() {
    return [
      { source: '/awards', destination: '/ranking', permanent: true },
      // Notifications are a popup on the bell now, not a page.
      { source: '/notifications', destination: '/', permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: '/@:username', destination: '/u/:username' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
        ],
      },
    ];
  },
};

export default nextConfig;
