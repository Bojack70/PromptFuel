/**
 * Substack Notes engagement — like and reply to other writers' Notes.
 *
 * Parallel to medium-engage.ts but targeting Substack's Notes feed (the tweet-like
 * micro-content surface). Uses the same anti-detection principles:
 *   - 3-5 notes engaged per session
 *   - 2-3 likes per session, 0-2 replies per session, hard-capped at 3/day
 *   - Long inter-note cooldowns (30-60s; 60-120s after a reply)
 *   - Dedup via data/substack-engaged.json (never engage same note twice)
 *   - Daily caps persisted on disk (restart-safe)
 *
 * SCAFFOLDING NOTICE (2026-04-22): Substack's Notes DOM is obfuscated similar
 * to Medium's — selectors below are educated guesses based on Substack conventions
 * and need live calibration. First run should always be `--dry-run`, which
 * dumps the feed DOM to data/dom-dumps/ without interacting. Inspect, adjust
 * selectors, then run live.
 *
 * Usage (via --mode substack-engage in index.ts):
 *   node dist/index.js --mode substack-engage --dry-run     (first-run DOM dump)
 *   node dist/index.js --mode substack-engage               (live, conservative defaults)
 *   node dist/index.js --mode substack-engage --verify      (1 note, no cooldowns, no dedup)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../../content/claude.js';
import { opinionsForPrompt } from '../../content/opinions.js';
import { antiPolish } from '../../content/anti-polish.js';
import {
  openTab,
  closeTab,
  waitForElement,
  executeScript,
  queryElements,
  jitter,
  sleep,
} from './client.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubstackEngageConfig {
  claudeApiKey: string;
  dataDir: string;
  dryRun: boolean;
  /** Hard caps — all optional, conservative defaults applied. */
  maxReadPerSession?: number;
  maxLikePerSession?: number;
  maxReplyPerSession?: number;
  dailyLikeCap?: number;
  dailyReplyCap?: number;
  /**
   * Verify mode — for smoke-testing selectors + LLM path.
   * Caps at 1 note, skips cooldowns, forces like+reply attempt, skips history write.
   */
  verify?: boolean;
}

export interface SubstackEngageResult {
  read: number;
  liked: number;
  replied: number;
  skipped: string[];
  dailyTotals: { likes: number; replies: number };
  /** True if the run produced a DOM dump instead of live interactions (for selector calibration). */
  dumpedDom?: boolean;
  domDumpPath?: string;
}

interface NoteRef {
  /** Stable ID extracted from the note's permalink or data-* attrs. Used for dedup. */
  id: string;
  /** Full permalink URL — used for logging and history. */
  url: string;
  /** Short preview of the note text — used for the reply prompt + logging. */
  text: string;
  /** Author handle or display name — used for logging. */
  author: string;
}

interface EngagementEntry {
  date: string; // YYYY-MM-DD (UTC)
  noteId: string;
  url: string;
  author: string;
  action: 'read' | 'like' | 'reply';
  textPreview?: string;
  reply?: string;
}

