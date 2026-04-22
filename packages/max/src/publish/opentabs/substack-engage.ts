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

  await jitter(1500, 3000);

  // Step 2: fill the reply editor (Tiptap ProseMirror)
  const filled = await executeScript<boolean>(
    tabId,
    `
    var editors = Array.from(document.querySelectorAll('.ProseMirror, [contenteditable="true"]'))
      .filter(function(el) { return el.offsetParent !== null; });
    // Prefer the one that just appeared (latest in DOM order is a decent heuristic for the open modal/drawer)
    var editor = editors.length > 0 ? editors[editors.length - 1] : null;
    if (!editor) return false;
    editor.click();
    editor.focus();
    var text = ${JSON.stringify(reply)};
    // Tiptap/ProseMirror: execCommand('insertText') fires the beforeinput/input events Tiptap listens to
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return (editor.textContent || '').length > 0;
    `,
  ).catch(() => false);

  if (!filled) {
    console.log(`[Max] substack-engage: reply editor fill failed`);
    return { posted: false, humanAssisted: true };
  }

  await jitter(1200, 2500);

  // Step 3: click the Reply/Post submit button
  const published = await executeScript<string | null>(
    tabId,
    `
    // Look for the submit button — typically labelled "Reply" or "Post"
    var candidates = Array.from(document.querySelectorAll('button')).filter(function(b) {
      if (b.offsetParent === null) return false;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      var t = (b.textContent || '').trim().toLowerCase();
      return t === 'reply' || t === 'post' || t === 'send';
    });
    if (candidates.length === 0) return null;
    // Prefer the last one (most recently-rendered modal button)
    var btn = candidates[candidates.length - 1];
    var label = (btn.textContent || '').trim();
    btn.click();
    return label;
    `,
  ).catch(() => null);

  if (!published) {
    return { posted: false, humanAssisted: true };
  }

  await sleep(2000);
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
    ? { maxReadPerSession: 1, maxLikePerSession: 1, maxReplyPerSession: 1, dailyLikeCap: 99, dailyReplyCap: 99 }
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
