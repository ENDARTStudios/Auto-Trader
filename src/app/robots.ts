import type { MetadataRoute } from 'next';

// Base URL resiliente: NEXT_PUBLIC_APP_URL (pode existir VAZIO na Vercel —
// `??` não cobre "") → VERCEL_URL (auto da plataforma) → localhost.
// O placeholder 'https://your-domain.com' gerava canonical/sitemap para um
// domínio inexistente (bug SEO ativo desde S01).
export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}

export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/_next/', '/private/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
