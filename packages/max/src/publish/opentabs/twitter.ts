/**
 * Twitter/X posting via OpenTabs browser automation.
 *
 * x.com's compose UI is a React SPA. Key selectors:
 *   - Textbox: div[data-testid="tweetTextarea_0"][contenteditable="true"]
 *   - Tweet button: button[data-testid="tweetButtonInline"]
 *
 * Unlike Reddit there is no captcha on routine tweet composition —
 * auto-submit works from day 1 for logged-in accounts.
 */

import {
  openTab,
  waitForElement,
  executeScript,
  clickElement,
  getTabInfo,
  jitter,
  sleep,
  queryElements,
} from './client.js';

export interface TweetPost {
  text: string; // max 280 chars
  /** If true, fills the compose box but does NOT click tweet. */
  dryRun?: boolean;
}

export interface TweetResult {
  tabId: number;
  /** URL of the compose tab (or new tweet URL if detectable). */
  url: string;
}

const COMPOSE_URL = 'https://x.com/compose/post';
const TEXTBOX_SEL = 'div[data-testid="tweetTextarea_0"][contenteditable="true"]';
// tweetButton = main Post button in compose modal
// tweetButtonInline = secondary inline thread button (wrong one, don't use)
const SUBMIT_SEL = 'button[data-testid="tweetButton"]';

/**
 * Post a tweet on x.com via the logged-in Brave profile.
 * Requires the browser to be logged in at x.com.
 */
export async function postTweet(post: TweetPost): Promise<TweetResult> {
  if (!post.text?.trim()) throw new Error('Tweet text cannot be empty');
  if (post.text.length > 280) throw new Error(`Tweet is ${post.text.length} chars (max 280)`);

  console.log(`[Max] Twitter: opening compose...`);
  const tab = await openTab(COMPOSE_URL);

  // The compose modal may take a moment to render in the SPA.
  await waitForElement(tab.id, TEXTBOX_SEL, 15000).catch(async () => {
    // Selector missed — dump what's on the page so we can debug data-testid drift.
    const els = await queryElements(
      tab.id,
      '[data-testid], div[contenteditable="true"], button',
      ['data-testid', 'contenteditable', 'type'],
      40,
    ).catch(() => []);
    const found = els
      .map((e) => e.attributes['data-testid'] || e.attributes['contenteditable'])
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `Twitter: compose textbox not found within 15s. ` +
        `data-testid/contenteditable elements visible: [${found || 'none'}]. ` +
        `Is Nate Voss logged into x.com in Brave?`,
    );
  });

  await jitter(400, 900);

  // Click to focus the box first, then insert text via execCommand('insertText').
  // browser_type_text dispatches raw key events that React's synthetic event
  // system ignores on contenteditable divs — the Post button stays aria-disabled.
  // execCommand('insertText') fires the InputEvent that React's onChange handler
  // actually listens to, which enables the Post button.
  console.log(`[Max] Twitter: focusing compose box`);
  await clickElement(tab.id, TEXTBOX_SEL);
  await jitter(300, 600);

  console.log(`[Max] Twitter: inserting tweet text`);
  await executeScript(tab.id, `
    (function() {
      var el = document.querySelector('div[data-testid="tweetTextarea_0"][contenteditable="true"]');
      if (!el) throw new Error('tweetTextarea_0 not found');
      el.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(post.text)});
    })();
  `);
  // Pause for React to process the InputEvent and re-render the Post button
  await sleep(800);

  if (post.dryRun) {
    console.log(`[Max] Twitter: DRY RUN — compose box filled. Inspect Brave; submit manually if correct.`);
    return { tabId: tab.id, url: COMPOSE_URL };
  }

  await jitter(600, 1400);
  console.log(`[Max] Twitter: clicking tweet button`);
  await clickElement(tab.id, SUBMIT_SEL);

  // After posting, x.com's SPA closes the compose route and navigates to /home.
  // This can take 10–15s depending on React render cycles — poll generously.
  let after = await getTabInfo(tab.id);
  for (let i = 0; i < 15 && after.url.includes('/compose'); i++) {
    await sleep(1000);
    after = await getTabInfo(tab.id);
  }

  if (after.url.includes('/compose')) {
    // Still on compose — likely a validation error or rate limit.
    const errors = await queryElements(
      tab.id,
      '[data-testid="toast"], [role="alert"], [data-testid="tweetButtonInline"]',
      ['data-testid', 'aria-disabled'],
      10,
    ).catch(() => []);
    const errorText = errors.map((e) => e.text?.trim()).filter(Boolean).join(' | ');
    throw new Error(
      `Twitter: still on compose page after 8s. ` +
        `${errorText ? `Error(s): ${errorText}` : 'No error text found. Rate limit or disabled button?'}`,
    );
  }

  console.log(`[Max] Twitter: tweet posted — ${after.url}`);
  return { tabId: tab.id, url: after.url };
}
