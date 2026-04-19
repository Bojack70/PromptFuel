/**
 * Substack posting via OpenTabs browser automation.
 *
 * Two content types:
 *   Notes (short-form) — mirrors Bluesky text to Substack Notes feed. Fully automated.
 *   Newsletter (long-form) — mirrors Medium articles to Substack editor. waitForHuman=true.
 *
 * Substack uses ProseMirror for its editor. execCommand('insertText') fires the InputEvent
 * ProseMirror listens to — same pattern as Medium's Slate.js.
 *
 * Selectors: verified patterns based on Substack DOM as of 2026-04. If they drift,
 * run queryElements on the live page to find replacements.
 */

import {
  openTab,
  waitForElement,
  executeScript,
  jitter,
  sleep,
  queryElements,
  getTabInfo,
} from './client.js';

export interface SubstackNoteOptions {
  text: string;
  dryRun?: boolean;
}

export interface SubstackNoteResult {
  tabId: number;
  url: string;
}

export interface SubstackNewsletterOptions {
  title: string;
  body: string;
  dryRun?: boolean;
  /**
   * If true (default), fills editor and waits for human to review + click Publish.
   * Substack newsletter publishing must always be human-reviewed — never auto-published.
   */
  waitForHuman?: boolean;
  humanTimeoutMs?: number;
}

export interface SubstackNewsletterResult {
  tabId: number;
  submittedUrl: string;
}

const NOTES_URL = 'https://substack.com/notes';
const NEWSLETTER_URL = 'https://substack.com/publish/post/new';

/**
 * Post a short note to Substack Notes feed.
 * Content mirrors today's Bluesky post — fully automated.
 */
export async function postSubstackNote(options: SubstackNoteOptions): Promise<SubstackNoteResult> {
  if (!options.text?.trim()) throw new Error('Substack note text cannot be empty');

  console.log(`[Max] Substack Note: opening Notes feed...`);
  const tab = await openTab(NOTES_URL);

  await waitForElement(tab.id, 'div[contenteditable="true"]', 15000).catch(async () => {
    const els = await queryElements(
      tab.id,
      '[contenteditable], [role="textbox"], textarea',
      ['contenteditable', 'placeholder', 'class'],
      15,
    ).catch(() => []);
    const desc = els.map((e) => JSON.stringify(e.attributes)).join('\n  ');
    throw new Error(
      `Substack: Notes compose area not found within 15s.\n` +
      `Editable elements:\n  ${desc || 'none'}\n` +
      `Is Nate logged into substack.com in Brave?`,
    );
  });

  await jitter(500, 1000);

  // Click the compose area — Substack Notes has a "Start a note..." input at the top of the feed
  const composeFocused = await executeScript<boolean>(
    tab.id,
    `(function() {
      var el = document.querySelector('[data-placeholder*="note" i]') ||
               document.querySelector('[placeholder*="note" i]') ||
               document.querySelector('div[contenteditable="true"]');
      if (!el) return false;
      el.click();
      el.focus();
      return true;
    })();`,
  );

  if (!composeFocused) {
    throw new Error(
      'Substack: could not focus Notes compose area. ' +
      'Run --dry-run to inspect the page or verify Nate is logged in.',
    );
  }

  await sleep(400);

  if (options.dryRun) {
    console.log(`[Max] Substack Note: DRY RUN — would post: "${options.text.slice(0, 80)}..."`);
    return { tabId: tab.id, url: NOTES_URL };
  }

  console.log(`[Max] Substack Note: inserting text (${options.text.length} chars)...`);
  await executeScript(
    tab.id,
    `document.execCommand('insertText', false, ${JSON.stringify(options.text)});`,
  );
  await sleep(600);

  // Click Post button
  const postBtnClicked = await executeScript<string | null>(
    tab.id,
    `(function() {
      var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
        var t = b.textContent.trim().toLowerCase();
        return (t === 'post' || t === 'publish' || t === 'share note') && !b.disabled;
      });
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    })();`,
  );

  if (!postBtnClicked) {
    const btns = await queryElements(tab.id, 'button', ['disabled', 'aria-label', 'type'], 20).catch(() => []);
    const desc = btns.map((b) => JSON.stringify(b.attributes)).join(', ');
    throw new Error(
      `Substack: Post button not found or disabled. ` +
      `Buttons visible: [${desc || 'none'}]. ` +
      `The note text may not have registered — try --dry-run to inspect editor state.`,
    );
  }

  console.log(`[Max] Substack Note: clicked "${postBtnClicked}" — note posted`);
  await sleep(1500);

  return { tabId: tab.id, url: NOTES_URL };
}

/**
 * Create a new Substack newsletter post.
 * waitForHuman defaults to true — user always reviews and publishes manually.
 * Mirrors Medium articles — same content, different distribution layer.
 */
