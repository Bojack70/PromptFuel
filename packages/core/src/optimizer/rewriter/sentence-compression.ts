import type { RewritePassResult, AppliedRewrite } from './types.js';

// Intensifiers before absolute/strong adjectives
const INTENSIFIER_ABSOLUTES: Array<[RegExp, string]> = [
  [/\bvery unique\b/gi, 'unique'],
  [/\bcompletely essential\b/gi, 'essential'],
  [/\btotally impossible\b/gi, 'impossible'],
  [/\breally important\b/gi, 'important'],
  [/\bextremely critical\b/gi, 'critical'],
  [/\babsolutely necessary\b/gi, 'necessary'],
  [/\bquite obvious\b/gi, 'obvious'],
  [/\btruly remarkable\b/gi, 'remarkable'],
  [/\bvery essential\b/gi, 'essential'],
  [/\bextremely important\b/gi, 'important'],
  [/\bcompletely impossible\b/gi, 'impossible'],
  [/\babsolutely critical\b/gi, 'critical'],
  [/\bvery critical\b/gi, 'critical'],
  [/\bvery necessary\b/gi, 'necessary'],
  [/\breally essential\b/gi, 'essential'],
  [/\breally critical\b/gi, 'critical'],
  [/\bvery important\b/gi, 'important'],
  [/\bvery obvious\b/gi, 'obvious'],
  [/\breally obvious\b/gi, 'obvious'],
  [/\bcompletely unique\b/gi, 'unique'],
  [/\bentirely unique\b/gi, 'unique'],
  [/\btruly unique\b/gi, 'unique'],
  [/\babsolutely perfect\b/gi, 'perfect'],
  [/\bcompletely perfect\b/gi, 'perfect'],
  [/\bvery perfect\b/gi, 'perfect'],
  [/\btotally complete\b/gi, 'complete'],
  [/\bcompletely complete\b/gi, 'complete'],
  [/\bvery complete\b/gi, 'complete'],
];

// Meta-commentary that adds no value in prompts
const META_COMMENTARY: Array<[RegExp, string]> = [
  [/as I mentioned (?:earlier|before|previously|above),?\s*/gi, ''],
  [/as (?:you|we) (?:may|might|probably) know,?\s*/gi, ''],
  [/it goes without saying that\s*/gi, ''],
  [/needless to say,?\s*/gi, ''],
  [/it is worth mentioning that\s*/gi, ''],
  [/let me just say that\s*/gi, ''],
  [/I just wanted to say that\s*/gi, ''],
  [/I just want to mention that\s*/gi, ''],
  [/it's worth pointing out that\s*/gi, ''],
  [/as a side note,?\s*/gi, ''],
  [/on a related note,?\s*/gi, ''],
  [/to be honest,?\s*/gi, ''],
  [/to be frank,?\s*/gi, ''],
  [/to tell you the truth,?\s*/gi, ''],
  [/the thing is,?\s*/gi, ''],
  [/the point is,?\s*/gi, ''],
  [/what I mean is,?\s*/gi, ''],
  [/what I'm trying to say is,?\s*/gi, ''],
  [/if I'm being honest,?\s*/gi, ''],
];

// Unnecessary single-word qualifiers
const QUALIFIERS: Array<[RegExp, string]> = [
  [/\bbasically,?\s*/gi, ''],
  [/\bessentially,?\s*/gi, ''],
  [/\bactually,?\s*/gi, ''],
  [/\bliterally\s+/gi, ''],
  [/\bhonestly,?\s*/gi, ''],
  [/\bfrankly,?\s*/gi, ''],
  [/\bsimply put,?\s*/gi, ''],
  [/\bobviously,?\s*/gi, ''],
  [/\bclearly,?\s*/gi, ''],
  [/\bcertainly,?\s*/gi, ''],
  [/\bdefinitely,?\s*/gi, ''],
  [/\bundoubtedly,?\s*/gi, ''],
];

export function applySentenceCompression(text: string): RewritePassResult {
  const applied: AppliedRewrite[] = [];
  let current = text;

  // Apply intensifier + absolute reductions
  for (const [pattern, replacement] of INTENSIFIER_ABSOLUTES) {
    pattern.lastIndex = 0;
    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const match = current.match(pattern);
      current = current.replace(pattern, replacement);
      if (match) {
        applied.push({
          ruleName: 'sentence-compression',
          category: 'compression',
          original: match[0],
          replacement,
          description: `Simplified "${match[0]}" to "${replacement}"`,
        });
      }
    }
  }

  // Apply meta-commentary removal
  for (const [pattern, replacement] of META_COMMENTARY) {
    pattern.lastIndex = 0;
    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const match = current.match(pattern);
      current = current.replace(pattern, replacement);
      if (match) {
        applied.push({
          ruleName: 'sentence-compression',
          category: 'compression',
          original: match[0].trim(),
          replacement: '[removed]',
          description: `Removed meta-commentary: "${match[0].trim()}"`,
        });
      }
    }
  }

  // Apply qualifier removal
  for (const [pattern, replacement] of QUALIFIERS) {
    pattern.lastIndex = 0;
    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const match = current.match(pattern);
      current = current.replace(pattern, replacement);
      if (match) {
        applied.push({
          ruleName: 'sentence-compression',
          category: 'compression',
          original: match[0].trim(),
          replacement: '[removed]',
          description: `Removed unnecessary qualifier: "${match[0].trim()}"`,
        });
      }
    }
  }

  // Fix capitalization
  current = current.replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  if (current.length > 0 && /^[a-z]/.test(current)) {
    current = current.charAt(0).toUpperCase() + current.slice(1);
  }

  return { text: current, applied };
}
