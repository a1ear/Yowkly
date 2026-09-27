import type { NextConfig } from 'next';

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseWs = supabase.replace(/^http/, 'ws');
const dev = process.env.NODE_ENV !== 'production';

// Inline scripts are required by Next's hydration unless every page is rendered
// per-request with a nonce, which would disable page caching. We compensate by
// never rendering user HTML (no dangerouslySetInnerHTML with user input).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`,
  "font-src 'self'",
  `connect-src 'self' ${supabase} ${supabaseWs}`,
  "frame-src https:",          // live demo previews (sandboxed iframes)
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${supabase} https://github.com https://accounts.google.com`,
  ...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
        ],
      },
    ];
  },
};

export default nextConfig;
