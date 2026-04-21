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

  // Wait for the page to load — look for the "What's on your mind?" trigger (not contenteditable yet)
  await waitForElement(tab.id, '[placeholder], [data-placeholder], div[role="button"], div[class*="compose"], div[class*="note"]', 15000).catch(() => {});
  await sleep(1500); // let React hydrate

  // Step 1: Click the <button aria-label="New post"> trigger to open the compose modal.
  // IMPORTANT: do NOT match by text on DIV — the "What's on your mind?" text bubbles up
  // to a wrapper DIV which, when clicked, only focuses the inline editor (no Post button).
  // We need to click the actual BUTTON which opens the full compose modal.
  const triggerClicked = await executeScript<string>(
    tab.id,
    `var buttons = Array.from(document.querySelectorAll('button'));
    var trigger = buttons.find(function(b) {
      var aria = b.getAttribute('aria-label') || '';
      return aria === 'New post' || aria === 'Create note' || aria === 'Write a note';
    });
    if (!trigger) {
      trigger = buttons.find(function(b) {
        var t = (b.textContent || '').trim();
        return t === "What's on your mind?" || t === 'Start a note...' || t === 'Write a note...';
      });
    }
    if (trigger) { trigger.click(); return 'clicked:' + trigger.tagName + ' aria=' + (trigger.getAttribute('aria-label') || ''); }
    return 'not-found';`,
  );
  console.log(`[Max] Substack Note: compose trigger — ${triggerClicked}`);

  if (!triggerClicked || triggerClicked === 'not-found') {
    const dump = await executeScript<string>(
      tab.id,
      `var items = Array.from(document.querySelectorAll('[contenteditable], [role="textbox"], [placeholder], textarea')).slice(0,10);
      return items.map(function(el){ return '<'+el.tagName.toLowerCase()+' ce='+el.getAttribute('contenteditable')+' ph='+el.getAttribute('placeholder')+' class='+el.className.slice(0,40)+'>'; }).join(' | ') || 'none';`,
    ).catch(() => 'dump failed');
    throw new Error(`Substack: "What's on your mind?" trigger not found.\nEditable dump: ${dump}\nIs Nate logged into substack.com in Brave?`);
  }

  // Step 2: Substack Notes uses ProseMirror without a contenteditable HTML attribute
  // (DOM property only). Wait for .ProseMirror.FeedProseMirror to appear.
  await sleep(1500);
  const editorFound = await waitForElement(tab.id, '.ProseMirror', 8000).then(() => true, () => false);

  if (!editorFound) {
    const dump = await executeScript<string>(
      tab.id,
      `var items = Array.from(document.querySelectorAll('[contenteditable], .ProseMirror, [role="textbox"]')).slice(0,6);
      return items.map(function(el){ return '<'+el.tagName.toLowerCase()+' class="'+el.className.slice(0,40)+'">'; }).join(' | ') || 'none';`,
    ).catch(() => 'dump failed');
    throw new Error('Substack: ProseMirror editor not found after trigger click.\nDump: ' + dump);
  }

  await jitter(300, 600);

  // Step 3: Focus the first FeedProseMirror (compose area at top of feed)
  const composeFocused = await executeScript<string>(
    tab.id,
    `var el = document.querySelector('.ProseMirror.FeedProseMirror') || document.querySelector('.ProseMirror');
    if (!el) return 'not-found';
    el.click();
    el.focus();
    return 'focused:' + el.className.slice(0, 50);`,
  );
  console.log(`[Max] Substack Note: editor focus — ${composeFocused}`);

  if (!composeFocused || composeFocused === 'not-found') {
    throw new Error('Substack: could not focus ProseMirror compose area.');
  }

  await sleep(400);

  if (options.dryRun) {
    console.log(`[Max] Substack Note: DRY RUN — compose modal open, editor focused. Would post: "${options.text.slice(0, 80)}..."`);
    return { tabId: tab.id, url: NOTES_URL };
  }

  console.log(`[Max] Substack Note: inserting text via paste (${options.text.length} chars)...`);
  // ProseMirror ignores execCommand('insertText') — its internal state doesn't update, so the
  // Post button never activates. Try paste event (preferred), fall back to beforeinput.
  const insertResult = await executeScript<string>(
    tab.id,
    `var el = document.querySelector('.ProseMirror.FeedProseMirror') || document.querySelector('.ProseMirror');
    if (!el) return 'no-editor';
    el.click();
    el.focus();
    var text = ${JSON.stringify(options.text)};
    var logs = [];
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', text);
      var pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      try { Object.defineProperty(pasteEvt, 'clipboardData', { value: dt }); } catch(e) { logs.push('dp-fail:' + e.message); }
      var target = document.activeElement || el;
      var cancelled = !target.dispatchEvent(pasteEvt);
      logs.push('paste-dispatched cancelled=' + cancelled + ' target=' + target.tagName + '.' + (target.className || '').slice(0,30));
    } catch (e) { logs.push('paste-err:' + e.message); }
    // Check if paste actually worked
    var after = (el.textContent || '').slice(0, 60);
    logs.push('editor-text-after-paste="' + after + '"');
    // If empty, fall back to beforeinput + input events
    if (!after.trim()) {
      try {
        var bi = new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: text, bubbles: true, cancelable: true });
        el.dispatchEvent(bi);
        var ii = new InputEvent('input', { inputType: 'insertFromPaste', data: text, bubbles: true, cancelable: false });
        el.dispatchEvent(ii);
        logs.push('beforeinput-fallback-sent');
        logs.push('editor-text-after-bi="' + (el.textContent || '').slice(0, 60) + '"');
      } catch (e) { logs.push('bi-err:' + e.message); }
    }
    return logs.join(' | ');`,
  );
  console.log(`[Max] Substack Note: insert result — ${insertResult}`);
  await sleep(800);

  // Click Post button — fuzzy match across ALL button-like elements (no 40-item cap).
  // The compose modal's Post button may have text "Post", "Publish", or be icon-only with
  // aria-label="Post". Also searches <a> tags since Substack uses <a role="button"> in some places.
  const postBtnClicked = await executeScript<string | null>(
    tab.id,
    `var candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
    // Exclude the trigger button itself (aria-label "New post") which we already clicked
    var matches = candidates.filter(function(b) {
      var t = (b.textContent || '').trim().toLowerCase();
      var aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      var isDisabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
      if (isDisabled) return false;
      if (aria === 'new post') return false; // skip the trigger
      // Must be visible
      if (b.offsetParent === null) return false;
      return t === 'post' || t === 'publish' || t === 'share' || t === 'send' ||
             t === 'share note' || aria === 'post note' || aria === 'publish note';
    });
    if (matches.length) {
      matches[0].click();
      return (matches[0].textContent || matches[0].getAttribute('aria-label') || '').trim();
    }
    return null;`,
  );

  if (!postBtnClicked) {
    // Comprehensive diagnostic dump — focus on post-like candidates anywhere on page
    const diag = await executeScript<string>(
      tab.id,
      `var out = [];
      var pm = document.querySelector('.ProseMirror.FeedProseMirror') || document.querySelector('.ProseMirror');
      if (pm) {
        out.push('EDITOR_TEXT="' + (pm.textContent || '').slice(0, 120) + '"');
        out.push('EDITOR_VISIBLE=' + (pm.offsetParent !== null));
      }
      // Detect if a modal/dialog is open
      var dialog = document.querySelector('[role="dialog"], [aria-modal="true"], .modal, [class*="Modal"], [class*="Drawer"]');
      out.push('DIALOG=' + (dialog ? dialog.tagName + '.' + (dialog.className || '').slice(0,40) : 'none'));
      // Find ALL post-like candidates (no cap) — fuzzy substring match
      var all = Array.from(document.querySelectorAll('button, [role="button"], a'));
      var postLike = all.filter(function(b) {
        var t = (b.textContent || '').trim().toLowerCase();
        var aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (aria === 'new post') return false;
        return t.indexOf('post') >= 0 || t.indexOf('publish') >= 0 ||
               t.indexOf('send') >= 0 || t === 'share' ||
               aria.indexOf('post') >= 0 || aria.indexOf('publish') >= 0 || aria.indexOf('send') >= 0;
      });
      out.push('POST_LIKE_CANDIDATES(' + postLike.length + '):');
      postLike.slice(0, 25).forEach(function(b) {
        var t = (b.textContent || '').trim().slice(0, 40);
        var aria = b.getAttribute('aria-label') || '';
        var disabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
        var visible = b.offsetParent !== null;
        var cls = (b.className || '').slice(0, 40);
        out.push('  <' + b.tagName.toLowerCase() + ' t="' + t + '" aria="' + aria + '" d=' + disabled + ' v=' + visible + ' c="' + cls + '">');
      });
      return out.join('\\n');`,
    ).catch((e) => `diag-failed: ${e.message}`);
    throw new Error(
      `Substack: Post button not found or disabled.\n${diag}\n` +
      `If POST_LIKE_CANDIDATES is 0, the modal didn't open (trigger click was wrong).\n` +
      `If candidates exist but all disabled, we need the correct disable-check.`,
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
