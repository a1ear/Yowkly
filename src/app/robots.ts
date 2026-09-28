import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private or per-user pages (they also send noindex); /go and /api are redirects and endpoints.
      disallow: ['/admin', '/api/', '/auth/', '/dashboard', '/go/', '/me', '/notifications', '/onboarding', '/settings', '/upload', '/for-you'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
