/**
 * Medium story posting via OpenTabs browser automation.
 *
 * Medium's editor is Slate.js-based (contenteditable). Key approach:
 *   - Use execCommand('insertText') — same as Twitter — because raw key events
 *     are ignored by React/Slate's synthetic event system.
 *   - Title: first [data-slate-editor] or [contenteditable] in the editor
 *   - Body: second contenteditable section
 *
 * No captcha on Medium — fully automated end-to-end:
 *   fill title → fill body → click Publish → click "Publish now" in dialog
 *
 * Selectors: verified against medium.com/new-story as of 2026-04. If they
 * drift, run queryElements on the live page to find replacements.
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

export interface MediumPost {
  title: string;
  body: string; // plain text or light markdown — pasted as-is into the editor
  canonicalUrl?: string; // set in the publish dialog's "More settings" section
  /** If true, fills editor but does NOT open publish dialog. */
  dryRun?: boolean;
  /**
   * If true, auto-fills title+body then pauses for the human to complete
   * the publish dialog. Use only when testing selectors.
   * Defaults to false — Medium has no captcha, fully automated.
   */
  waitForHuman?: boolean;
  /** How long to wait for the human to complete publishing (default 5 min). */
  humanTimeoutMs?: number;
}

export interface MediumResult {
  tabId: number;
  submittedUrl: string;
}

const NEW_STORY_URL = 'https://medium.com/new-story';

/** Insert text into a Slate-based contenteditable element.
 *  Uses ClipboardEvent('paste') as primary — Slate has a first-class paste handler
 *  that updates its internal model. execCommand('insertText') only modifies the DOM
 *  and leaves Slate's model empty (verified 2026-04-20: causes Publish to stay disabled).
 */
async function insertTextIntoEditor(tabId: number, selector: string, text: string): Promise<void> {
  await executeScript(
    tabId,
    `
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Medium editor element not found: ' + ${JSON.stringify(selector)});
    el.focus();
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    var dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(text)});
    var pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    try { Object.defineProperty(pasteEvt, 'clipboardData', { value: dt }); } catch (e) {}
    el.dispatchEvent(pasteEvt);
    if (el.textContent.trim().length === 0) {
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    }
    `,
  );
}

/**
 * Fill a new Medium story with title + body, then pause for the human to
 * complete the publish dialog (set topics, canonical URL, click Publish).
 */
