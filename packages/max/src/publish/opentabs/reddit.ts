/**
 * Reddit submission via OpenTabs — uses old.reddit.com because its HTML form
 * hasn't changed in 15 years and is dramatically more reliable to automate
 * than new reddit's React UI. Nate Voss stays logged in since cookies are shared.
 *
 * IMPORTANT: Reddit enforces a rate limit for new accounts (~1 post / 10 min),
 * shadowbans accounts that look automated, and some subs require karma gates.
 * r/test is a safe starting point — it's the de-facto public sandbox sub.
 */

import { openTab, waitForElement, typeText, clickElement, getTabInfo, jitter, sleep, queryElements } from './client.js';

export interface RedditSubmission {
  subreddit: string; // without "r/" prefix
  title: string;
  url?: string; // link post (mutually exclusive with text)
  text?: string; // self post (mutually exclusive with url)
  /** If true, fills the form but does NOT click submit. Useful for first-run verification. */
  dryRun?: boolean;
  /**
   * If true, fills the form and waits up to `humanTimeoutMs` for the user to
   * manually solve the captcha + click submit. Required for new/low-karma
   * accounts where Reddit forces a captcha. Polls the tab URL until it leaves
   * the /submit path, then returns the redirected post URL.
   */
  waitForHuman?: boolean;
  /** Max wait in ms when waitForHuman=true. Default 3 minutes. */
  humanTimeoutMs?: number;
}

export interface RedditResult {
  submittedUrl: string;
  tabId: number;
}

/**
 * Submit a post to a subreddit via old.reddit.com.
 * Requires the browser profile to be logged in at reddit.com.
 */
export async function submitToReddit(post: RedditSubmission): Promise<RedditResult> {
  if (!post.url && !post.text) {
    throw new Error('Reddit submission needs either a url or text');
  }
  if (post.url && post.text) {
    throw new Error('Reddit submission accepts url OR text, not both');
  }
  if (post.title.length > 300) {
    throw new Error(`Reddit title is ${post.title.length} chars (max 300)`);
  }

  // ?selftext=true forces the text-post tab; otherwise defaults to link tab.
  const submitUrl = post.text
    ? `https://old.reddit.com/r/${post.subreddit}/submit?selftext=true`
    : `https://old.reddit.com/r/${post.subreddit}/submit`;

  console.log(`[Max] Reddit: opening ${submitUrl}`);
  const tab = await openTab(submitUrl);
  // Old reddit uses <textarea name="title"> (not <input>) for the title field.
  await waitForElement(tab.id, 'textarea[name="title"]', 15000);
  await jitter(500, 1200);

  console.log(`[Max] Reddit: typing title`);
  await typeText(tab.id, 'textarea[name="title"]', post.title);
  await jitter(400, 900);

  if (post.url) {
    console.log(`[Max] Reddit: typing url`);
    await typeText(tab.id, 'input[name="url"]', post.url);
  } else if (post.text) {
    console.log(`[Max] Reddit: typing text`);
    await typeText(tab.id, 'textarea[name="text"]', post.text);
  }

  if (post.dryRun) {
    console.log(`[Max] Reddit: DRY RUN — form filled but NOT submitted. Inspect Brave, submit manually if correct.`);
    return { submittedUrl: submitUrl, tabId: tab.id };
  }

  // Human-in-loop path: skip the auto-click entirely and wait for the user to
  // solve captcha + click submit in Brave. We detect success via URL change.
  if (post.waitForHuman) {
    const timeout = post.humanTimeoutMs ?? 3 * 60_000;
    const deadline = Date.now() + timeout;
    console.log(
      `[Max] Reddit: HUMAN SUBMIT — form is filled. Solve the captcha and click submit in Brave. ` +
        `Waiting up to ${Math.round(timeout / 1000)}s for redirect...`,
    );
    let after = await getTabInfo(tab.id);
    while (Date.now() < deadline && after.url.includes('/submit')) {
      await sleep(2000);
      after = await getTabInfo(tab.id);
    }
    if (after.url.includes('/submit')) {
      throw new Error(
        `Reddit human-submit timed out after ${Math.round(timeout / 1000)}s — still on ${after.url}. ` +
          `Did you click submit? Tab stays open for inspection.`,
      );
    }
    console.log(`[Max] Reddit: submitted (human-assisted) — ${after.url}`);
    return { submittedUrl: after.url, tabId: tab.id };
  }

  await jitter(700, 1600);
  console.log(`[Max] Reddit: clicking submit`);
  // Old reddit's submit button on the self-post form: <button class="btn" name="submit" type="submit">submit</button>
  await clickElement(tab.id, 'button.btn[name="submit"][type="submit"]');

  // Reddit redirects to the post's comment page on success. Self-posts sometimes
  // take 5–8 seconds — poll instead of a fixed sleep so we catch the redirect fast
  // but also don't flake on slow responses.
  let after = await getTabInfo(tab.id);
  for (let i = 0; i < 10 && after.url.includes('/submit'); i++) {
    await sleep(1000);
    after = await getTabInfo(tab.id);
  }

  if (after.url.includes('/submit')) {
    // Still on the submit page after 10s → something blocked it.
    // Pull every possible error signal so we can diagnose.
    const [errors, recaptcha] = await Promise.all([
      queryElements(tab.id, '.error, .status, .errored, .md-container .error', ['class', 'id'], 10).catch(() => []),
      queryElements(tab.id, 'iframe[src*="recaptcha"], .g-recaptcha', ['src', 'class'], 5).catch(() => []),
    ]);
    const errorText = errors.map((e) => e.text?.trim()).filter(Boolean).join(' | ');
    const captchaVisible = recaptcha.length > 0;
    throw new Error(
      `Reddit submit failed — still on submit page after 10s. ` +
        `captcha=${captchaVisible ? 'YES' : 'no'} errors=${errorText || '(none visible)'} url=${after.url}`,
    );
  }

  console.log(`[Max] Reddit: submitted — ${after.url}`);
  return { submittedUrl: after.url, tabId: tab.id };
}
