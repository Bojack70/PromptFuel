import type { OptimizationResult } from '../index.js';

// Detect negative instructions that should be phrased positively
// "Don't be verbose" → "Be concise" is more effective and often fewer tokens
const NEGATIVE_REPLACEMENTS: [RegExp, string][] = [
  [/don'?t be verbose/gi, 'Be concise'],
  [/don'?t be too (long|lengthy|wordy)/gi, 'Keep it brief'],
  [/don'?t include unnecessary/gi, 'Include only relevant'],
  [/don'?t repeat yourself/gi, 'Avoid repetition'],
  [/don'?t use complex/gi, 'Use simple'],
  [/don'?t make it complicated/gi, 'Keep it simple'],
  [/don'?t forget to/gi, ''],
  [/avoid being (too )?verbose/gi, 'Be concise'],
  [/never use jargon/gi, 'Use plain language'],
  [/do not include (any )?fluff/gi, 'Be direct'],
];

export function detectNegativeInstructions(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];

  for (const [pattern, suggestion] of NEGATIVE_REPLACEMENTS) {
    const match = text.match(pattern);
    if (match) {
      results.push({
        original: match[0],
        optimized: suggestion || '[remove]',
        tokensSaved: 0,
        rule: 'negative-instruction',
        description: suggestion
          ? `Rephrase negatively: "${match[0]}" → "${suggestion}" (positive instructions are more effective)`
          : `Remove negative filler: "${match[0]}"`,
      });
    }
  }

  return results;
}

// Detect weak hedging patterns that reduce instruction clarity
const HEDGING_PATTERNS: RegExp[] = [
  /\btry to\b/gi,
  /\bif possible\b/gi,
  /\bwhen you can\b/gi,
  /\bif you can\b/gi,
  /\bmaybe you could\b/gi,
  /\bperhaps you could\b/gi,
  /\bit would be nice if\b/gi,
  /\bit would be great if\b/gi,
  /\bideally\b/gi,
  /\bif it's not too much trouble\b/gi,
];

export function detectWeakHedging(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];

  for (const pattern of HEDGING_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      results.push({
        original: match[0],
        optimized: '[use direct imperative instead]',
        tokensSaved: 0,
        rule: 'weak-hedging',
        description: `Hedging phrase "${match[0]}" weakens the instruction — use a direct imperative instead`,
      });
    }
  }

  return results;
}

// Detect prompts that lack output format constraints
// (prompts >50 words with no format guidance generate unpredictable-length output)
const FORMAT_INDICATORS = /\b(bullet points?|numbered list|table|json|markdown|paragraph|step[- ]by[- ]step|concise|brief|one sentence|short|in \d+ words|limit to|maximum \d+|format as|respond with|output as|return as)\b/i;

export function detectMissingFormat(text: string): OptimizationResult[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);

  // Only flag for prompts that are complex enough to benefit from format guidance
  if (words.length < 15) return [];

  if (!FORMAT_INDICATORS.test(text)) {
    return [{
      original: '[no format constraint]',
      optimized: '[add output format guidance]',
      tokensSaved: 0,
      rule: 'missing-format',
      description: 'No output format specified — consider adding "Respond in bullet points" or "Keep it under 3 paragraphs" to control output length and reduce tokens',
    }];
  }

  return [];
}