export async function postToMedium(post: MediumPost): Promise<MediumResult> {
  if (!post.title?.trim()) throw new Error('Medium post title cannot be empty');
  if (!post.body?.trim()) throw new Error('Medium post body cannot be empty');

  const waitForHuman = post.waitForHuman ?? false; // default false — Medium has no captcha
  const humanTimeoutMs = post.humanTimeoutMs ?? 5 * 60_000;

  console.log(`[Max] Medium: opening new story editor...`);
  const tab = await openTab(NEW_STORY_URL);

  // Wait for the editor to load — title field is the first contenteditable
  const TITLE_SEL = 'h3[data-contents="true"]';
  const TITLE_SEL_FALLBACK = '[contenteditable="true"]';

  let titleSel = TITLE_SEL;
  const titleFound = await waitForElement(tab.id, TITLE_SEL, 10000).then(
    () => true,
    () => false,
  );

  if (!titleFound) {
    // Fallback: first contenteditable on the page
    const found = await waitForElement(tab.id, TITLE_SEL_FALLBACK, 10000).catch(async () => {
      const els = await queryElements(
        tab.id,
        '[contenteditable], [data-contents], [role="textbox"]',
        ['contenteditable', 'data-contents', 'role', 'class'],
        20,
      ).catch(() => []);
      const desc = els.map((e) => JSON.stringify(e.attributes)).join('\n  ');
      throw new Error(
        `Medium: editor not found within 20s.\n` +
          `Editable elements visible:\n  ${desc || 'none'}\n` +
          `Is Nate logged into medium.com in Brave?`,
      );
    });
    titleSel = TITLE_SEL_FALLBACK;
  }

  await jitter(500, 1000);

  // --- Fill title ---
  console.log(`[Max] Medium: filling title — "${post.title.slice(0, 60)}"`);
  await clickElement(tab.id, titleSel);
  await jitter(300, 600);
  await insertTextIntoEditor(tab.id, titleSel, post.title);
  await sleep(600);

  // --- Move focus to body ---
  // Medium uses a single contenteditable div containing both h3 (title) and p (body).
  // We place the cursor AFTER the h3 node using Selection API — no separate body element needed.
  // Top-level return required (no IIFE) per OpenTabs executeScript contract.
  const bodyFocusResult = await executeScript<string>(
    tab.id,
    `var editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return 'no-editor';
    var h3 = editor.querySelector('h3');
    if (h3) {
      var range = document.createRange();
      range.setStartAfter(h3);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
      return 'after-h3';
    }
    editor.focus();
    var r2 = document.createRange();
    r2.selectNodeContents(editor);
    r2.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r2);
    return 'end-of-editor';`,
  );
  console.log(`[Max] Medium: body focus result — ${bodyFocusResult}`);

  if (!bodyFocusResult || bodyFocusResult === 'no-editor') {
    // Dump DOM using top-level return (not IIFE)
    const domDump = await executeScript<string>(
      tab.id,
      `var results = [];
      Array.from(document.querySelectorAll('[contenteditable]')).slice(0, 8).forEach(function(el) {
        results.push('<' + el.tagName.toLowerCase() + '> ce=' + el.getAttribute('contenteditable') + ' slate=' + el.getAttribute('data-slate-editor'));
      });
      return results.join(' | ') || 'none';`,
    ).catch(() => '(dump failed)');
    throw new Error(
      'Medium: could not find contenteditable editor.\nDOM dump: ' + domDump,
    );
  }
  await sleep(600);

  // --- Fill body ---
  // Paste-event approach: same as insertTextIntoEditor — Slate needs clipboardData
  // to update its internal model. Direct execCommand only modifies the DOM.
  console.log(`[Max] Medium: filling body (${post.body.length} chars)`);
  await executeScript(
    tab.id,
    `
    var dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(post.body)});
    var pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    try { Object.defineProperty(pasteEvt, 'clipboardData', { value: dt }); } catch (e) {}
    document.activeElement.dispatchEvent(pasteEvt);
    if (!document.activeElement.textContent.trim()) {
      document.execCommand('insertText', false, ${JSON.stringify(post.body)});
    }
    `,
  );
  await sleep(800);

  if (post.dryRun) {
    console.log(`[Max] Medium: DRY RUN — editor filled. Inspect Brave; publish manually if content looks correct.`);
    return { tabId: tab.id, submittedUrl: NEW_STORY_URL };
  }

  if (waitForHuman) {
    // Human-assisted fallback — useful when testing selectors or debugging.
    console.log(`\n[Max] Medium: story filled. ACTION REQUIRED in Brave:`);
    console.log(`  1. Click "Publish" (top right)`);
    console.log(`  2. Click "Publish now" in the dialog`);
    console.log(`  Waiting up to ${Math.round(humanTimeoutMs / 60000)} minutes...\n`);
    const deadline = Date.now() + humanTimeoutMs;
    let tabInfo = await getTabInfo(tab.id);
    while (Date.now() < deadline && tabInfo.url.includes('medium.com/new-story')) {
      await sleep(3000);
      tabInfo = await getTabInfo(tab.id).catch(() => tabInfo);
    }
    if (tabInfo.url.includes('medium.com/new-story')) {
      throw new Error(`Medium: human did not complete publish within ${Math.round(humanTimeoutMs / 60000)} min.`);
    }
    console.log(`[Max] Medium: published — ${tabInfo.url}`);
    return { tabId: tab.id, submittedUrl: tabInfo.url };
  }

  // --- Fully automated publish ---
  // Step 1: click the "Publish" button (top-right of editor)
  // Medium uses a button with data-action="show-prepublish" or aria-label containing "Publish"
  console.log(`[Max] Medium: clicking Publish button...`);
  const publishBtnFound = await executeScript<string | null>(
    tab.id,
    `var btn = document.querySelector('button[data-action="show-prepublish"]');
    if (!btn) {
      btn = Array.from(document.querySelectorAll('button')).find(function(b) {
        var t = b.textContent.trim();
        return t === 'Publish' || t === 'Publish story';
      }) || null;
    }
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;`,
  );

  if (!publishBtnFound) {
    const btns = await queryElements(tab.id, 'button', ['data-action', 'aria-label'], 20).catch(() => []);
    const desc = btns.map((b) => JSON.stringify(b.attributes)).join(', ');
    throw new Error(
      `Medium: Publish button not found. Buttons visible: [${desc || 'none'}]. ` +
        `Run --dry-run first to inspect the editor state.`,
    );
  }
  console.log(`[Max] Medium: clicked "${publishBtnFound}"`);

  // Step 2: wait for publish dialog, then click "Publish now"
  await sleep(1500);
  console.log(`[Max] Medium: clicking "Publish now" in dialog...`);
  const publishNowFound = await executeScript<string | null>(
    tab.id,
    `var btn = Array.from(document.querySelectorAll('button')).find(function(b) {
      var t = b.textContent.trim();
      return t === 'Publish now' || t === 'Publish' || t === 'Publish story';
    }) || null;
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;`,
  );

  if (!publishNowFound) {
    throw new Error(
      `Medium: "Publish now" button not found in publish dialog. ` +
        `The dialog may not have opened — check if the Publish button click succeeded.`,
    );
  }
  console.log(`[Max] Medium: clicked "${publishNowFound}"`);

  // Step 3: poll until URL leaves /new-story (story published and redirected)
  let after = await getTabInfo(tab.id);
  for (let i = 0; i < 15 && after.url.includes('medium.com/new-story'); i++) {
    await sleep(1000);
    after = await getTabInfo(tab.id);
  }

  if (after.url.includes('medium.com/new-story')) {
    throw new Error(
      `Medium: still on /new-story after 15s — publish may have failed. ` +
        `Check Brave for error messages in the publish dialog.`,
    );
  }

  console.log(`[Max] Medium: published — ${after.url}`);
  return { tabId: tab.id, submittedUrl: after.url };
}
