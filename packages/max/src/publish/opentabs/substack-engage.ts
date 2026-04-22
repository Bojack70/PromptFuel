/**
 * Substack Notes engagement — like + reply to other writers' Notes.
 *
 * Fully automated after 2026-04-22 breakthrough. Previous "drafts only" design
 * was based on incomplete diagnosis; the winning recipe:
 *   1. Click Comment button (trusted CDP click) → modal opens
 *   2. Dummy keypress via pressKey with editor selector (trusted CDP keyDown+char+keyUp
 *      fires real `input` event → Substack's Post-enable hook triggers)
 *   3. Replace dummy content via Tiptap's `chain().focus().selectAll().deleteSelection()
 *      .insertContent(reply).run()` — clean DOM + internal state, Post stays enabled
 *   4. Click Post via browser_click_element (trusted CDP Input.dispatchMouseEvent)
 *   5. Verify via reply-text-in-DOM (comment count display is unreliable — rounds/caches)
 *
 * Why the double-step — OpenTabs pressKey for printable chars double-inserts each
 * character (known OpenTabs bug: sends both keyDown-with-text AND char-with-text to
 * CDP). We can't directly type reply content cleanly, but we only need ONE char to
 * trigger the input-event enable hook; then we replace via Tiptap's internal API.
 *
 * Anti-detection design:
 *   - 3-5 notes engaged per session
 *   - 2-3 likes per session, 0-2 replies per session
 *   - Long inter-note cooldowns (30-60s; 60-120s after reply)
 *   - Dedup via data/substack-engaged.json (never engage same note twice)
 *   - Daily caps persisted on disk (restart-safe)
 *   - Relevance filter (honest-take rule) runs before every reply
 *
 * Fallback: if auto-submit fails at any step (rare after verification), the reply
 * text is saved to data/substack-reply-drafts.json so no content is lost.
 *
 * Usage (via --mode substack-engage in index.ts):
 *   node dist/index.js --mode substack-engage --dry-run     (DOM dump, no actions)
 *   node dist/index.js --mode substack-engage               (live likes + replies)
 *   node dist/index.js --mode substack-engage --verify      (3 notes, no cooldowns)
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
  clickElement,
  pressKey,
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
   * Caps at 3 notes, skips cooldowns, skips history write.
   */
  verify?: boolean;
}

export interface SubstackEngageResult {
  read: number;
  liked: number;
  /** Replies successfully auto-submitted to Substack. */
  replied: number;
  /** Replies that failed to auto-submit and were saved as drafts for manual paste. */
  fallbackDrafts: number;
  skipped: string[];
  dailyTotals: { likes: number; replies: number };
  /** True if the run produced a DOM dump instead of live interactions (for selector calibration). */
  dumpedDom?: boolean;
  domDumpPath?: string;
}

/**
 * A reply draft — written ONLY when auto-submit fails at some step.
 * Kept as a safety net so generated content isn't lost. User can paste manually.
 */
export interface ReplyDraft {
  noteId: string;
  author: string;
  url: string;
  notePreview: string;
  reply: string;
  generatedAt: string;
  /** Reason auto-submit fell back to draft (e.g., "modal-open-failed", "post-click-failed"). */
  fallbackReason: string;
  /** User can flip this to true after pasting, or delete the entry. */
  posted?: boolean;
}

interface ReplyDraftsFile {
  drafts: ReplyDraft[];
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
  /** 'reply' = auto-posted; 'draft' = fallback (auto-submit failed, saved to drafts file). */
  action: 'read' | 'like' | 'reply' | 'draft';
  textPreview?: string;
  reply?: string;
}

