/**
 * Engagement module — warmup activity via OpenTabs browser automation.
 *
 * Simulates natural account behaviour: likes, upvotes, and short comments
 * on other people's content. Run this alongside or separately from social-post
 * to make Nate Voss's accounts look like real, active participants.
 *
 * IMPORTANT: Keep interactions genuine and sparing. The goal is to establish
 * account credibility, not to spam. Defaults are conservative (2-4 actions).
 *
 * Usage (via --mode social-engage):
 *   node dist/index.js --mode social-engage                  (all platforms)
 *   node dist/index.js --mode social-engage --twitter-only
 *   node dist/index.js --mode social-engage --reddit-only
 *   node dist/index.js --mode social-engage --hn-only
 *   node dist/index.js --mode social-engage --dry-run        (log actions, don't click)
 */

import {
  openTab,
  closeTab,
  waitForElement,
  clickElement,
  executeScript,
  queryElements,
  getTabInfo,
  jitter,
  sleep,
} from './client.js';

export interface EngageConfig {
  platforms: {
    twitter: boolean;
    reddit: boolean;
    hn: boolean;
  };
  dryRun: boolean;
}

export interface EngageResult {
  twitter: { liked: number };
  reddit: { upvoted: number; commented: boolean };
  hn: { upvoted: number };
}

// ─── Twitter ────────────────────────────────────────────────────────────────

/**
 * Like 2-4 posts from the X home timeline.
 * Skips posts that are already liked (aria-label contains "Liked").
 */
export async function engageTwitter(dryRun: boolean): Promise<{ liked: number }> {
  console.log(`[Max] Engage Twitter: opening home timeline...`);
  const tab = await openTab('https://x.com/home');
  await waitForElement(tab.id, 'article[data-testid="tweet"]', 20000);
  await jitter(1500, 3000); // let feed load fully

  // Grab like buttons that haven't been clicked yet
  const likeButtons = await queryElements(
    tab.id,
    'button[data-testid="like"]',
    ['aria-label', 'data-testid'],
    10,
  ).catch(() => []);

  // Filter to unliked posts only (liked ones show "Unlike" in aria-label)
  const unliked = likeButtons.filter(
    (b) => !b.attributes['aria-label']?.toLowerCase().includes('unlike'),
  );

  const target = Math.min(unliked.length, 2 + Math.floor(Math.random() * 3)); // 2-4
  let liked = 0;

  for (let i = 0; i < target; i++) {
    await jitter(2000, 5000); // human pacing between likes
    if (dryRun) {
      console.log(`[Max] Engage Twitter: DRY RUN — would like post ${i + 1}`);
      liked++;
      continue;
    }
    try {
      // Re-query each time — DOM updates after each like
      const buttons = await queryElements(tab.id, 'button[data-testid="like"]', ['aria-label'], 10);
      const next = buttons.find((b) => !b.attributes['aria-label']?.toLowerCase().includes('unlike'));
      if (!next) break;
      await clickElement(tab.id, 'button[data-testid="like"]:not([aria-label*="nlike"])');
      liked++;
      console.log(`[Max] Engage Twitter: liked post ${liked}`);
    } catch {
      // Selector may have drifted — stop gracefully
      break;
    }
  }

  await jitter(1000, 2000);
  await closeTab(tab.id).catch(() => {});
  console.log(`[Max] Engage Twitter: done — ${liked} likes`);
  return { liked };
}

// ─── Reddit ─────────────────────────────────────────────────────────────────

// Short, generic developer-appropriate comments that fit most tech threads.
// These are intentionally neutral so they work across topics.
const REDDIT_COMMENTS = [
  'Good write-up, thanks for sharing.',
  'Interesting perspective. I ran into something similar a few months back.',
  'Appreciate the detail here — saved me some digging.',
  'This is a useful breakdown. Bookmarking it.',
  'Solid post. The point about trade-offs especially resonates.',
];

/**
 * Upvote 1-2 posts on r/programming or r/webdev and optionally leave a comment.
 * Uses old.reddit.com for stable selectors.
 */
