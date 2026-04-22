/**
 * Substack engagement scraper — pulls subscriber count + per-post stats +
 * recent-note engagement from Nate's publisher dashboard via OpenTabs.
 *
 * Local-only (requires logged-in Brave). First-run protocol: dry-run once,
 * adjust selectors from the DOM dump.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openTab, navigateTab, waitForElement, executeScript } from '../publish/opentabs/client.js';

export interface SubstackPostStats {
  title: string;
  url?: string;
  views: number;
  opens: number;
  likes: number;
  comments: number;
}

export interface SubstackNoteStats {
  textPreview: string;
  likes: number;
  replies: number;
  restacks: number;
  url?: string;
}

export interface SubstackEngagement {
  collectedAt: string;
  handle: string;
  subscribers: number | null;
  freeSubscribers: number | null;
  paidSubscribers: number | null;
  posts: SubstackPostStats[];
  notes: SubstackNoteStats[];
  domDumpPath?: string;
}

export interface CollectOptions {
  handle: string;          // e.g. "natevoss" (subdomain)
  dataDir: string;
  dryRun?: boolean;
}

function dumpDir(dataDir: string): string {
  const dir = join(dataDir, 'dom-dumps');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fetchSubstackEngagement(opts: CollectOptions): Promise<SubstackEngagement> {
  const { handle, dataDir, dryRun = false } = opts;
  const today = new Date().toISOString().split('T')[0];
  const publishBase = `https://${handle}.substack.com/publish`;

  console.log('[Max][substack-eng] Opening Substack publisher dashboard...');
  const tab = await openTab(publishBase + '/home');
  await navigateTab(tab.id, publishBase + '/home');

  try {
    await waitForElement(tab.id, 'body', 15000);
  } catch {
    console.warn('[Max][substack-eng] waitForElement timed out but proceeding anyway');
  }
  await new Promise((r) => setTimeout(r, 5000));

  const dumpIfNeeded = async (reason: string, label: string): Promise<string | undefined> => {
    try {
      const html = await executeScript<string>(
        tab.id,
        `return (document.querySelector('main') || document.body).outerHTML.slice(0, 80000);`,
      );
      const path = join(dumpDir(dataDir), `substack-${label}-${today}.html`);
      writeFileSync(path, typeof html === 'string' ? html : JSON.stringify(html));
      console.log(`[Max][substack-eng] DOM dump (${reason}) → ${path}`);
      return path;
    } catch (err) {
      console.warn('[Max][substack-eng] DOM dump failed:', (err as Error).message);
      return undefined;
    }
  };

  if (dryRun) {
    const path = await dumpIfNeeded('dry-run', 'home');
    return { collectedAt: new Date().toISOString(), handle, subscribers: null, freeSubscribers: null, paidSubscribers: null, posts: [], notes: [], domDumpPath: path };
  }

  // --- Subscriber count ---
  // Publisher home usually shows a big "N subscribers" widget or a count in the top bar.
  let subscribers: number | null = null;
  try {
    const s = await executeScript<number | null>(
      tab.id,
      `
      var bodyText = document.body.textContent || '';
      // Detect onboarding "get your first N subscribers" → real count is 0
      if (/get your first \\d+ subscribers/i.test(bodyText)) return 0;
      // Look for standalone "N subscribers" or "N subscriber" labels
      var all = Array.from(document.querySelectorAll('a, span, div, h1, h2, h3')).map(function(n) {
        return (n.textContent || '').trim();
      });
      for (var i = 0; i < all.length; i++) {
        var m = all[i].match(/^([\\d,]+)\\s+subscribers?$/i);
        if (m) return parseInt(m[1].replace(/,/g, ''), 10);
      }
      // Fallback: number directly before "subscribers" in body text (skip if inside "first N")
      var matches = bodyText.matchAll(/([\\d,]+)\\s+subscribers/gi);
      for (var match of matches) {
        var context = bodyText.slice(Math.max(0, bodyText.indexOf(match[0]) - 20), bodyText.indexOf(match[0]));
        if (/first/i.test(context)) continue;
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
      return null;
      `,
    );
    subscribers = typeof s === 'number' ? s : null;
  } catch (err) {
    console.warn('[Max][substack-eng] subscriber fetch failed:', (err as Error).message);
  }

  // --- Posts stats ---
  let posts: SubstackPostStats[] = [];
  try {
    await navigateTab(tab.id, publishBase + '/posts');
    await new Promise((r) => setTimeout(r, 3000));
    const parsed = await executeScript<SubstackPostStats[]>(
      tab.id,
      `
      // Post rows usually have a title link + a row of numeric stats.
      var rows = Array.from(document.querySelectorAll('[data-testid="post-row"], tr, [role="row"], .post-row, li'));
      var results = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var titleEl = row.querySelector('a[href*="/p/"], h3, h4, strong');
        if (!titleEl) continue;
        var title = (titleEl.textContent || '').trim();
        if (title.length < 3) continue;
        var text = (row.textContent || '').replace(/\\n/g, ' ');
        // Extract numbers from the row — order tends to be views, opens, likes, comments
        var nums = (text.match(/\\d[\\d,]*(?=\\s|$)/g) || []).map(function(n) { return parseInt(n.replace(/,/g, ''), 10); });
        if (nums.length === 0) continue;
        results.push({
          title: title,
          url: titleEl.href || undefined,
          views: nums[0] || 0,
          opens: nums[1] || 0,
          likes: nums[2] || 0,
          comments: nums[3] || 0,
        });
      }
      return results.slice(0, 30);
      `,
    );
    posts = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Max][substack-eng] posts fetch failed:', (err as Error).message);
  }

  // --- Notes stats ---
  // Scraping Nate's own notes feed to see engagement on recent notes.
  let notes: SubstackNoteStats[] = [];
  try {
    await navigateTab(tab.id, `https://substack.com/@${handle}/notes`);
    await new Promise((r) => setTimeout(r, 3000));
    const parsed = await executeScript<SubstackNoteStats[]>(
      tab.id,
      `
      // Note cards on a profile page
      var cards = Array.from(document.querySelectorAll('[data-component-name="NoteItem"], [class*="note"], article'));
      var results = [];
      for (var i = 0; i < cards.length && results.length < 15; i++) {
        var card = cards[i];
        var text = (card.textContent || '').trim();
        if (text.length < 20) continue;
        var nums = (text.match(/\\b\\d+\\b/g) || []).map(Number);
        // heuristic: last 3 numbers in the card are likes/replies/restacks
        var tail = nums.slice(-3);
        results.push({
          textPreview: text.slice(0, 120),
          likes: tail[0] || 0,
          replies: tail[1] || 0,
          restacks: tail[2] || 0,
        });
      }
      return results;
      `,
    );
    notes = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[Max][substack-eng] notes fetch failed:', (err as Error).message);
  }

  if (subscribers === null && posts.length === 0 && notes.length === 0) {
    const path = await dumpIfNeeded('all-selectors-failed', 'home');
    return { collectedAt: new Date().toISOString(), handle, subscribers: null, freeSubscribers: null, paidSubscribers: null, posts: [], notes: [], domDumpPath: path };
  }

  console.log(`[Max][substack-eng] subs=${subscribers ?? '?'} · posts=${posts.length} · notes=${notes.length}`);
  return {
    collectedAt: new Date().toISOString(),
    handle,
    subscribers,
    freeSubscribers: null,
    paidSubscribers: null,
    posts,
    notes,
  };
}
