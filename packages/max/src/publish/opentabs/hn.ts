/**
 * Hacker News submission via OpenTabs browser automation.
 *
 * HN's submit form is simple server-rendered HTML:
 *   input[name="title"], input[name="url"], textarea[name="text"],
 *   input[type="submit"][value="submit"]
 *
 * Use submitHN for link posts, submitHNText for Ask HN / Show HN style text posts.
 */

import { openTab, waitForElement, typeText, clickElement, getTabInfo, jitter, sleep } from './client.js';

export interface HNSubmission {
  title: string;
  url?: string; // for link posts
  text?: string; // for text posts (mutually exclusive with url)
  /** If true, fills the form but does NOT click submit. Useful for first-run verification. */
  dryRun?: boolean;
}

export interface HNResult {
  submittedUrl: string;
  tabId: number;
  itemId?: string;
}

/**
 * Submit a post to Hacker News. Requires user to be logged in
 * at https://news.ycombinator.com in the connected browser profile.
 */
export async function submitToHN(post: HNSubmission): Promise<HNResult> {
  if (!post.url && !post.text) {
    throw new Error('HN submission needs either a url or text');
  }
  if (post.url && post.text) {
    throw new Error('HN submission accepts url OR text, not both');
  }
  if (post.title.length > 80) {
    throw new Error(`HN title is ${post.title.length} chars (max 80)`);
  }

  console.log(`[Max] HN: opening submit page...`);
  const tab = await openTab('https://news.ycombinator.com/submit');
  await waitForElement(tab.id, 'input[name="title"]', 15000);
  await jitter(400, 900); // human-like settle before typing

  console.log(`[Max] HN: typing title`);
  await typeText(tab.id, 'input[name="title"]', post.title);
  await jitter(300, 700);

  if (post.url) {
    console.log(`[Max] HN: typing url`);
    await typeText(tab.id, 'input[name="url"]', post.url);
  } else if (post.text) {
    console.log(`[Max] HN: typing text`);
    await typeText(tab.id, 'textarea[name="text"]', post.text);
  }

  if (post.dryRun) {
    console.log(`[Max] HN: DRY RUN — form filled but NOT submitted. Inspect Brave, then submit manually if it looks right.`);
    return { submittedUrl: 'https://news.ycombinator.com/submit', tabId: tab.id };
  }

  await jitter(600, 1400);
  console.log(`[Max] HN: clicking submit`);
  await clickElement(tab.id, 'input[type="submit"][value="submit"]');

  // After submit, HN redirects to /newest or shows the item. Give it time.
  await sleep(2500);

  const after = await getTabInfo(tab.id);
  const itemMatch = after.url.match(/item\?id=(\d+)/);

  if (after.url.includes('/submit')) {
    throw new Error(`HN submit appears to have failed — still on submit page. Current URL: ${after.url}`);
  }

  console.log(`[Max] HN: submitted — ${after.url}`);
  return {
    submittedUrl: after.url,
    tabId: tab.id,
    itemId: itemMatch?.[1],
  };
}
