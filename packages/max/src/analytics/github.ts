/**
 * GitHub analytics: stars, forks, clones, traffic, referrers.
 * Uses GitHub REST API via GITHUB_TOKEN.
 */

export interface GitHubMetrics {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  clones: { count: number; uniques: number };
  views: { count: number; uniques: number };
  referrers: Array<{ referrer: string; count: number; uniques: number }>;
}

async function ghFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

export async function collectGitHubMetrics(
  owner: string,
  repo: string,
  token: string,
): Promise<GitHubMetrics> {
  const [repoData, clones, views, referrers] = await Promise.all([
    ghFetch(`/repos/${owner}/${repo}`, token),
    ghFetch(`/repos/${owner}/${repo}/traffic/clones`, token).catch(() => ({ count: 0, uniques: 0 })),
    ghFetch(`/repos/${owner}/${repo}/traffic/views`, token).catch(() => ({ count: 0, uniques: 0 })),
    ghFetch(`/repos/${owner}/${repo}/traffic/popular/referrers`, token).catch(() => []),
  ]);

  return {
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    watchers: repoData.subscribers_count,
    openIssues: repoData.open_issues_count,
    clones: { count: clones.count, uniques: clones.uniques },
    views: { count: views.count, uniques: views.uniques },
    referrers: (referrers as any[]).map(r => ({
      referrer: r.referrer,
      count: r.count,
      uniques: r.uniques,
    })),
  };
}