export async function engageReddit(dryRun: boolean): Promise<{ upvoted: number; commented: boolean }> {
  // Rotate between safe, active subreddits for tech content
  const subreddits = ['programming', 'webdev', 'javascript', 'node'];
  const sub = subreddits[Math.floor(Math.random() * subreddits.length)];

  console.log(`[Max] Engage Reddit: opening r/${sub}...`);
  const tab = await openTab(`https://old.reddit.com/r/${sub}/`);
  await waitForElement(tab.id, '.thing.link', 15000);
  await jitter(1500, 3000);

  // Get the top non-stickied posts for potential commenting
  const posts = await queryElements(
    tab.id,
    '.thing.link:not(.stickied) .title a.title',
    ['href', 'data-href-url'],
    8,
  ).catch(() => []);

  let upvoted = 0;
  let commented = false;

  // Upvote 1-2 posts.
  // Old reddit upvote = <div class="arrow up login-required access-required">
  // Already-upvoted posts have class "arrow upmod" instead.
  const upvoteTarget = 1 + Math.floor(Math.random() * 2);
  const upvoteButtons = await queryElements(
    tab.id,
    'div.arrow.up',
    ['class'],
    10,
  ).catch(() => []);

  const toUpvote = upvoteButtons
    .filter((b) => !b.attributes['class']?.includes('upmod')) // skip already upvoted
    .slice(0, upvoteTarget);

  for (let i = 0; i < toUpvote.length; i++) {
    await jitter(2000, 4000);
    if (dryRun) {
      console.log(`[Max] Engage Reddit: DRY RUN — would upvote post ${i + 1}`);
      upvoted++;
      continue;
    }
    try {
      // Use executeScript to click the nth unvoted upvote arrow by index
      // (clickElement with nth-child is fragile across reddit layouts)
      const clicked = await executeScript<boolean>(tab.id, `
        (function() {
          var arrows = Array.from(document.querySelectorAll('div.arrow.up')).filter(function(el) {
            return !el.className.includes('upmod');
          });
          if (arrows[${i}]) { arrows[${i}].click(); return true; }
          return false;
        })();
      `);
      if (clicked) {
        upvoted++;
        console.log(`[Max] Engage Reddit: upvoted post ${upvoted}`);
      }
    } catch {
      break;
    }
  }

  // Comment on the first post (30% chance to keep it natural).
  // Disabled for new accounts — comments from 1-karma accounts look suspicious.
  // Re-enable once Nate's account reaches ~50 karma.
  const shouldComment = false && Math.random() < 0.3 && posts.length > 0;
  if (shouldComment) {
    const post = posts[0];
    const postUrl = post.attributes['href'] || post.attributes['data-href-url'];
    if (postUrl) {
      console.log(`[Max] Engage Reddit: navigating to post to comment...`);
      await jitter(3000, 6000);
      const comment = REDDIT_COMMENTS[Math.floor(Math.random() * REDDIT_COMMENTS.length)];

      if (dryRun) {
        console.log(`[Max] Engage Reddit: DRY RUN — would comment: "${comment}"`);
        commented = true;
      } else {
        try {
          const postTab = await openTab(
            postUrl.startsWith('http') ? postUrl : `https://old.reddit.com${postUrl}`,
          );
          await waitForElement(postTab.id, 'textarea[name="text"]', 15000);
          await jitter(1500, 3000);

          // Find the top-level comment box (first textarea on the page)
          await executeScript(postTab.id, `
            var ta = document.querySelector('textarea[name="text"]');
            if (ta) { ta.focus(); ta.value = ${JSON.stringify(comment)}; }
          `);
          await jitter(800, 1500);
          await clickElement(postTab.id, '.usertext-buttons button.save');
          await sleep(2000);
          commented = true;
          console.log(`[Max] Engage Reddit: commented — "${comment}"`);
          await closeTab(postTab.id).catch(() => {});
        } catch (e) {
          console.log(`[Max] Engage Reddit: comment failed (${(e as Error).message}) — skipping`);
        }
      }
    }
  }

  await closeTab(tab.id).catch(() => {});
  console.log(`[Max] Engage Reddit: done — ${upvoted} upvotes, commented=${commented}`);
  return { upvoted, commented };
}

// ─── Hacker News ─────────────────────────────────────────────────────────────

/**
 * Upvote 2-3 posts on HN front page.
 * HN upvote links have class "votearrow" and title="upvote".
 */
export async function engageHN(dryRun: boolean): Promise<{ upvoted: number }> {
  console.log(`[Max] Engage HN: opening front page...`);
  const tab = await openTab('https://news.ycombinator.com/');
  await waitForElement(tab.id, '.athing', 15000);
  await jitter(1500, 3000);

  const upvoteArrows = await queryElements(
    tab.id,
    'a.clicky[id^="up_"]',
    ['id', 'href'],
    15,
  ).catch(() => []);

  const target = Math.min(upvoteArrows.length, 2 + Math.floor(Math.random() * 2)); // 2-3
  let upvoted = 0;

  for (let i = 0; i < target; i++) {
    await jitter(3000, 7000); // HN is sensitive — longer pauses
    const arrow = upvoteArrows[i];
    if (!arrow) break;

    if (dryRun) {
      console.log(`[Max] Engage HN: DRY RUN — would upvote item ${arrow.attributes['id']}`);
      upvoted++;
      continue;
    }

    try {
      // HN upvote = click the anchor with id="up_ITEMID"
      const itemId = arrow.attributes['id']?.replace('up_', '');
      if (!itemId) continue;
      await clickElement(tab.id, `a#up_${itemId}`);
      upvoted++;
      console.log(`[Max] Engage HN: upvoted item ${itemId}`);

      // HN redirects to login if not logged in — check we're still on HN
      const after = await getTabInfo(tab.id);
      if (after.url.includes('login')) {
        console.log(`[Max] Engage HN: hit login wall — Nate Voss not logged into HN in Brave?`);
        break;
      }
      await sleep(500); // let the vote register before next
    } catch {
      break;
    }
  }

  await closeTab(tab.id).catch(() => {});
  console.log(`[Max] Engage HN: done — ${upvoted} upvotes`);
  return { upvoted };
}

/**
 * Run engagement across all enabled platforms with jitter between them.
 */
export async function runEngagement(config: EngageConfig): Promise<EngageResult> {
  const result: EngageResult = {
    twitter: { liked: 0 },
    reddit: { upvoted: 0, commented: false },
    hn: { upvoted: 0 },
  };

  if (config.platforms.twitter) {
    result.twitter = await engageTwitter(config.dryRun);
    if (config.platforms.reddit || config.platforms.hn) {
      const wait = Math.floor(10000 + Math.random() * 20000);
      console.log(`[Max] Engage: waiting ${Math.round(wait / 1000)}s before next platform...`);
      await sleep(wait);
    }
  }

  if (config.platforms.reddit) {
    result.reddit = await engageReddit(config.dryRun);
    if (config.platforms.hn) {
      const wait = Math.floor(10000 + Math.random() * 20000);
      console.log(`[Max] Engage: waiting ${Math.round(wait / 1000)}s before HN...`);
      await sleep(wait);
    }
  }

  if (config.platforms.hn) {
    result.hn = await engageHN(config.dryRun);
  }

  return result;
}
