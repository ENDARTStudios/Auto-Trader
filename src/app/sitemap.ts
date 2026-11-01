import type { MetadataRoute } from 'next';
import { appBaseUrl } from './robots';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBaseUrl();
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/api/health`, lastModified: new Date(), changeFrequency: 'always', priority: 0.1 },
  ];
}
