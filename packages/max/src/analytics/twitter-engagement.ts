/**
 * Twitter/X engagement scraper — pulls follower count + per-tweet engagement
 * from Nate's logged-in profile via OpenTabs.
 *
 * Local-only. Twitter's DOM is more volatile than Medium/Substack — expect
 * selector maintenance. First-run protocol: dry-run, review DOM dump, adjust.
 *
 * Scrapes Nate's own profile timeline (not /home feed), so it reads his own
 * tweets' engagement numbers directly from the tweet cards.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openTab, navigateTab, waitForElement, executeScript } from '../publish/opentabs/client.js';

export interface TweetStats {
  text: string;
  url?: string;
  replies: number;
  retweets: number;
  likes: number;
  views: number;
}

export interface TwitterEngagement {
  collectedAt: string;
  handle: string;
  followers: number | null;
  following: number | null;
  tweets: TweetStats[];
  domDumpPath?: string;
}

export interface CollectOptions {
  handle: string;          // e.g. "natevoss"
  dataDir: string;
  dryRun?: boolean;
  maxTweets?: number;      // default 15
}

function dumpDir(dataDir: string): string {
  const dir = join(dataDir, 'dom-dumps');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fetchTwitterEngagement(opts: CollectOptions): Promise<TwitterEngagement> {
  const { handle, dataDir, dryRun = false, maxTweets = 15 } = opts;
  const today = new Date().toISOString().split('T')[0];
  const profileUrl = `https://x.com/${handle}`;

  console.log(`[Max][twitter-eng] Opening ${profileUrl}...`);
  const tab = await openTab(profileUrl);
  await navigateTab(tab.id, profileUrl);

  try {
    await waitForElement(tab.id, 'body', 15000);
  } catch {
    console.warn('[Max][twitter-eng] body never appeared — aborting');
    return { collectedAt: new Date().toISOString(), handle, followers: null, following: null, tweets: [] };
  }
  // Give time for timeline hydration and lazy-loaded tweet cards
  await new Promise((r) => setTimeout(r, 5000));

  const dumpIfNeeded = async (reason: string): Promise<string | undefined> => {
    try {
      const html = await executeScript<string>(
        tab.id,
        `return (document.querySelector('main') || document.body).outerHTML.slice(0, 100000);`,
      );
      const path = join(dumpDir(dataDir), `twitter-${today}.html`);
      writeFileSync(path, typeof html === 'string' ? html : JSON.stringify(html));
      console.log(`[Max][twitter-eng] DOM dump (${reason}) → ${path}`);
      return path;
    } catch (err) {
      console.warn('[Max][twitter-eng] DOM dump failed:', (err as Error).message);
      return undefined;
    }
  };

  if (dryRun) {
    const path = await dumpIfNeeded('dry-run');
    return { collectedAt: new Date().toISOString(), handle, followers: null, following: null, tweets: [], domDumpPath: path };
  }

  // --- Follower + following counts ---
  // X profile header: links with href ending in /verified_followers and /following.
  const counts = await executeScript<{ followers: number | null; following: number | null }>(
    tab.id,
    `
    function extractCount(anchor) {
      if (!anchor) return null;
      var txt = (anchor.textContent || '').trim();
      // Look for a number (possibly with K/M suffix) in the anchor text
      var m = txt.match(/([\\d,\\.]+)\\s*([KMB]?)/i);
      if (!m) return null;
      var num = parseFloat(m[1].replace(/,/g, ''));
      var suffix = m[2].toUpperCase();
      if (suffix === 'K') num *= 1000;
      else if (suffix === 'M') num *= 1000000;
      else if (suffix === 'B') num *= 1000000000;
      return Math.round(num);
    }
    var followersAnchor = document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');
    var followingAnchor = document.querySelector('a[href$="/following"]');
    return {
      followers: extractCount(followersAnchor),
      following: extractCount(followingAnchor),
    };
    `,
  );

  // --- Tweet cards ---
  const tweets = await executeScript<TweetStats[]>(
    tab.id,
    `
    var cards = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    var results = [];
    var maxN = ${maxTweets};

    function parseMetric(el) {
      if (!el) return 0;
      var label = el.getAttribute('aria-label') || '';
      // aria-label looks like "42 replies, 100 reposts, 500 likes, 12000 views"
      // If a specific testid's element has its own label we parse that number out.
      var m = label.match(/([\\d,\\.]+)(\\s*[KMB])?/i);
      if (!m) {
        var txt = (el.textContent || '').trim();
        m = txt.match(/([\\d,\\.]+)(\\s*[KMB])?/i);
      }
      if (!m) return 0;
      var num = parseFloat(m[1].replace(/,/g, ''));
      var suffix = (m[2] || '').trim().toUpperCase();
      if (suffix === 'K') num *= 1000;
      else if (suffix === 'M') num *= 1000000;
      else if (suffix === 'B') num *= 1000000000;
      return Math.round(num);
    }

    for (var i = 0; i < cards.length && results.length < maxN; i++) {
      var c = cards[i];
      // Skip pinned/retweeted/reply — we want original posts only.
      // Heuristic: look for "Pinned" or "reposted" markers in the header.
      var header = (c.querySelector('[data-testid="socialContext"]') || {}).textContent || '';
      // Still capture these — useful signal, just flag via text prefix.
      var textEl = c.querySelector('[data-testid="tweetText"]');
      var text = textEl ? (textEl.textContent || '').trim() : '';
      if (text.length < 3) continue;
      var link = c.querySelector('a[href*="/status/"]');
      var url = link ? link.href : undefined;
      var reply = c.querySelector('[data-testid="reply"]');
      var retweet = c.querySelector('[data-testid="retweet"]');
      var like = c.querySelector('[data-testid="like"] , [data-testid="unlike"]');
      var views = c.querySelector('a[href*="/analytics"]');
      results.push({
        text: text.slice(0, 280),
        url: url,
        replies: parseMetric(reply),
        retweets: parseMetric(retweet),
        likes: parseMetric(like),
        views: parseMetric(views),
      });
    }
    return results;
    `,
  );

  const parsedTweets = Array.isArray(tweets) ? tweets : [];
  const followers = counts && typeof counts.followers === 'number' ? counts.followers : null;
  const following = counts && typeof counts.following === 'number' ? counts.following : null;

  if (followers === null && parsedTweets.length === 0) {
    const path = await dumpIfNeeded('selectors-failed');
    return { collectedAt: new Date().toISOString(), handle, followers: null, following: null, tweets: [], domDumpPath: path };
  }

  console.log(`[Max][twitter-eng] followers=${followers ?? '?'} · following=${following ?? '?'} · tweets=${parsedTweets.length}`);
  return {
    collectedAt: new Date().toISOString(),
    handle,
    followers,
    following,
    tweets: parsedTweets,
  };
}
