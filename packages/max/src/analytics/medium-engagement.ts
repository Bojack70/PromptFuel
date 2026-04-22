/**
 * Medium engagement scraper — pulls per-article stats + follower count from
 * Nate's logged-in Medium dashboard via OpenTabs.
 *
 * Local-only: OpenTabs requires Brave/Chrome with Nate's Medium session active.
 * Cannot run in CI.
 *
 * First-run protocol: run with { dryRun: true } once to dump the DOM snapshot
 * to data/dom-dumps/medium-{date}.html. Review, then update selectors below.
 * Per global rule: "Inspect DOM before writing selectors — 2 minutes with a
 * log beats 20 reading code."
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openTab, navigateTab, waitForElement, executeScript } from '../publish/opentabs/client.js';

const STATS_URL = 'https://medium.com/me/stats';
const PROFILE_URL_BASE = 'https://medium.com/@';

export interface MediumArticleStats {
  title: string;
  url?: string;
  views: number;
  reads: number;
  fans: number;
  responses: number;
}

export interface MediumEngagement {
  collectedAt: string;
  handle: string;
  followers: number | null;
  totalViews: number | null;
  totalReads: number | null;
  articles: MediumArticleStats[];
  domDumpPath?: string; // when selectors fail / dryRun, we drop the DOM here
}

export interface CollectOptions {
  handle: string;          // e.g. "natevoss.dev"
  dataDir: string;
  dryRun?: boolean;        // dump DOM, don't save data
  humanTimeoutMs?: number; // how long to allow manual login if session expired
}

function dumpDir(dataDir: string): string {
  const dir = join(dataDir, 'dom-dumps');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fetchMediumEngagement(opts: CollectOptions): Promise<MediumEngagement> {
  const { handle, dataDir, dryRun = false } = opts;
  const today = new Date().toISOString().split('T')[0];

  console.log('[Max][medium-eng] Opening Medium stats dashboard...');
  const tab = await openTab(STATS_URL);
  await navigateTab(tab.id, STATS_URL);

  // Wait for any primary content — proceed even if waitForElement times out (SPA may already be loaded).
  try {
    await waitForElement(tab.id, 'body', 15000);
  } catch {
    console.warn('[Max][medium-eng] waitForElement timed out but proceeding anyway');
  }
  // Give the SPA time to render the stats table
  await new Promise((r) => setTimeout(r, 5000));

  // --- DOM dump fallback (runs in dry-run OR when selectors fail) ---
  const dumpIfNeeded = async (reason: string): Promise<string | undefined> => {
    try {
      const html = await executeScript<string>(
        tab.id,
        `return (document.querySelector('main') || document.body).outerHTML.slice(0, 60000);`,
      );
      const path = join(dumpDir(dataDir), `medium-stats-${today}.html`);
      writeFileSync(path, typeof html === 'string' ? html : JSON.stringify(html));
      console.log(`[Max][medium-eng] DOM dump (${reason}) → ${path}`);
      return path;
    } catch (err) {
      console.warn('[Max][medium-eng] DOM dump failed:', (err as Error).message);
      return undefined;
    }
  };

  if (dryRun) {
    const path = await dumpIfNeeded('dry-run');
    return {
      collectedAt: new Date().toISOString(),
      handle,
      followers: null,
      totalViews: null,
      totalReads: null,
      articles: [],
      domDumpPath: path,
    };
  }

  // --- Try to extract article rows ---
  // DOM structure confirmed from live dump 2026-04-22:
  // table tbody tr → 5 tds: [date | title+meta | views | reads | fans]
  // Title is in h2 inside td[1]. Numbers are in span inside td[2..4].
  // Article link href contains "/me/stats/post/" or "/@handle/".
  const articles = await executeScript<MediumArticleStats[]>(
    tab.id,
    `
    var rows = Array.from(document.querySelectorAll('table tbody tr')).filter(function(r) {
      return r.querySelectorAll('td').length >= 4;
    });
    var parsed = rows.map(function(row) {
      var tds = Array.from(row.querySelectorAll('td'));
      // Title cell is td[1] (0-indexed) — contains h2 with article title
      var titleCell = tds[1];
      var titleEl = titleCell ? titleCell.querySelector('h2, h3, h4') : null;
      // URL: prefer the "View story" link (/@handle/slug), fall back to /me/stats/post/ link
      var viewStoryLink = titleCell ? titleCell.querySelector('a[href*="/@"]') : null;
      var statsLink = titleCell ? titleCell.querySelector('a[href*="/me/stats/post/"]') : null;
      var url = (viewStoryLink && viewStoryLink.href) || (statsLink && statsLink.href) || undefined;
      // Numbers in td[2]=views, td[3]=reads, td[4]=fans — each has a <span> with the number
      function extractNum(td) {
        if (!td) return 0;
        var span = td.querySelector('span');
        var txt = ((span || td).textContent || '').trim().replace(/,/g, '');
        var n = parseInt(txt, 10);
        return isNaN(n) ? 0 : n;
      }
      return {
        title: titleEl ? (titleEl.textContent || '').trim() : '',
        url: url,
        views: extractNum(tds[2]),
        reads: extractNum(tds[3]),
        fans: extractNum(tds[4]),
        responses: 0,
      };
    }).filter(function(r) { return r.title.length > 0; });
    return parsed;
    `,
  );

  // --- Follower count from profile ---
  let followers: number | null = null;
  try {
    await navigateTab(tab.id, `${PROFILE_URL_BASE}${handle}`);
    await new Promise((r) => setTimeout(r, 3000));
    const f = await executeScript<number | null>(
      tab.id,
      `
      // Follower count usually in a link/button containing the word 'Followers' or 'K Followers'
      var nodes = Array.from(document.querySelectorAll('a, button, span, div'))
        .filter(function(n) { return /followers?$/i.test((n.textContent || '').trim()); });
      // Look for sibling or parent with the number
      for (var i = 0; i < nodes.length; i++) {
        var parent = nodes[i].parentElement;
        if (!parent) continue;
        var text = (parent.textContent || '').trim();
        var m = text.match(/([\\d,\\.]+)\\s*K?\\s*Followers?/i);
        if (m) {
          var raw = m[1].replace(/,/g, '');
          var n = parseFloat(raw);
          if (text.toLowerCase().indexOf('k followers') !== -1) n = Math.round(n * 1000);
          return n;
        }
      }
      return null;
      `,
    );
    followers = typeof f === 'number' ? f : null;
  } catch (err) {
    console.warn('[Max][medium-eng] follower fetch failed:', (err as Error).message);
  }

  const parsed = Array.isArray(articles) ? articles : [];
  const totalViews = parsed.reduce((s, a) => s + (a.views || 0), 0);
  const totalReads = parsed.reduce((s, a) => s + (a.reads || 0), 0);

  if (parsed.length === 0) {
    const path = await dumpIfNeeded('no-articles-parsed');
    return {
      collectedAt: new Date().toISOString(),
      handle,
      followers,
      totalViews: null,
      totalReads: null,
      articles: [],
      domDumpPath: path,
    };
  }

  console.log(`[Max][medium-eng] Parsed ${parsed.length} articles · ${totalViews} views · ${totalReads} reads · followers=${followers ?? '?'}`);
  return {
    collectedAt: new Date().toISOString(),
    handle,
    followers,
    totalViews,
    totalReads,
    articles: parsed,
  };
}