export async function postSubstackNewsletter(
  options: SubstackNewsletterOptions,
): Promise<SubstackNewsletterResult> {
  if (!options.title?.trim()) throw new Error('Substack newsletter title cannot be empty');
  if (!options.body?.trim()) throw new Error('Substack newsletter body cannot be empty');

  const waitForHuman = options.waitForHuman !== false; // default true
  const humanTimeoutMs = options.humanTimeoutMs ?? 10 * 60_000;

  console.log(`[Max] Substack Newsletter: opening new post editor...`);
  const tab = await openTab(NEWSLETTER_URL);

  // Wait for the ProseMirror editor to load
  const TITLE_SEL = 'h1[contenteditable="true"], [data-placeholder*="Title" i], [data-testid="title"]';

  const titleFound = await waitForElement(tab.id, TITLE_SEL, 15000).then(() => true, () => false);

  if (!titleFound) {
    await waitForElement(tab.id, 'div[contenteditable="true"]', 10000).catch(async () => {
      const els = await queryElements(
        tab.id,
        '[contenteditable], [role="textbox"]',
        ['contenteditable', 'data-placeholder', 'class'],
        20,
      ).catch(() => []);
      const desc = els.map((e) => JSON.stringify(e.attributes)).join('\n  ');
      throw new Error(
        `Substack: newsletter editor not found within 25s.\n` +
        `Editable elements:\n  ${desc || 'none'}\n` +
        `Is Nate logged into substack.com in Brave?`,
      );
    });
  }

  await jitter(500, 1000);

  // Fill title
  console.log(`[Max] Substack Newsletter: filling title — "${options.title.slice(0, 60)}"`);
  const titleFilled = await executeScript<boolean>(
    tab.id,
    `(function() {
      var el = document.querySelector('h1[contenteditable="true"]') ||
               document.querySelector('[data-placeholder*="Title" i]') ||
               document.querySelector('[data-testid="title"]') ||
               document.querySelector('div[contenteditable="true"]');
      if (!el) return false;
      el.click();
      el.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(options.title)});
      return true;
    })();`,
  );

  if (!titleFilled) {
    throw new Error('Substack: could not fill title field. Editor may not have loaded.');
  }
  await sleep(600);

  // Move focus to body — find the ProseMirror editor below the title
  const bodyFocused = await executeScript<boolean>(
    tab.id,
    `(function() {
      var title = document.querySelector('h1[contenteditable="true"]') ||
                  document.querySelector('[data-placeholder*="Title" i]');
      // ProseMirror body div
      var body = document.querySelector('.ProseMirror') ||
                 document.querySelector('[data-placeholder*="content" i]') ||
                 document.querySelector('[data-placeholder*="write" i]');
      if (!body) {
        // Fallback: second contenteditable that isn't the title
        var all = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        body = all.find(function(el) { return el !== title; }) || null;
      }
      if (!body) return false;
      body.click();
      body.focus();
      var range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    })();`,
  );

  if (!bodyFocused) {
    throw new Error(
      'Substack: could not find newsletter body editor. ' +
      'The editor may not have loaded fully — try --dry-run to inspect.',
    );
  }
  await sleep(600);

  console.log(`[Max] Substack Newsletter: filling body (${options.body.length} chars)`);
  await executeScript(
    tab.id,
    `document.execCommand('insertText', false, ${JSON.stringify(options.body)});`,
  );
  await sleep(800);

  if (options.dryRun) {
    console.log(`[Max] Substack Newsletter: DRY RUN — editor filled. Inspect Brave; publish manually.`);
    return { tabId: tab.id, submittedUrl: NEWSLETTER_URL };
  }

  // Always wait for human — Substack's publish flow has audience/paywall settings
  // that require human review. Same rule as Medium.
  console.log(`\n[Max] Substack Newsletter: editor filled. ACTION REQUIRED in Brave:`);
  console.log(`  1. Review title + body`);
  console.log(`  2. Click "Continue" or "Publish" (top right)`);
  console.log(`  3. Choose audience and complete publish settings`);
  console.log(`  Waiting up to ${Math.round(humanTimeoutMs / 60000)} minutes...\n`);

  const deadline = Date.now() + humanTimeoutMs;
  let tabInfo = await getTabInfo(tab.id);
  while (Date.now() < deadline && tabInfo.url.includes('/publish/post')) {
    await sleep(3000);
    tabInfo = await getTabInfo(tab.id).catch(() => tabInfo);
  }

  if (tabInfo.url.includes('/publish/post')) {
    throw new Error(
      `Substack: human did not complete publish within ${Math.round(humanTimeoutMs / 60000)} min.`,
    );
  }

  console.log(`[Max] Substack Newsletter: published — ${tabInfo.url}`);
  return { tabId: tab.id, submittedUrl: tabInfo.url };
}
