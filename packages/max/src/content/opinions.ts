/**
 * Nate's opinions — curated worldview injected into content generation.
 *
 * Each opinion is tagged with the reader buckets it's most relevant to and a
 * heat level. At generation time we pick 1-2 opinions whose buckets match the
 * content category being written, and inject them into the prompt with an
 * explicit "embody, don't quote" instruction.
 *
 * The goal is voice consistency: across hundreds of posts, the body of work
 * should reflect a recognizable, slightly contrarian worldview — the thing AI
 * content usually lacks.
 *
 * Edit data/nate-opinions.json freely. Changes take effect on the next weekly
 * pregen run.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'nate-opinions.json';

export interface NateOpinion {
  id: string;
  text: string;
  buckets: string[];       // reader buckets this opinion is relevant for
  heat: 'moderate' | 'spicy';
}

interface OpinionsFile {
  opinions: NateOpinion[];
}

export function loadOpinions(dataDir: string): NateOpinion[] {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as OpinionsFile;
    return parsed.opinions ?? [];
  } catch {
    return [];
  }
}

/**
 * Pick N opinions relevant to the given bucket, biased toward a mix of heat
 * levels (one moderate + one spicy when possible). Returns a prompt-ready
 * injection string or empty string if no opinions apply.
 */
export function opinionsForPrompt(
  dataDir: string,
  bucket: string,
  count = 2,
): string {
  const all = loadOpinions(dataDir);
  if (all.length === 0) return '';

  const relevant = all.filter((o) => o.buckets.includes(bucket));
  if (relevant.length === 0) return '';

  // Shuffle for variety across posts
  const shuffled = relevant.slice().sort(() => Math.random() - 0.5);

  // Try to get a mix: prefer one spicy + one moderate when asking for 2
  let picks: NateOpinion[];
  if (count >= 2) {
    const spicy = shuffled.find((o) => o.heat === 'spicy');
    const moderate = shuffled.find((o) => o.heat === 'moderate');
    picks = [spicy, moderate].filter((x): x is NateOpinion => !!x);
    // Top up from the remaining pool if we didn't get enough
    for (const o of shuffled) {
      if (picks.length >= count) break;
      if (!picks.includes(o)) picks.push(o);
    }
  } else {
    picks = shuffled.slice(0, count);
  }

  if (picks.length === 0) return '';

  const lines = picks.map((o) => `- ${o.text}`).join('\n');

  return `\n\nNATE'S WORLDVIEW — embody 1-2 of these stances implicitly in the post. The reader should feel the worldview, not see it quoted. Do NOT repeat the words verbatim:\n${lines}`;
}
