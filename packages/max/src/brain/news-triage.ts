/**
 * News triage — weekly Claude-driven classification of the news corpus into
 * "eligible angles" (things Nate can honestly post about) and "ineligible"
 * (things that require firsthand testing to have an honest take).
 *
 * The honest-take rule is LOAD-BEARING:
 *   • OK: observable second-order effects, pricing/availability shifts,
 *     discourse patterns, meta-commentary on how the industry is reacting,
 *     pattern recognition across announcements.
 *   • NOT OK without firsthand use: quality, performance, suitability,
 *     whether a product/model/framework is "good".
 *
 * Claude tags each eligible angle with an angle-type so the content prompt
 * can encode the right constraints.
 *
 * Runs in weekly brain. Output injected into current_event content
 * generation + dashboard visibility.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../content/claude.js';
import { loadNewsLog, type NewsEntry } from '../analytics/news.js';

const FILE = 'news-angles.json';

export type AngleType =
  | 'observable'       // second-order effects we can measure
  | 'pricing'          // price/availability shifts
  | 'discourse'        // what the community is saying
  | 'meta'             // commentary on the reaction itself
  | 'pattern'          // multi-event pattern recognition
  | 'cultural';        // non-tech viral moment Nate has a take on

export interface EligibleAngle {
  event: string;        // short description of the event
  sourceUrls: string[]; // 1-3 articles that establish the event
  angle: AngleType;
  hook: string;         // 1-sentence suggested angle Nate could take
  salience: 'high' | 'medium' | 'low';  // how prominent this event is this week
}

export interface IneligibleEvent {
  event: string;
  reason: string;       // why Nate shouldn't post about it without firsthand use
}

export interface NewsAngles {
  generatedAt: string;
  weekOf: string;
  entriesAnalysed: number;
  eligibleAngles: EligibleAngle[];
  ineligible: IneligibleEvent[];
}

export function loadNewsAngles(dataDir: string): NewsAngles | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function buildPrompt(entries: NewsEntry[]): string {
  // Sort most recent first, then by HN score as tiebreaker
  const sorted = entries.slice().sort((a, b) => {
    const ad = a.pubDate ? Date.parse(a.pubDate) : Date.parse(a.date);
    const bd = b.pubDate ? Date.parse(b.pubDate) : Date.parse(b.date);
    if (bd !== ad) return bd - ad;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  const sample = sorted.slice(0, 80);

  const lines = sample
    .map((e) => `- [${e.source}${e.score ? `:${e.score}↑` : ''}] "${e.title}" ${e.excerpt ? `— ${e.excerpt.slice(0, 180)}` : ''} (${e.url})`)
    .join('\n');

  return `You are analysing the last week of news to help an indie dev (Nate Voss) decide what he can honestly write about versus what he should skip.

THE HONEST-TAKE RULE (non-negotiable):
- Nate CAN post about:
  • observable: second-order effects he can measure ("Claude had an outage today — my error dashboards showed X")
  • pricing: price/availability/policy shifts ("OpenAI cut pricing 30% again")
  • discourse: what the community is collectively saying (the shape of the discussion)
  • meta: commentary on the reaction itself ("everyone's racing to opine on model X before using it")
  • pattern: multi-event pattern recognition ("this is the 4th launch this year where demos impressed and real-world reviews came back mixed")
  • cultural: non-tech viral moments where Nate has genuine personal opinion
- Nate CANNOT post about (mark as ineligible):
  • quality/performance/suitability claims about new models, frameworks, products, tools — these require firsthand testing
  • opinions on whether something is "good" or "the best" or "a game changer"

Classify events from the corpus below. Be STRICT with ineligibility — when in doubt, mark it ineligible. Ineligible events are valuable to surface so Nate doesn't accidentally write about them.

Produce:
- eligibleAngles: 3-6 high-signal angles Nate can honestly take. Each has the event description, 1-3 source URLs, the angle-type, a specific 1-sentence hook suggestion, and salience level.
- ineligible: 2-5 events Nate should SKIP and why (e.g., "New Claude 5 released — quality claims would require firsthand testing").

NEWS CORPUS (last 7 days, freshest first):

${lines}

Respond in EXACTLY this JSON format, nothing else:
{
  "eligibleAngles": [
    {
      "event": "short event description",
      "sourceUrls": ["https://..."],
      "angle": "observable|pricing|discourse|meta|pattern|cultural",
      "hook": "1-sentence suggested angle in Nate's voice",
      "salience": "high|medium|low"
    }
  ],
  "ineligible": [
    { "event": "...", "reason": "..." }
  ]
}`;
}

/**
 * Run weekly triage. Needs at least 20 entries in the corpus to produce
 * useful output; skips quietly otherwise.
 */
export async function triageNews(
  claudeApiKey: string,
  dataDir: string,
  windowDays = 7,
): Promise<NewsAngles | null> {
  const log = loadNewsLog(dataDir);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const recent = log.entries.filter((e) => e.date >= cutoffStr);

  if (recent.length < 20) {
    console.log(`[Max][news-triage] Only ${recent.length} entries in last ${windowDays} days — need ≥20. Skipping.`);
    return null;
  }

  console.log(`[Max][news-triage] Triaging ${recent.length} news entries...`);
  const prompt = buildPrompt(recent);

  const raw = await generateContent(claudeApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 2000,
    model: 'claude-sonnet-4-6',
  });

  let parsed: { eligibleAngles?: EligibleAngle[]; ineligible?: IneligibleEvent[] };
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn('[Max][news-triage] Parse failed:', (err as Error).message);
    return null;
  }

  const monday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(now);
    m.setUTCDate(now.getUTCDate() + diff);
    return m.toISOString().split('T')[0];
  })();

  const angles: NewsAngles = {
    generatedAt: new Date().toISOString(),
    weekOf: monday,
    entriesAnalysed: recent.length,
    eligibleAngles: parsed.eligibleAngles ?? [],
    ineligible: parsed.ineligible ?? [],
  };

  writeFileSync(join(dataDir, FILE), JSON.stringify(angles, null, 2));
  console.log(`[Max][news-triage] Saved: ${angles.eligibleAngles.length} eligible, ${angles.ineligible.length} ineligible`);

  return angles;
}

/**
 * Pick the single best eligible angle for the week's current_event post.
 * Preference order: high salience → diverse angle-types across weeks
 * (caller tracks).
 *
 * Returns null if no eligible angles exist.
 */
export function selectAngleForWeek(angles: NewsAngles | null): EligibleAngle | null {
  if (!angles || angles.eligibleAngles.length === 0) return null;
  const ranked = angles.eligibleAngles.slice().sort((a, b) => {
    const sScore: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return (sScore[b.salience] ?? 0) - (sScore[a.salience] ?? 0);
  });
  return ranked[0];
}
