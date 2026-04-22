/**
 * Substack Notes engagement — like other writers' Notes + generate reply DRAFTS
 * for manual paste.
 *
 * Likes are fully automated. REPLIES ARE DRAFTS ONLY — the automated submit
 * path does not work (see limitations below). Replies that pass the relevance
 * filter are generated and saved to data/substack-reply-drafts.json for the
 * user to review and paste manually.
 *
 * Anti-detection design (likes only — drafts are offline):
 *   - 3-5 notes read per session
 *   - 2-3 likes per session
 *   - Long inter-note cooldowns (30-60s)
 *   - Dedup via data/substack-engaged.json (never like same note twice)
 *   - Daily caps persisted on disk (restart-safe)
 *
 * Why replies are drafts only (verified 2026-04-22 via live DOM + event trace):
 *   Substack's Tiptap editor listens to `paste` events with isTrusted=true,
 *   which only fire from real OS-level Cmd+V. Our tooling stack:
 *     - ClipboardEvent('paste')    → isTrusted=false → Tiptap rejects
 *     - document.execCommand       → fires input events, no paste → Tiptap rejects
 *     - editor.commands.insertContent → updates internal state but Post button
 *                                      stays disabled (enable hook watches paste)
 *     - OpenTabs browser_press_key  → no keyboard events reach the page at all
 *   The only working path requires real OS keyboard events (AppleScript) or
 *   Chrome DevTools Protocol (which OpenTabs does not expose).
 *
 * Usage (via --mode substack-engage in index.ts):
 *   node dist/index.js --mode substack-engage --dry-run     (DOM dump, no actions)
 *   node dist/index.js --mode substack-engage               (live likes + drafts)
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
  maxDraftsPerSession?: number;
  dailyLikeCap?: number;
  dailyDraftCap?: number;
  /**
   * Verify mode — for smoke-testing selectors + LLM path.
   * Caps at 3 notes, skips cooldowns, skips history write.
   */
  verify?: boolean;
}

export interface SubstackEngageResult {
  read: number;
  liked: number;
  /** Reply drafts saved to data/substack-reply-drafts.json (not auto-posted). */
  draftsGenerated: number;
  skipped: string[];
  dailyTotals: { likes: number; draftsGenerated: number };
  /** True if the run produced a DOM dump instead of live interactions (for selector calibration). */
  dumpedDom?: boolean;
  domDumpPath?: string;
}

/** A generated reply draft awaiting manual paste to Substack. */
export interface ReplyDraft {
  noteId: string;
  author: string;
  url: string;
  notePreview: string;
  reply: string;
  generatedAt: string;
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
  /** 'draft' replaces the old 'reply' — we never auto-post, just generate drafts. */
  action: 'read' | 'like' | 'draft';
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
  /** Cap on reply-draft generation per session (offline — no anti-detection concern). */
  maxDraftsPerSession: 2,
  dailyLikeCap: 5,
  /** Cap on reply-draft generation per day (limits LLM spend on drafts you may not use). */
  dailyDraftCap: 5,
};

