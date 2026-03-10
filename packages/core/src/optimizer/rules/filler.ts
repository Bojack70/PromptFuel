import type { OptimizationResult } from '../index.js';

// Single source of truth for filler phrases and their replacements.
// Key = filler phrase (lowercase), Value = replacement (empty string = remove entirely)
export const FILLER_PHRASES_MAP: Record<string, string> = {
  'i would like you to': '',
  'i want you to': '',
  'please make sure to': '',
  'please ensure that': '',
  'it is important that': '',
  'it is essential that': '',
  'it is crucial that': '',
  'i need you to': '',
  'can you please': '',
  'could you please': '',
  'i was wondering if you could': '',
  'i would appreciate it if you could': '',
  'i would really like it if': '',
  'please be sure to': '',
  'make sure that you': '',
  'be sure to': '',
  'do not forget to': '',
  "don't forget to": '',
  'keep in mind that': '',
  'it should be noted that': '',
  'it is worth mentioning that': '',
  'as a matter of fact': '',
  'basically what i want is': '',
  "what i'm looking for is": '',
  'the thing is that': '',
  'in order to': 'to',
  'for the purpose of': 'for',
  'with regard to': 'about',
  'with respect to': 'about',
  'in terms of': 'regarding',
  'as i mentioned before': '',
  'as i said earlier': '',
  'as previously stated': '',
  'at the end of the day': '',
  'when all is said and done': '',
};

export function detectFiller(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  const lowerText = text.toLowerCase();

  for (const [phrase, replacement] of Object.entries(FILLER_PHRASES_MAP)) {
    const index = lowerText.indexOf(phrase);
    if (index !== -1) {
      const original = text.substring(index, index + phrase.length);

      results.push({
        original,
        optimized: replacement,
        tokensSaved: 0,
        rule: 'filler',
        description: replacement
          ? `Replace "${original}" with "${replacement}"`
          : `Remove filler phrase: "${original}"`,
      });
    }
  }

  return results;
}

export function applyFillerRemoval(text: string): string {
  let result = text;
  for (const [phrase, replacement] of Object.entries(FILLER_PHRASES_MAP)) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, replacement);
  }
  // Clean up double spaces left by removals
  result = result.replace(/ {2,}/g, ' ').trim();
  // Capitalize sentence starts after removal
  result = result.replace(/^\s*([a-z])/gm, (_, c) => c.toUpperCase());
  return result;
}
