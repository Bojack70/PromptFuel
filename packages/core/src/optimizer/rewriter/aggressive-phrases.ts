import type { RewritePassResult, AppliedRewrite } from './types.js';

// Aggressive patterns — only applied with --aggressive flag.
// These are safe to remove but occasionally carry slight emphasis.
const AGGRESSIVE_MAP: Array<[RegExp, string]> = [
  // --- Hedge adverbs before descriptive words ---
  // "very important" → "important", "really helpful" → "helpful"
  [/\b(very|really|extremely|highly|quite|rather|somewhat)\s+(?=[a-zA-Z])/gi, ''],

  // --- Weak qualifiers ---
  [/\bjust\s+(?=[a-zA-Z])/gi, ''],
  [/\bsimply\s+(?=[a-zA-Z])/gi, ''],
  [/\bactually,?\s+/gi, ''],
  [/\bliterally\s+/gi, ''],
  [/\bkind of\s+/gi, ''],
  [/\bsort of\s+/gi, ''],

  // --- Low-value sentence openers ---
  [/\bessentially,?\s+/gi, ''],
  [/\bbasically,?\s+/gi, ''],
  [/\bfundamentally,?\s+/gi, ''],
  [/\bimportantly,?\s+/gi, ''],
  [/\bnotably,?\s+/gi, ''],
  [/\bto summarize,?\s+/gi, ''],
  [/\bin summary,?\s+/gi, ''],
  [/\bin conclusion,?\s+/gi, ''],
  [/\bto conclude,?\s+/gi, ''],
  [/\bsimply put,?\s+/gi, ''],
  [/\bto put it simply,?\s+/gi, ''],
  [/\bit(?:'s| is) worth noting that\s+/gi, ''],
  [/\bit(?:'s| is) worth mentioning that\s+/gi, ''],
];

export function applyAggressivePhrases(text: string): RewritePassResult {
  const applied: AppliedRewrite[] = [];
  let current = text;

  for (const [pattern, replacement] of AGGRESSIVE_MAP) {
    pattern.lastIndex = 0;

    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(current)) !== null) {
      matches.push({ ...match, index: match.index } as RegExpExecArray);
      if (!pattern.global) break;
    }

    if (matches.length > 0) {
      current = current.replace(pattern, replacement);
      for (const m of matches) {
        applied.push({
          ruleName: 'aggressive-phrase',
          category: 'aggressive-phrase',
          original: m[0].trim(),
          replacement: replacement || '[removed]',
          description: replacement
            ? `Replaced "${m[0].trim()}" with "${replacement}"`
            : `Removed low-value phrase: "${m[0].trim()}"`,
        });
      }
    }
  }

  // Fix capitalization after removals
  current = current.replace(/([.!?]\s+)([a-z])/g, (_, punct, char) => punct + char.toUpperCase());
  if (current.length > 0 && /^[a-z]/.test(current)) {
    current = current.charAt(0).toUpperCase() + current.slice(1);
  }

  return { text: current, applied };
}