interface EngagementHistory {
  lastRunAt?: string;
  entries: EngagementEntry[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORY_FILE = 'substack-engaged.json';
const DRAFTS_FILE = 'substack-reply-drafts.json';
const FEED_URL = 'https://substack.com/notes';
const DOM_DUMP_SUBDIR = 'dom-dumps';

const DEFAULTS = {
  maxReadPerSession: 5,
  maxLikePerSession: 3,
  maxReplyPerSession: 2,
  dailyLikeCap: 5,
  dailyReplyCap: 3,
};

// Human-like ratios — slightly higher than Medium because Notes are lighter-weight.
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

// ─── Reply drafts ──────────────────────────────────────────────────────────

function loadDrafts(dataDir: string): ReplyDraftsFile {
  const file = join(dataDir, DRAFTS_FILE);
  if (!existsSync(file)) return { drafts: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ReplyDraftsFile;
  } catch {
    return { drafts: [] };
  }
}

function saveDrafts(dataDir: string, file: ReplyDraftsFile): void {
  writeFileSync(join(dataDir, DRAFTS_FILE), JSON.stringify(file, null, 2));
}

function appendDraft(dataDir: string, draft: ReplyDraft): void {
  const file = loadDrafts(dataDir);
  // Dedup: if a draft for this noteId already exists, overwrite it (regeneration)
  const existingIdx = file.drafts.findIndex((d) => d.noteId === draft.noteId);
  if (existingIdx >= 0) file.drafts[existingIdx] = draft;
  else file.drafts.push(draft);
  saveDrafts(dataDir, file);
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
 * Click the Like button on the note identified by noteId, then verify the like
 * actually registered (not just that we clicked).
 *
 * Confirmed via live DOM diagnostic 2026-04-22:
 *   - aria-label stays "Like" even after liking (does NOT flip to "Liked"/"Unlike")
 *   - Real success signal: `.isLiked-pX6wdS` class added to button's .container-CDGars div
 *   - Secondary signal: `.active-hmQjWF` added to the button itself
 *   - Button filtering MUST use URL-permalink match, not [role="article"] ancestor
 *     (detail pages have 27+ Like buttons for sidebar/related notes)
 */
async function likeNote(tabId: number, noteId: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log(`[Max] substack-engage: DRY RUN — would like note ${noteId}`);
    return true;
  }

  // Step 1: find + click the target Like button via URL-permalink filter
  const clickResult = await executeScript<{ ok: boolean; reason: string; wasAlreadyLiked?: boolean }>(
    tabId,
    `
    var allLikes = Array.from(document.querySelectorAll('button[aria-label="Like"]'));
    var targetBtn = null;
    for (var i = 0; i < allLikes.length; i++) {
      var btn = allLikes[i];
      var el = btn;
      for (var up = 0; up < 10 && el; up++) {
        var link = el.querySelector && el.querySelector('a[href*="/note/${noteId}"]');
        if (link) { targetBtn = btn; break; }
        el = el.parentElement;
      }
      if (targetBtn) break;
    }
    if (!targetBtn) return { ok: false, reason: 'button-not-found' };

    // Already-liked detection: check .isLiked-pX6wdS on inner container
    var container = targetBtn.querySelector('.container-CDGars');
    var alreadyLiked = container && container.classList && container.classList.contains('isLiked-pX6wdS');
    if (alreadyLiked) return { ok: true, reason: 'already-liked', wasAlreadyLiked: true };

    targetBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    targetBtn.click();
    return { ok: true, reason: 'clicked', wasAlreadyLiked: false };
    `,
  ).catch((): { ok: boolean; reason: string; wasAlreadyLiked?: boolean } => ({ ok: false, reason: 'script-threw' }));

  if (!clickResult.ok) {
    console.log(`[Max] substack-engage: like failed — ${clickResult.reason}`);
    return false;
  }
  if (clickResult.wasAlreadyLiked) {
    console.log(`[Max] substack-engage: note already liked`);
    return true;
  }

  // Step 2: verify the like actually registered (React has to re-render)
  await sleep(800);
  const verified = await executeScript<boolean>(
    tabId,
    `
    var allLikes = Array.from(document.querySelectorAll('button[aria-label="Like"]'));
    for (var i = 0; i < allLikes.length; i++) {
      var btn = allLikes[i];
      var el = btn;
      for (var up = 0; up < 10 && el; up++) {
        if (el.querySelector && el.querySelector('a[href*="/note/${noteId}"]')) {
          var container = btn.querySelector('.container-CDGars');
          return !!(container && container.classList && container.classList.contains('isLiked-pX6wdS'));
        }
        el = el.parentElement;
      }
    }
    return false;
    `,
  ).catch(() => false);

  if (!verified) {
    console.log(`[Max] substack-engage: click fired but .isLiked-pX6wdS never appeared — like did NOT register`);
    return false;
  }
  return true;
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

// ─── Reply posting (auto-submit, verified 2026-04-22) ─────────────────────

/**
 * Auto-submit a reply to a specific note.
 *
 * The winning recipe after extensive diagnostics:
 *   1. Click Comment button (trusted CDP click via browser_click_element)
 *   2. Wait for modal to mount
 *   3. Tag the reply editor + Post button via executeScript
 *   4. pressKey a single dummy character with editor selector — this fires a
 *      trusted input event that enables Substack's Post button (the enable hook
 *      listens for real input events, not Tiptap's internal update event)
 *   5. Use Tiptap's chain API to replace dummy content with real reply —
 *      clean internal state + DOM, Post button stays enabled
 *   6. Click Post via browser_click_element (trusted CDP mouse click)
 *   7. Verify: modal closed + reply text visible in a <p> under Nate Voss's name
 *
 * Why not just type the reply directly — OpenTabs pressKey for printable chars
 * double-inserts each character (known bug: sends both keyDown-with-text AND
 * char-with-text to CDP). We only need ONE keystroke to satisfy the enable hook.
 *
 * Return `{ posted: true }` on success, `{ posted: false, reason }` on failure
 * (caller falls back to saving draft).
 */
async function postReply(
  tabId: number,
  noteId: string,
  reply: string,
  dryRun: boolean,
): Promise<{ posted: boolean; reason?: string }> {
  if (dryRun) {
    console.log(`[Max] substack-engage: DRY RUN — would post reply: "${reply.slice(0, 80)}"`);
    return { posted: true };
  }

  // Step 1: click Comment button for this specific note (URL-permalink filter).
  // First tag the button so browser_click_element can target it with a stable selector.
  const tagComment = await executeScript<{ ok: boolean; reason?: string }>(
    tabId,
    `
    var allComments = Array.from(document.querySelectorAll('button[aria-label="Comment"]'));
    for (var i = 0; i < allComments.length; i++) {
      var btn = allComments[i];
      var el = btn;
      for (var up = 0; up < 10 && el; up++) {
        if (el.querySelector && el.querySelector('a[href*="/note/${noteId}"]')) {
          btn.setAttribute('data-pf-comment-trigger', '1');
          btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return { ok: true };
        }
        el = el.parentElement;
      }
    }
    return { ok: false, reason: 'comment-btn-not-found' };
    `,
  ).catch((): { ok: boolean; reason?: string } => ({ ok: false, reason: 'tag-comment-threw' }));

  if (!tagComment.ok) {
    return { posted: false, reason: tagComment.reason || 'comment-btn-tag-failed' };
  }

  await jitter(400, 800);

  // Trusted click on Comment button to open modal
  await clickElement(tabId, '[data-pf-comment-trigger="1"]').catch(() => {});

  // Wait for Tiptap-ready modal
  await jitter(2000, 3500);

  // Step 2: tag the reply editor + Post button
  const targeted = await executeScript<{ ok: boolean; reason?: string }>(
    tabId,
    `
    var modal = document.querySelector('[role="dialog"][data-testid="modal"]');
    if (!modal) return { ok: false, reason: 'no-modal' };

    var editor = modal.querySelector('.tiptap.ProseMirror');
    if (!editor) return { ok: false, reason: 'no-tiptap-editor' };
    if (!editor.editor || !editor.editor.commands) return { ok: false, reason: 'no-tiptap-instance' };

    var postBtn = Array.from(modal.querySelectorAll('button')).find(function(b) {
      return (b.textContent || '').trim() === 'Post';
    });
    if (!postBtn) return { ok: false, reason: 'no-post-btn' };

    editor.setAttribute('data-pf-substack-editor', '1');
    postBtn.setAttribute('data-pf-substack-submit', '1');
    return { ok: true };
    `,
  ).catch((): { ok: boolean; reason?: string } => ({ ok: false, reason: 'target-threw' }));

  if (!targeted.ok) {
    return { posted: false, reason: targeted.reason || 'modal-target-failed' };
  }

  // Step 3: fire a single dummy keypress via CDP. This produces a REAL input
  // event on the editor (isTrusted=true), which triggers Substack's enable hook.
  // 'x' is arbitrary — any printable ASCII works. It'll double-insert to "xx"
  // (OpenTabs bug) but we overwrite in the next step.
  await pressKey(tabId, 'x', {}, '[data-pf-substack-editor="1"]').catch(() => {});

  // Let Tiptap process the input event + Substack's enable hook update state
  await jitter(400, 800);

  // Step 4: replace the dummy content with the real reply via Tiptap's chain API.
  // This updates both DOM and internal ProseMirror state atomically. Post button
  // stays enabled because the enable flag was already set by the dummy input event.
  const filled = await executeScript<{ ok: boolean; domLen: number; internalLen: number; postDisabled: boolean | null }>(
    tabId,
    `
    var editor = document.querySelector('[data-pf-substack-editor="1"]');
    if (!editor || !editor.editor) return { ok: false, domLen: 0, internalLen: 0, postDisabled: null };
    var tiptap = editor.editor;
    try {
      tiptap.chain().focus().selectAll().deleteSelection().insertContent(${JSON.stringify(reply)}).run();
    } catch (e) {
      return { ok: false, domLen: 0, internalLen: 0, postDisabled: null };
    }
    var postBtn = document.querySelector('[data-pf-substack-submit="1"]');
    var domLen = (editor.textContent || '').length;
    var internalLen = 0;
    try { internalLen = (tiptap.getText() || '').length; } catch (e) {}
    return {
      ok: domLen > 0 && internalLen > 0,
      domLen: domLen,
      internalLen: internalLen,
      postDisabled: postBtn ? postBtn.disabled : null,
    };
    `,
  ).catch(() => ({ ok: false, domLen: 0, internalLen: 0, postDisabled: null }));

  if (!filled.ok) {
    return { posted: false, reason: `fill-failed(DOM=${filled.domLen},internal=${filled.internalLen})` };
  }
  if (filled.postDisabled) {
    return { posted: false, reason: `post-still-disabled-after-fill(DOM=${filled.domLen})` };
  }
  console.log(`[Max] substack-engage: editor filled (${filled.domLen} chars, Post enabled)`);

  await jitter(500, 1000);

  // Step 5: trusted CDP click on Post button
  let clickOk = true;
  try {
    await clickElement(tabId, '[data-pf-substack-submit="1"]');
  } catch {
    clickOk = false;
  }
  if (!clickOk) {
    return { posted: false, reason: 'post-click-failed' };
  }

  // Step 6: verify via the "Reply sent" toast — the only server-confirmed success
  // signal Substack exposes client-side. Modal close alone is unreliable (closes
  // even on silent server drop). The toast appears bottom-right after Substack
  // accepts the reply, with "Reply sent" text + a "View now" link button.
  // It auto-dismisses after a few seconds, so we poll frequently.
  //
  // Verified 2026-04-22 via user screenshot: the toast is the definitive signal.
  // Without it, the reply did NOT actually post regardless of modal-close state.
  const deadline = Date.now() + 10000;
  let toastSeen = false;
  let modalGone = false;
  while (Date.now() < deadline) {
    await sleep(500);
    const state = await executeScript<{ toastSeen: boolean; modalGone: boolean }>(
      tabId,
      `
      var modal = document.querySelector('[role="dialog"][data-testid="modal"]');
      var modalGone = !modal || modal.offsetParent === null;

      // Look for the "Reply sent" toast — distinctive because it carries both
      // "Reply sent" text AND a "View now" button/link in the same container.
      var toastSeen = false;
      var candidates = Array.from(document.querySelectorAll('div, section'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.offsetParent === null) continue;
        var txt = (el.textContent || '').trim();
        if (txt.length === 0 || txt.length > 300) continue;
        // Must contain "Reply sent" AND have a "View now" child to rule out false matches
        if (txt.indexOf('Reply sent') === -1) continue;
        var viewBtn = Array.from(el.querySelectorAll('a, button')).find(function(b) {
          return (b.textContent || '').trim() === 'View now';
        });
        if (viewBtn) { toastSeen = true; break; }
      }

      return { toastSeen: toastSeen, modalGone: modalGone };
      `,
    ).catch(() => ({ toastSeen, modalGone }));
    toastSeen = toastSeen || state.toastSeen;
    modalGone = state.modalGone;
    if (toastSeen) break;
  }

  if (toastSeen) {
    console.log(`[Max] substack-engage: ✅ "Reply sent" toast confirmed`);
    return { posted: true };
  }
  if (!modalGone) {
    return { posted: false, reason: `modal-stuck-no-toast` };
  }
  // Modal closed but no toast appeared — Substack silently dropped the submission
  return { posted: false, reason: `no-reply-sent-toast-silent-drop` };
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
    console.log('[Max] substack-engage: VERIFY MODE — 3 notes, no cooldowns, no history write');
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
  // Count both auto-replied + fallback-drafted toward the daily reply cap (both consume
  // an LLM generation; we don't want to burn budget regenerating for the same notes).
  const repliesToday = countToday(history, 'reply') + countToday(history, 'draft');

  if (likesToday >= caps.dailyLikeCap && repliesToday >= caps.dailyReplyCap) {
    console.log(
      `[Max] substack-engage: daily caps already hit (likes=${likesToday}/${caps.dailyLikeCap}, replies=${repliesToday}/${caps.dailyReplyCap}) — skipping`,
    );
    return {
      read: 0,
      liked: 0,
      replied: 0,
      fallbackDrafts: 0,
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
      fallbackDrafts: 0,
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
      fallbackDrafts: 0,
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
    fallbackDrafts: 0,
    skipped: [],
    dailyTotals: { likes: likesToday, replies: repliesToday },
    domDumpPath,
  };

  for (let i = 0; i < picks.length; i++) {
    const note = picks[i];

    if (result.liked >= caps.maxLikePerSession && result.replied + result.fallbackDrafts >= caps.maxReplyPerSession) {
      console.log(`[Max] substack-engage: session caps reached — stopping early`);
      break;
    }

    console.log(`[Max] substack-engage: [${i + 1}/${picks.length}] ${note.author} — "${note.text.slice(0, 60)}${note.text.length > 60 ? '...' : ''}"`);

    // Scroll the note into view first (it may be far down the feed)
    await executeScript(
      feedTab.id,
      `var a = document.querySelector('a[href*="/note/${note.id}"]');
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

    // Decide like — fully automated, verified working
    const dailyLikesRemaining = caps.dailyLikeCap - (likesToday + result.liked);
    const sessionLikesRemaining = caps.maxLikePerSession - result.liked;
    const canLike = dailyLikesRemaining > 0 && sessionLikesRemaining > 0;
    const willLike = canLike && (config.verify || Math.random() < LIKE_PROBABILITY);

    if (willLike) {
      const liked = await likeNote(feedTab.id, note.id, config.dryRun);
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

    // Decide reply — auto-submit with drafts as fallback on failure.
    // Probability-gated like Medium's comment pattern; relevance filter gates further.
    const dailyRepliesRemaining = caps.dailyReplyCap - (repliesToday + result.replied + result.fallbackDrafts);
    const sessionRepliesRemaining = caps.maxReplyPerSession - (result.replied + result.fallbackDrafts);
    const canReply = dailyRepliesRemaining > 0 && sessionRepliesRemaining > 0;
    const willReply = canReply && (config.verify || Math.random() < REPLY_PROBABILITY);

    let didReply = false;
    if (willReply) {
      try {
        if (note.text.length < 40) {
          console.log(`[Max] substack-engage: note text too short (${note.text.length} chars), skipping reply`);
        } else {
          const relevance = await shouldReply(config.claudeApiKey, note.text, note.author);
          if (!relevance.canReply) {
            console.log(`[Max] substack-engage: SKIP reply — ${relevance.reason}`);
          } else {
            console.log(`[Max] substack-engage: reply OK — ${relevance.reason}`);
            const reply = await generateReply(config.claudeApiKey, note.text, note.author, config.dataDir);
            console.log(`[Max] substack-engage: generated reply — "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);

            // Attempt auto-submit via the hybrid dummy-keypress + Tiptap-chain recipe
            const submitResult = await postReply(feedTab.id, note.id, reply, config.dryRun);

            if (submitResult.posted) {
              result.replied++;
              didReply = true;
              if (!config.verify) {
                history.entries.push({
                  date: todayUTC(),
                  noteId: note.id,
                  url: note.url,
                  author: note.author,
                  action: 'reply',
                  reply,
                });
              }
              console.log(`[Max] substack-engage: ✅ reply auto-posted`);
            } else {
              // Auto-submit failed — fall back to saving as a draft so content isn't lost
              result.fallbackDrafts++;
              didReply = true; // counts toward cooldown decision even as a draft
              if (!config.verify) {
                appendDraft(config.dataDir, {
                  noteId: note.id,
                  author: note.author,
                  url: note.url,
                  notePreview: note.text.slice(0, 200),
                  reply,
                  generatedAt: new Date().toISOString(),
                  fallbackReason: submitResult.reason || 'unknown',
                  posted: false,
                });
                history.entries.push({
                  date: todayUTC(),
                  noteId: note.id,
                  url: note.url,
                  author: note.author,
                  action: 'draft',
                  reply,
                });
                console.log(`[Max] substack-engage: ⚠ auto-submit failed (${submitResult.reason}) — draft saved to ${DRAFTS_FILE}`);
              } else {
                console.log(`[Max] substack-engage: VERIFY ⚠ auto-submit failed (${submitResult.reason}) — draft NOT persisted`);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[Max] substack-engage: reply step threw — ${(err as Error).message}`);
      }
    }

    // Cooldown before next note — longer after a reply action (real or fallback)
    if (i < picks.length - 1 && !config.verify) {
      const lower = didReply ? 60_000 : 30_000;
      const upper = didReply ? 120_000 : 60_000;
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
    replies: repliesToday + result.replied + result.fallbackDrafts,
  };

  const fallbackHint = result.fallbackDrafts > 0 ? ` — ${result.fallbackDrafts} fallback draft(s) in data/${DRAFTS_FILE}` : '';
  console.log(
    `[Max] substack-engage: done — read=${result.read} liked=${result.liked} replied=${result.replied} drafts=${result.fallbackDrafts} ` +
      `| today: ${result.dailyTotals.likes} likes, ${result.dailyTotals.replies} replies${fallbackHint}`,
  );
  return result;
}
