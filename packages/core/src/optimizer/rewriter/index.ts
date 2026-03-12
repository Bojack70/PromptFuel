import type { RewriteResult, RewritePassResult } from './types.js';
import { applyVerbosePhrases } from './verbose-phrases.js';
import { applyQuestionRestructuring } from './question-restructuring.js';
import { applyVoiceTransform } from './voice-transform.js';
import { applySentenceCompression } from './sentence-compression.js';
import { applyAggressivePhrases } from './aggressive-phrases.js';
import { collapseSpaces } from './utils.js';

export type RewritePassName = 'verbose-phrases' | 'sentence-compression' | 'voice-transform' | 'question-restructuring' | 'aggressive-phrases';

const PASS_MAP: Record<RewritePassName, (text: string) => RewritePassResult> = {
  'verbose-phrases': applyVerbosePhrases,
  'sentence-compression': applySentenceCompression,
  'voice-transform': applyVoiceTransform,
  'question-restructuring': applyQuestionRestructuring,
  'aggressive-phrases': applyAggressivePhrases,
};

const DEFAULT_ORDER: RewritePassName[] = [
  'verbose-phrases',
  'sentence-compression',
  'voice-transform',
  'question-restructuring',
  'aggressive-phrases',
];

export function rewrite(text: string, includePasses?: RewritePassName[]): RewriteResult {
  let current = text;
  const allApplied: RewriteResult['appliedRules'] = [];

  for (const passName of DEFAULT_ORDER) {
    if (includePasses && !includePasses.includes(passName)) continue;
    const pass = PASS_MAP[passName];
    const result = pass(current);
    current = result.text;
    allApplied.push(...result.applied);
  }

  // Post-processing: collapse spaces, trim
  current = collapseSpaces(current);

  // If nothing changed, return original with no rules
  if (current === text) {
    return { rewrittenText: text, appliedRules: [] };
  }

  return { rewrittenText: current, appliedRules: allApplied };
}

export type { RewriteResult, AppliedRewrite, RewritePassResult } from './types.js';