// Like probability (no reply probability — we always generate drafts if relevance
// filter passes, since drafts are free to discard).
const LIKE_PROBABILITY = 0.7;

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
    ? { maxReadPerSession: 3, maxLikePerSession: 3, maxDraftsPerSession: 3, dailyLikeCap: 99, dailyDraftCap: 99 }
    : {
        maxReadPerSession: config.maxReadPerSession ?? DEFAULTS.maxReadPerSession,
        maxLikePerSession: config.maxLikePerSession ?? DEFAULTS.maxLikePerSession,
        maxDraftsPerSession: config.maxDraftsPerSession ?? DEFAULTS.maxDraftsPerSession,
        dailyLikeCap: config.dailyLikeCap ?? DEFAULTS.dailyLikeCap,
        dailyDraftCap: config.dailyDraftCap ?? DEFAULTS.dailyDraftCap,
      };

  const history = loadHistory(config.dataDir);
  const likesToday = countToday(history, 'like');
  const draftsToday = countToday(history, 'draft');

  if (likesToday >= caps.dailyLikeCap && draftsToday >= caps.dailyDraftCap) {
    console.log(
      `[Max] substack-engage: daily caps already hit (likes=${likesToday}/${caps.dailyLikeCap}, drafts=${draftsToday}/${caps.dailyDraftCap}) — skipping`,
    );
    return {
      read: 0,
      liked: 0,
      draftsGenerated: 0,
      skipped: ['daily-cap-hit'],
      dailyTotals: { likes: likesToday, draftsGenerated: draftsToday },
    };
  }

  console.log(`[Max] substack-engage: today so far: ${likesToday} likes, ${draftsToday} drafts`);

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
      draftsGenerated: 0,
      skipped: [],
      dailyTotals: { likes: likesToday, draftsGenerated: draftsToday },
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
      draftsGenerated: 0,
      skipped: ['no-fresh-notes'],
      dailyTotals: { likes: likesToday, draftsGenerated: draftsToday },
      domDumpPath,
    };
  }
  const startIdx = Math.min(Math.floor(Math.random() * 2), Math.max(0, fresh.length - caps.maxReadPerSession));
  const picks = fresh.slice(startIdx, startIdx + caps.maxReadPerSession);

  const result: SubstackEngageResult = {
    read: 0,
    liked: 0,
    draftsGenerated: 0,
    skipped: [],
    dailyTotals: { likes: likesToday, draftsGenerated: draftsToday },
    domDumpPath,
  };

  for (let i = 0; i < picks.length; i++) {
    const note = picks[i];

    if (result.liked >= caps.maxLikePerSession && result.draftsGenerated >= caps.maxDraftsPerSession) {
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

    // Decide reply DRAFT generation. Drafts are saved to data/substack-reply-drafts.json
    // for manual paste — automated submission is not possible (see file header).
    // No like-gate here (drafts are offline, not platform actions).
    const dailyDraftsRemaining = caps.dailyDraftCap - (draftsToday + result.draftsGenerated);
    const sessionDraftsRemaining = caps.maxDraftsPerSession - result.draftsGenerated;
    const canDraft = dailyDraftsRemaining > 0 && sessionDraftsRemaining > 0;

    if (canDraft) {
      try {
        if (note.text.length < 40) {
          console.log(`[Max] substack-engage: note text too short (${note.text.length} chars), skipping draft`);
        } else {
          const relevance = await shouldReply(config.claudeApiKey, note.text, note.author);
          if (!relevance.canReply) {
            console.log(`[Max] substack-engage: SKIP draft — ${relevance.reason}`);
          } else {
            console.log(`[Max] substack-engage: draft OK — ${relevance.reason}`);
            const reply = await generateReply(config.claudeApiKey, note.text, note.author, config.dataDir);
            console.log(`[Max] substack-engage: generated draft — "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);

            // Save draft to disk for manual paste — verify mode skips persistence
            if (!config.verify) {
              appendDraft(config.dataDir, {
                noteId: note.id,
                author: note.author,
                url: note.url,
                notePreview: note.text.slice(0, 200),
                reply,
                generatedAt: new Date().toISOString(),
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
              console.log(`[Max] substack-engage: draft saved to ${DRAFTS_FILE}`);
            } else {
              console.log(`[Max] substack-engage: VERIFY — draft generated but not persisted`);
            }
            result.draftsGenerated++;
          }
        }
      } catch (err) {
        console.warn(`[Max] substack-engage: draft step failed — ${(err as Error).message}`);
      }
    }

    // Cooldown before next note (likes only — drafts are offline so no rate-limit concern)
    if (i < picks.length - 1 && !config.verify) {
      const lower = 30_000;
      const upper = 60_000;
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
    draftsGenerated: draftsToday + result.draftsGenerated,
  };

  console.log(
    `[Max] substack-engage: done — read=${result.read} liked=${result.liked} drafts=${result.draftsGenerated} ` +
      `| today: ${result.dailyTotals.likes} likes, ${result.dailyTotals.draftsGenerated} drafts ` +
      `(paste drafts manually from data/${DRAFTS_FILE})`,
  );
  return result;
}
