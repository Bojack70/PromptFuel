/**
 * npm analytics: download counts for each package.
 * Uses the public npm registry API (no auth needed).
 */

export interface NpmMetrics {
  /** Package name -> download counts */
  packages: Record<string, {
    downloadsLastDay: number;
    downloadsLastWeek: number;
    downloadsLastMonth: number;
  }>;
}

async function fetchDownloads(pkg: string, period: string): Promise<number> {
  const encoded = encodeURIComponent(pkg);
  const res = await fetch(`https://api.npmjs.org/downloads/point/${period}/${encoded}`);
  if (!res.ok) return 0;
  const data = await res.json() as { downloads?: number };
  return data.downloads ?? 0;
}

export async function collectNpmMetrics(packageNames: string[]): Promise<NpmMetrics> {
  const packages: NpmMetrics['packages'] = {};

  await Promise.all(
    packageNames.map(async (pkg) => {
      const [day, week, month] = await Promise.all([
        fetchDownloads(pkg, 'last-day'),
        fetchDownloads(pkg, 'last-week'),
        fetchDownloads(pkg, 'last-month'),
      ]);
      packages[pkg] = {
        downloadsLastDay: day,
        downloadsLastWeek: week,
        downloadsLastMonth: month,
      };
    }),
  );

  return { packages };
}
