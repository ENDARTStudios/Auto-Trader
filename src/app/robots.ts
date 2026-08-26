import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/_next/', '/private/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