interface EngagementHistory {
  lastRunAt?: string;
  entries: EngagementEntry[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORY_FILE = 'substack-engaged.json';
const FEED_URL = 'https://substack.com/notes';
const DOM_DUMP_SUBDIR = 'dom-dumps';

const DEFAULTS = {
  maxReadPerSession: 5,
  maxLikePerSession: 3,
  maxReplyPerSession: 2,
  dailyLikeCap: 5,
  dailyReplyCap: 3,
};

// Human-like ratios — slightly higher than Medium because Notes are lighter-weight
// (easier to justify a like on a good note than a clap on an article you barely read).
const LIKE_PROBABILITY = 0.7;
const REPLY_PROBABILITY = 0.35;

// ─── History helpers ────────────────────────────────────────────────────────

function loadHistory(dataDir: string): EngagementHistory {
  const file = join(dataDir, HISTORY_FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as EngagementHistory;
  } catch {
    return { entries: [] };
  }
}

function saveHistory(dataDir: string, history: EngagementHistory): void {
  writeFileSync(join(dataDir, HISTORY_FILE), JSON.stringify(history, null, 2));
}

function todayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

function countToday(history: EngagementHistory, action: EngagementEntry['action']): number {
  const d = todayUTC();
  return history.entries.filter((e) => e.date === d && e.action === action).length;
}

function isAlreadyEngaged(history: EngagementHistory, noteId: string): boolean {
  return history.entries.some((e) => e.noteId === noteId);
}

function dumpDir(dataDir: string): string {
  const dir = join(dataDir, DOM_DUMP_SUBDIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Note discovery ─────────────────────────────────────────────────────────

interface CollectResult {
  refs: NoteRef[];
  cardCount: number;
  noIdCount: number;
  noTextCount: number;
  skippedEmpty: number;
  sampleCards: Array<{ tag: string; classes: string; textStart: string }>;
}

/**
 * Scan the Notes feed and extract candidate note refs.
 *
 * DOM structure confirmed from live dump 2026-04-22:
 *   - Note card:    <div role="article" aria-label="Note" class="...feedItem...">
 *   - Permalink:    <a href="/@<handle>/note/c-<id>" title="<timestamp>">  (the timestamp link)
 *   - Like button:  <button aria-label="Like">
 *   - Reply button: <button aria-label="Comment">
 *   - Author link:  /@<handle>  (first profile link in card)
 */
async function collectNotes(tabId: number, limit: number): Promise<CollectResult> {
  const script = `
    var seen = new Set();
    var out = [];
    var noIdCount = 0;
    var noTextCount = 0;
    var skippedEmpty = 0;
    var sampleCards = [];

    // Primary: role="article" aria-label="Note" — Substack's explicit Note container.
    var candidates = Array.from(document.querySelectorAll('[role="article"][aria-label="Note"]'));

    var cardCount = candidates.length;

    for (var i = 0; i < candidates.length && out.length < ${limit * 3}; i++) {
      var card = candidates[i];
      if (sampleCards.length < 3) {
        sampleCards.push({
          tag: card.tagName,
          classes: (card.className || '').toString().slice(0, 120),
          textStart: (card.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 150),
        });
      }

      // Extract note ID from permalink: /@<handle>/note/c-<id>
      var permalink = card.querySelector('a[href*="/note/c-"]');
      if (!permalink) { noIdCount++; continue; }
      var href = permalink.href || '';
      var idMatch = href.match(/\\/note\\/(c-\\d+)/);
      if (!idMatch) { noIdCount++; continue; }
      var noteId = idMatch[1];
      if (seen.has(noteId)) continue;

      // Extract author — the @handle link in the card (excluding the note permalink)
      var author = '';
      var authorLinks = Array.from(card.querySelectorAll('a[href]'));
      for (var j = 0; j < authorLinks.length; j++) {
        var h = authorLinks[j].getAttribute('href') || '';
        // Match /@handle (but NOT /@handle/note/... which is the permalink)
        var m = h.match(/^\\/@([\\w.\\-]+)$/);
        if (m) { author = '@' + m[1]; break; }
      }

      // Extract text — prefer paragraph elements inside the card body
      var paragraphs = Array.from(card.querySelectorAll('p'))
        .map(function(el) { return (el.textContent || '').trim(); })
        .filter(function(t) { return t.length > 20; });
      var text = paragraphs.length > 0 ? paragraphs.join(' ') : '';

      if (!text) {
        // Fallback: largest div text excluding button/link text
        var allDivs = Array.from(card.querySelectorAll('div'))
          .map(function(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); })
          .filter(function(t) { return t.length > 40 && t.length < 2000; });
        allDivs.sort(function(a, b) { return b.length - a.length; });
        text = allDivs.length > 0 ? allDivs[0] : '';
      }

      if (text.length < 20) { noTextCount++; continue; }

      seen.add(noteId);
      out.push({
        id: noteId,
        url: href,
        author: author || '(unknown)',
        text: text.slice(0, 280),
      });
    }

    return {
      refs: out,
      cardCount: cardCount,
      noIdCount: noIdCount,
      noTextCount: noTextCount,
      skippedEmpty: skippedEmpty,
      sampleCards: sampleCards,
    };
  `;
  const result = await executeScript<CollectResult | null>(tabId, script);
  if (!result) return { refs: [], cardCount: 0, noIdCount: 0, noTextCount: 0, skippedEmpty: 0, sampleCards: [] };

  console.log(
    `[Max] substack-engage: feed — ${result.cardCount} cards, ` +
      `${result.noIdCount} no-permalink, ${result.noTextCount} too-short → ${result.refs.length} candidate(s)`,
  );
  if (result.refs.length === 0 && result.sampleCards.length > 0) {
    console.log(`[Max] substack-engage: sample cards (for selector calibration):`);
    result.sampleCards.forEach((s, i) => {
      console.log(`  [${i + 1}] <${s.tag}> class="${s.classes}"`);
      console.log(`      text: ${s.textStart}`);
    });
  }
  return result;
}

// ─── Reading simulation ────────────────────────────────────────────────────

/** Scroll the feed in random increments to mimic a reader before acting. */
async function simulateFeedBrowsing(tabId: number, verify = false): Promise<void> {
  const dwellMs = verify ? 8_000 + Math.floor(Math.random() * 7_000) : 20_000 + Math.floor(Math.random() * 30_000);
  const deadline = Date.now() + dwellMs;
  while (Date.now() < deadline) {
    const chunk = 200 + Math.floor(Math.random() * 500);
    await executeScript(tabId, `window.scrollBy({ top: ${chunk}, behavior: 'smooth' });`).catch(() => {});
    await jitter(verify ? 1500 : 3000, verify ? 3500 : 7000);
  }
}

// ─── Like action ────────────────────────────────────────────────────────────

/**
 * Click the Like button on the note card identified by noteId.
 * Note card = <div role="article" aria-label="Note"> containing <a href=".../note/<id>">
 * Like button = <button aria-label="Like"> (exact match — Substack uses this verbatim).
 */
async function likeNote(tabId: number, noteId: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log(`[Max] substack-engage: DRY RUN — would like note ${noteId}`);
    return true;
  }

  const clicked = await executeScript<string>(
    tabId,
    `
    // Find the specific note card containing this noteId permalink
    var cards = Array.from(document.querySelectorAll('[role="article"][aria-label="Note"]'));
    var card = null;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('a[href*="/note/${noteId}"]')) {
        card = cards[i];
        break;
      }
    }
    if (!card) return 'no-card';

    var btn = card.querySelector('button[aria-label="Like"]');
    if (!btn) {
      // Might already be liked — Substack toggles the label
      var liked = card.querySelector('button[aria-label="Unlike"], button[aria-label="Liked"]');
      if (liked) return 'already-liked';
      return 'no-button';
    }

    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    btn.click();
    return 'clicked';
    `,
  ).catch(() => 'error');

  if (clicked === 'clicked') return true;
  console.log(`[Max] substack-engage: like failed (${clicked}) for ${noteId}`);
  return false;
}

// ─── Reply generation ──────────────────────────────────────────────────────

const REPLY_PROMPT = (noteText: string, author: string, opinionsHint: string) => `
You are Nate Voss — an indie developer who writes with dry humor and genuine observation, not corporate helpfulness. Write a short reply to leave on this Substack Note.

Author: ${author}
Note: "${noteText}"
${opinionsHint}

Hard rules — breaking any = failure:
1. React to something specific the author actually said. No generic "great note" / "agreed" / "well put".
2. 1-2 sentences, under 220 characters total.
3. No em-dashes (—). Use commas or periods instead.
4. No "As an AI". No "Great insights". No "This resonated". No "Thanks for sharing". No "Solid take".
5. Lowercase start is fine. Conversational register, not formal.
6. Don't use hashtags, emojis, or exclamation marks.
7. Add one tiny imperfection: a casual aside, a hesitation word like "kind of" or "honestly", or a mid-thought shift.
8. The worldview stances above should SHAPE your reaction, not be quoted. If none fit cleanly, ignore them rather than forcing it.

Write ONLY the reply text. No quotes, no preamble, no sign-off.
`.trim();

async function generateReply(
  apiKey: string,
  noteText: string,
  author: string,
  dataDir: string,
): Promise<string> {
  // Notes rarely sit clearly in a single content bucket (mixed topics), so use
  // tech-ai as the default injection. Count=1: replies are very short.
  const opinionsHint = opinionsForPrompt(dataDir, 'tech-ai', 1);

  let text = await generateContent(apiKey, REPLY_PROMPT(noteText, author, opinionsHint), {
    model: 'claude-haiku-4-5',
    temperature: 0.9,
    maxTokens: 100,
  });
  text = text.trim().replace(/^["']|["']$/g, '');

  const polished = antiPolish(text, 'twitter');
  if (polished.changes.length > 0) console.log(`[Max] substack-engage: anti-polish fired: ${polished.changes.join(', ')}`);
  text = polished.text;

  // Belt-and-suspenders: hard-strip any surviving em-dashes + trim
  text = text.replace(/—/g, ', ').replace(/\s{2,}/g, ' ');
  if (text.length > 220) text = text.slice(0, 217).trimEnd() + '...';
  return text;
}

// ─── Relevance filter ──────────────────────────────────────────────────────

/**
 * Pre-reply check — does Nate have legitimate standing to engage with this note?
 * Applies the "honest-take rule" from the global CLAUDE.md: don't engage where
 * you don't have genuine demographic/experiential/topical standing.
 *
 * Returns { canReply: false } for:
 *   - demographic-gated requests ("send me girls who write about...")
 *   - topics outside Nate's lived experience (medical/identity-specific)
 *   - solicitations / self-promo / product pitches
 *   - notes too short/cryptic to engage meaningfully
 *   - notes where the only honest response is generic agreement
 *
 * Cost: one extra Haiku call per note. Cheap, prevents embarrassment.
 */
async function shouldReply(
  apiKey: string,
  noteText: string,
  author: string,
): Promise<{ canReply: boolean; reason: string }> {
  const prompt = `You are screening Substack notes for Nate Voss — a male indie developer in his 30s who writes about: tech/AI, philosophy of work, grounded life reflection, dry humor/satire, and occasional flash fiction. NOT a self-help writer, NOT a lifestyle/wellness voice.

Note from ${author}: "${noteText}"

Decide whether Nate can add something genuine and on-topic here.

Say NO if:
- The note explicitly requests a demographic Nate doesn't fit (e.g., "girls who write about X", "women in tech share...", "moms only")
- The topic is outside his authentic experience (specific medical conditions, identity categories, life stages he hasn't lived)
- The note is a solicitation/self-promo/product pitch or asks for subscriptions
- The note is too short or cryptic to meaningfully engage with
- The only honest reply would be generic agreement or sympathy (low-value)
- The note is a personal vulnerability disclosure where a reply from a stranger would be unwelcome

Say YES only if Nate can add a specific observation, counter-point, or anecdote from his actual lane.

Respond EXACTLY in this format (2 lines):
VERDICT: YES or NO
REASON: <one short sentence>`;

  try {
    const resp = await generateContent(apiKey, prompt, {
      model: 'claude-haiku-4-5',
      temperature: 0.2,
      maxTokens: 80,
    });
    const verdictMatch = resp.match(/VERDICT:\s*(YES|NO)/i);
    const reasonMatch = resp.match(/REASON:\s*(.+)/i);
    const canReply = verdictMatch ? verdictMatch[1].toUpperCase() === 'YES' : false;
    const reason = reasonMatch ? reasonMatch[1].trim().slice(0, 120) : 'no-reason-given';
    return { canReply, reason };
  } catch (err) {
    // On filter failure, fail-closed (skip reply rather than post something inappropriate)
    return { canReply: false, reason: `filter-error: ${(err as Error).message}` };
  }
}

// ─── Reply posting ──────────────────────────────────────────────────────────

/**
 * Open the reply composer on a specific note and post the reply.
 * Substack Notes uses a Tiptap (ProseMirror) editor similar to its newsletter
 * editor — execCommand('insertText') should fire the input events Tiptap listens to.
 */
async function postReply(
  tabId: number,
  noteId: string,
  reply: string,
  dryRun: boolean,
): Promise<{ posted: boolean; humanAssisted: boolean }> {
  if (dryRun) {
    console.log(`[Max] substack-engage: DRY RUN — would reply: "${reply}"`);
    return { posted: true, humanAssisted: false };
  }

  // Step 1: click the Comment button on the target note
  const opened = await executeScript<string>(
    tabId,
    `
    var cards = Array.from(document.querySelectorAll('[role="article"][aria-label="Note"]'));
    var card = null;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('a[href*="/note/${noteId}"]')) {
        card = cards[i];
        break;
      }
    }
    if (!card) return 'no-card';

    var btn = card.querySelector('button[aria-label="Comment"]');
    if (!btn) return 'no-button';
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    btn.click();
    return 'clicked';
    `,
  ).catch(() => 'error');

  if (opened !== 'clicked') {
    console.log(`[Max] substack-engage: reply button open failed (${opened})`);
    return { posted: false, humanAssisted: true };
  }

  // Wait for the modal to mount + Tiptap to hydrate. Screenshot confirmed
  // Substack opens a <dialog>-style modal with an "Avatar + Name + Leave a reply..."
  // editor and Cancel/Post buttons. Needs 1.5-3s for the editor to be interactive.
  await jitter(2000, 3500);

  // Step 2a: locate the MODAL's reply editor + Post button. Tag them with data-*
  // attributes so subsequent fill/submit steps can find them deterministically
  // (same pattern medium-engage uses for the side-panel).
  //
  // Strategy:
  //   - Prefer [role="dialog"] or [aria-modal="true"] scope
  //   - Fallback: find the contenteditable whose placeholder contains "reply"
  //   - Walk up from that editor to the nearest ancestor also containing a "Post" button
  const targeted = await executeScript<{ ok: boolean; diag: string }>(
    tabId,
    `
    // Substack's reply modal contains TWO contenteditables:
    //   1. The quoted note being replied to (read-only-ish, shows original text)
    //   2. Nate's reply editor (empty, placeholder "Leave a reply...")
    // We MUST target the reply editor specifically — picking any contenteditable
    // caught the quote in the previous iteration and our paste landed there silently.
    //
    // Strategy: scan for the contenteditable whose own attributes OR nearest
    // descendant placeholder contains "reply" / "leave a reply". Fall back to
    // "last contenteditable in the modal" (the reply comes AFTER the quote).
    function getPlaceholderText(el) {
      if (!el) return '';
      var direct = el.getAttribute('data-placeholder') ||
                   el.getAttribute('aria-placeholder') ||
                   el.getAttribute('placeholder') ||
                   '';
      if (direct) return direct.toLowerCase();
      // Tiptap often renders placeholder as a child span/div with data-placeholder
      var phEl = el.querySelector('[data-placeholder], [aria-placeholder]');
      if (phEl) {
        return (phEl.getAttribute('data-placeholder') || phEl.getAttribute('aria-placeholder') || '').toLowerCase();
      }
      return '';
    }

    function isReplyEditor(el) {
      var ph = getPlaceholderText(el);
      if (ph.indexOf('reply') !== -1) return true;
      // Also check parent chain for a "Leave a reply" text node as a weaker signal
      var parent = el.parentElement;
      for (var up = 0; up < 3 && parent; up++) {
        var txt = (parent.textContent || '').toLowerCase();
        if (txt.indexOf('leave a reply') !== -1 && txt.length < 200) return true;
        parent = parent.parentElement;
      }
      return false;
    }

    function findReplyModal() {
      // Primary: explicit dialog/modal scope, find the reply editor inside
      var modals = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
        .filter(function(el) { return el.offsetParent !== null; });
      for (var i = 0; i < modals.length; i++) {
        var modal = modals[i];
        var editors = Array.from(modal.querySelectorAll('.ProseMirror, [contenteditable="true"]'))
          .filter(function(el) { return el.offsetParent !== null; });
        if (editors.length === 0) continue;

        // Prefer explicit placeholder match
        var replyEditor = editors.find(isReplyEditor);
        // Fallback: last editor in the modal (reply comes AFTER the quote)
        if (!replyEditor) replyEditor = editors[editors.length - 1];

        var postBtn = Array.from(modal.querySelectorAll('button')).find(function(b) {
          var t = (b.textContent || '').trim();
          return t === 'Post' || t === 'Reply';
        });
        if (replyEditor && postBtn) {
          var via = replyEditor === editors.find(isReplyEditor) ? 'dialog-placeholder' : 'dialog-last-editor';
          return { editor: replyEditor, postBtn: postBtn, via: via };
        }
      }

      // Fallback: no dialog role — walk up from a "reply" placeholder editor
      var allEditors = Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]'))
        .filter(function(el) { return el.offsetParent !== null; });
      for (var j = 0; j < allEditors.length; j++) {
        var ed = allEditors[j];
        if (!isReplyEditor(ed)) continue;
        var ancestor = ed.parentElement;
        for (var up = 0; up < 8 && ancestor && ancestor !== document.body; up++) {
          var post = Array.from(ancestor.querySelectorAll('button')).find(function(b) {
            var t = (b.textContent || '').trim();
            return t === 'Post' || t === 'Reply';
          });
          if (post) return { editor: ed, postBtn: post, via: 'placeholder-walkup' };
          ancestor = ancestor.parentElement;
        }
      }

      return null;
    }

    var ui = findReplyModal();
    if (!ui) {
      // Diagnostic — list visible editors + Post-ish buttons
      var editors = Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .filter(function(el) { return el.offsetParent !== null; })
        .map(function(el) {
          var p = el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || el.getAttribute('placeholder') || '';
          return 'ce[' + p.slice(0, 40) + ']';
        });
      var posts = Array.from(document.querySelectorAll('button'))
        .filter(function(b) { if (b.offsetParent === null) return false; var t = (b.textContent || '').trim(); return t === 'Post' || t === 'Reply'; })
        .map(function(b) {
          var dis = b.disabled || b.getAttribute('aria-disabled') === 'true';
          return b.textContent.trim() + (dis ? '(disabled)' : '(enabled)');
        });
      return { ok: false, diag: 'editors=' + JSON.stringify(editors) + ' posts=' + JSON.stringify(posts) };
    }

    ui.editor.setAttribute('data-pf-substack-target', '1');
    ui.postBtn.setAttribute('data-pf-substack-submit', '1');

    // Trigger Tiptap's focus via real mouse events at editor coordinates
    var rect = ui.editor.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + Math.min(20, rect.height / 2);
    ['mousedown', 'mouseup', 'click'].forEach(function(type) {
      ui.editor.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    });
    ui.editor.focus();

    return { ok: true, diag: 'via=' + ui.via };
    `,
  ).catch((): { ok: boolean; diag: string } => ({ ok: false, diag: 'script-threw' }));

  if (!targeted.ok) {
    console.log(`[Max] substack-engage: reply modal not found — ${targeted.diag}`);
    return { posted: false, humanAssisted: true };
  }
  console.log(`[Max] substack-engage: reply modal located (${targeted.diag})`);

  await jitter(600, 1000);

  // Step 2b: fill the editor via ClipboardEvent (Tiptap/ProseMirror has a
  // first-class paste handler that updates the internal model — same pattern
  // medium-engage uses for Slate). Fall back to execCommand if paste doesn't land.
  const filled = await executeScript<{ ok: boolean; textLen: number; method: string }>(
    tabId,
    `
    var editor = document.querySelector('[data-pf-substack-target="1"]');
    if (!editor) return { ok: false, textLen: 0, method: 'no-editor' };
    var text = ${JSON.stringify(reply)};

    editor.focus();

    // Place caret at start of editor
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    var method = 'none';

    // Attempt 1: ClipboardEvent('paste') — Tiptap listens for this
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', text);
      var pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      try { Object.defineProperty(pasteEvt, 'clipboardData', { value: dt }); } catch (e) {}
      editor.dispatchEvent(pasteEvt);
      method = 'paste';
    } catch (e) {}

    // Attempt 2: execCommand fallback if paste didn't land text
    if ((editor.textContent || '').trim().length === 0) {
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
      method = 'execCommand';
    }

    var textLen = (editor.textContent || '').length;
    return { ok: textLen > 0, textLen: textLen, method: method };
    `,
  ).catch(() => ({ ok: false, textLen: 0, method: 'threw' }));

  if (!filled.ok) {
    console.log(`[Max] substack-engage: fill failed — method=${filled.method} textLen=${filled.textLen}`);
    return { posted: false, humanAssisted: true };
  }
  console.log(`[Max] substack-engage: editor filled (method=${filled.method}, ${filled.textLen} chars)`);

  // Let Tiptap run its state updater + re-render (enables the Post button)
  await jitter(1500, 2500);

  // Step 3: click the marked Post button. Reject if disabled — that means the
  // editor fill didn't update Tiptap's internal model even though DOM shows text.
  const published = await executeScript<string>(
    tabId,
    `
    var btn = document.querySelector('[data-pf-substack-submit="1"]');
    if (!btn) return 'no-button';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
      // Capture state so we can tell whether fill truly landed
      var editor = document.querySelector('[data-pf-substack-target="1"]');
      var txt = editor ? (editor.textContent || '') : '';
      return 'disabled|txtLen=' + txt.length + '|preview=' + txt.slice(0, 40).replace(/\\n/g, ' ');
    }
    btn.click();
    return 'clicked';
    `,
  ).catch(() => 'threw');

  if (published === 'no-button' || published.indexOf('disabled|') === 0 || published === 'threw') {
    console.log(`[Max] substack-engage: publish failed — ${published}`);
    return { posted: false, humanAssisted: true };
  }

  // Step 4: verify the modal closed (real success signal). If modal is still
  // present, the click was registered but submit didn't go through — treat as failure.
  await sleep(3000);
  const modalClosed = await executeScript<boolean>(
    tabId,
    `
    var stillOpen = document.querySelector('[data-pf-substack-submit="1"]');
    if (!stillOpen) return true; // our tagged button is gone = modal dismissed
    // Also count hidden as closed
    return stillOpen.offsetParent === null;
    `,
  ).catch(() => false);

  if (!modalClosed) {
    console.log(`[Max] substack-engage: modal still open after Post click — reply likely did not send`);
    return { posted: false, humanAssisted: true };
  }

  return { posted: true, humanAssisted: false };
}

// ─── Dry-run DOM dump ───────────────────────────────────────────────────────

async function dumpFeedDom(tabId: number, dataDir: string): Promise<string | undefined> {
  try {
    const html = await executeScript<string>(
      tabId,
      `return (document.querySelector('main') || document.body).outerHTML.slice(0, 120000);`,
    );
    const today = todayUTC();
    const path = join(dumpDir(dataDir), `substack-notes-feed-${today}.html`);
    writeFileSync(path, typeof html === 'string' ? html : JSON.stringify(html));
    console.log(`[Max] substack-engage: DOM dump → ${path}`);
    return path;
  } catch (err) {
    console.warn('[Max] substack-engage: DOM dump failed:', (err as Error).message);
    return undefined;
  }
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function engageSubstack(config: SubstackEngageConfig): Promise<SubstackEngageResult> {
  if (config.verify) {
    console.log('[Max] substack-engage: VERIFY MODE — 1 note, no cooldowns, forced like+reply, no history write');
  }

  const caps = config.verify
    ? { maxReadPerSession: 3, maxLikePerSession: 3, maxReplyPerSession: 1, dailyLikeCap: 99, dailyReplyCap: 99 }
    : {
        maxReadPerSession: config.maxReadPerSession ?? DEFAULTS.maxReadPerSession,
        maxLikePerSession: config.maxLikePerSession ?? DEFAULTS.maxLikePerSession,
        maxReplyPerSession: config.maxReplyPerSession ?? DEFAULTS.maxReplyPerSession,
        dailyLikeCap: config.dailyLikeCap ?? DEFAULTS.dailyLikeCap,
        dailyReplyCap: config.dailyReplyCap ?? DEFAULTS.dailyReplyCap,
      };

  const history = loadHistory(config.dataDir);
  const likesToday = countToday(history, 'like');
  const repliesToday = countToday(history, 'reply');

  if (likesToday >= caps.dailyLikeCap && repliesToday >= caps.dailyReplyCap) {
    console.log(
      `[Max] substack-engage: daily caps already hit (likes=${likesToday}/${caps.dailyLikeCap}, replies=${repliesToday}/${caps.dailyReplyCap}) — skipping`,
    );
    return {
      read: 0,
      liked: 0,
      replied: 0,
      skipped: ['daily-cap-hit'],
      dailyTotals: { likes: likesToday, replies: repliesToday },
    };
  }

  console.log(`[Max] substack-engage: today so far: ${likesToday} likes, ${repliesToday} replies`);

  // Pre-session warm-up (skipped in dry-run/verify)
  if (!config.dryRun && !config.verify) {
    await jitter(15_000, 45_000);
  }

  console.log(`[Max] substack-engage: opening ${FEED_URL}...`);
  const feedTab = await openTab(FEED_URL);
  try {
    await waitForElement(feedTab.id, 'body', 20_000);
  } catch {
    console.log(`[Max] substack-engage: waitForElement(body) timed out — proceeding anyway`);
  }
  // Let the Notes feed hydrate
  await jitter(4000, 7000);

  // Scroll a bit before scanning — a real user browses before interacting
  await simulateFeedBrowsing(feedTab.id, config.verify);

  // Always drop a DOM dump on dry-run (primary first-run protocol) or when zero candidates found
  let domDumpPath: string | undefined;
  if (config.dryRun) {
    domDumpPath = await dumpFeedDom(feedTab.id, config.dataDir);
  }

  const collected = await collectNotes(feedTab.id, caps.maxReadPerSession);
  if (collected.refs.length === 0 && !config.dryRun) {
    // Zero candidates on a live run — dump the DOM so we can debug
    domDumpPath = await dumpFeedDom(feedTab.id, config.dataDir);
  }

  // On dry-run, skip all real interactions — just verify discovery works
  if (config.dryRun) {
    await closeTab(feedTab.id).catch(() => {});
    console.log(`[Max] substack-engage: DRY RUN complete — found ${collected.refs.length} candidates.`);
    if (collected.refs.length > 0) {
      console.log(`[Max] substack-engage: first 3 candidates:`);
      collected.refs.slice(0, 3).forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.author} — "${r.text.slice(0, 100)}${r.text.length > 100 ? '...' : ''}"`);
        console.log(`      id=${r.id}`);
      });
    }
    return {
      read: 0,
      liked: 0,
      replied: 0,
      skipped: [],
      dailyTotals: { likes: likesToday, replies: repliesToday },
      dumpedDom: true,
      domDumpPath,
    };
  }

  // Dedup + shuffle + cap
  const fresh = collected.refs.filter((r) => config.verify || !isAlreadyEngaged(history, r.id));
  if (fresh.length === 0) {
    await closeTab(feedTab.id).catch(() => {});
    console.log(`[Max] substack-engage: no fresh notes (filtered or already engaged)`);
    return {
      read: 0,
      liked: 0,
      replied: 0,
      skipped: ['no-fresh-notes'],
      dailyTotals: { likes: likesToday, replies: repliesToday },
      domDumpPath,
    };
  }
  const startIdx = Math.min(Math.floor(Math.random() * 2), Math.max(0, fresh.length - caps.maxReadPerSession));
  const picks = fresh.slice(startIdx, startIdx + caps.maxReadPerSession);

  const result: SubstackEngageResult = {
    read: 0,
    liked: 0,
    replied: 0,
    skipped: [],
    dailyTotals: { likes: likesToday, replies: repliesToday },
    domDumpPath,
  };

  for (let i = 0; i < picks.length; i++) {
    const note = picks[i];

    if (result.liked >= caps.maxLikePerSession && result.replied >= caps.maxReplyPerSession) {
      console.log(`[Max] substack-engage: session caps reached — stopping early`);
      break;
    }

    console.log(`[Max] substack-engage: [${i + 1}/${picks.length}] ${note.author} — "${note.text.slice(0, 60)}${note.text.length > 60 ? '...' : ''}"`);

    // Scroll the note into view first (it may be far down the feed)
    await executeScript(
      feedTab.id,
      `var a = document.querySelector('a[href*="/notes/note/${note.id}"]');
       if (a) a.scrollIntoView({ block: 'center', behavior: 'smooth' });`,
    ).catch(() => {});
    await jitter(config.verify ? 500 : 1500, config.verify ? 1500 : 3500);

    result.read++;
    history.entries.push({
      date: todayUTC(),
      noteId: note.id,
      url: note.url,
      author: note.author,
      action: 'read',
      textPreview: note.text.slice(0, 120),
    });

    // Decide like
    const dailyLikesRemaining = caps.dailyLikeCap - (likesToday + result.liked);
    const sessionLikesRemaining = caps.maxLikePerSession - result.liked;
    const canLike = dailyLikesRemaining > 0 && sessionLikesRemaining > 0;
    const willLike = canLike && (config.verify || Math.random() < LIKE_PROBABILITY);

    let liked = false;
    if (willLike) {
      liked = await likeNote(feedTab.id, note.id, config.dryRun);
      if (liked) {
        result.liked++;
        history.entries.push({
          date: todayUTC(),
          noteId: note.id,
          url: note.url,
          author: note.author,
          action: 'like',
        });
        console.log(`[Max] substack-engage: liked`);
      }
    }

    // Decide reply (only if liked succeeded, matching Medium's clap-gates-comment convention)
    const dailyRepliesRemaining = caps.dailyReplyCap - (repliesToday + result.replied);
    const sessionRepliesRemaining = caps.maxReplyPerSession - result.replied;
    const canReply = config.verify
      ? dailyRepliesRemaining > 0 && sessionRepliesRemaining > 0
      : liked && dailyRepliesRemaining > 0 && sessionRepliesRemaining > 0;
    const willReply = canReply && (config.verify || Math.random() < REPLY_PROBABILITY);

    if (willReply) {
      try {
        if (note.text.length < 40) {
          console.log(`[Max] substack-engage: note text too short (${note.text.length} chars), skipping reply`);
        } else {
          // Relevance filter — honest-take rule: skip if Nate doesn't have genuine
          // standing to engage (demographic-gated requests, off-lane topics, solicitations)
          const relevance = await shouldReply(config.claudeApiKey, note.text, note.author);
          if (!relevance.canReply) {
            console.log(`[Max] substack-engage: SKIP reply — ${relevance.reason}`);
            // Continue to next note — we still liked it (if willLike fired), that's enough
          } else {
            console.log(`[Max] substack-engage: reply OK — ${relevance.reason}`);
            const reply = await generateReply(config.claudeApiKey, note.text, note.author, config.dataDir);
            console.log(`[Max] substack-engage: generated reply — "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);

            const { posted, humanAssisted } = await postReply(feedTab.id, note.id, reply, config.dryRun);
            if (posted) {
              result.replied++;
              history.entries.push({
                date: todayUTC(),
                noteId: note.id,
                url: note.url,
                author: note.author,
                action: 'reply',
                reply,
              });
              console.log(`[Max] substack-engage: reply posted${humanAssisted ? ' (human-assisted)' : ''}`);
            } else {
              console.log(`[Max] substack-engage: reply not posted — consider finishing manually in Brave`);
            }
          }
        }
      } catch (err) {
        console.warn(`[Max] substack-engage: reply step failed — ${(err as Error).message}`);
      }
    }

    // Cooldown before next note
    if (i < picks.length - 1 && !config.verify) {
      const lower = willReply ? 60_000 : 30_000;
      const upper = willReply ? 120_000 : 60_000;
      console.log(`[Max] substack-engage: cooldown ${Math.round(lower / 1000)}-${Math.round(upper / 1000)}s...`);
      await jitter(lower, upper);
    }
  }

  await closeTab(feedTab.id).catch(() => {});

  // Save history
  if (!config.verify) {
    history.lastRunAt = new Date().toISOString();
    saveHistory(config.dataDir, history);
  } else {
    console.log('[Max] substack-engage: VERIFY — skipping history write');
  }

  result.dailyTotals = {
    likes: likesToday + result.liked,
    replies: repliesToday + result.replied,
  };

  console.log(
    `[Max] substack-engage: done — read=${result.read} liked=${result.liked} replied=${result.replied} ` +
      `| today totals: ${result.dailyTotals.likes} likes, ${result.dailyTotals.replies} replies`,
  );
  return result;
}
