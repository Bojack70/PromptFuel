import { detectFiller, applyFillerRemoval } from './rules/filler.js';
import { detectRedundancy } from './rules/redundancy.js';
import { detectDuplicates } from './rules/duplicates.js';
import { detectFormattingIssues, cleanFormatting } from './rules/formatting.js';
import { detectNegativeInstructions, detectWeakHedging, detectMissingFormat } from './rules/patterns.js';
import { scoreVerbosity } from './scorer.js';
import { countTokens } from '../tokenizer/index.js';
import { rewrite } from './rewriter/index.js';
import type { RewritePassName } from './rewriter/index.js';
import { applyContextTruncation } from './rewriter/context-truncation.js';
import {
  detectIntent,
  INTENT_CONFIGS,
  protectPatterns,
  restorePatterns,
  type OptimizeOptions,
  type PromptIntent,
  type BudgetResult,
} from './intent.js';

export interface OptimizationResult {
  original: string;
  optimized: string;
  tokensSaved: number;
  rule: string;
  description: string;
}

export interface OptimizeOutput {
  optimizedPrompt: string;
  originalTokens: number;
  optimizedTokens: number;
  tokenReduction: number;
  reductionPercent: number;
  verbosityScore: number;
  suggestions: OptimizationResult[];
  intent?: PromptIntent;
  budget?: BudgetResult;
}

// --- Custom Rule Plugin System ---

export interface CustomRule {
  /** Unique name for the rule */
  name: string;
  /** Detect issues and return suggestions (read-only analysis) */
  detect: (text: string) => OptimizationResult[];
  /** Optional: apply fixes to the text (returns modified text) */
  apply?: (text: string) => string;
}

const customRules: CustomRule[] = [];

/** Register a custom optimization rule */
export function registerRule(rule: CustomRule): void {
  const idx = customRules.findIndex(r => r.name === rule.name);
  if (idx >= 0) {
    customRules[idx] = rule;
  } else {
    customRules.push(rule);
  }
}

/** Remove a registered custom rule by name */
export function unregisterRule(name: string): boolean {
  const idx = customRules.findIndex(r => r.name === name);
  if (idx >= 0) {
    customRules.splice(idx, 1);
    return true;
  }
  return false;
}

/** Clear all custom rules */
export function clearRules(): void {
  customRules.length = 0;
}

/** Get all registered custom rules */
export function getRegisteredRules(): ReadonlyArray<CustomRule> {
  return customRules;
}

// --- End Plugin System ---

// --- Detector Map ---

const DETECTOR_MAP: Record<string, (text: string) => OptimizationResult[]> = {
  'filler': detectFiller,
  'redundancy': detectRedundancy,
  'duplicates': detectDuplicates,
  'formatting': detectFormattingIssues,
  'negative-instruction': detectNegativeInstructions,
  'weak-hedging': detectWeakHedging,
  'missing-format': detectMissingFormat,
};

const ALL_DETECTOR_NAMES = Object.keys(DETECTOR_MAP);

const ALL_REWRITER_PASSES: RewritePassName[] = [
  'verbose-phrases',
  'sentence-compression',
  'voice-transform',
  'question-restructuring',
];

// --- Budget Compression Levels ---

interface CompressionLevel {
  detectors: string[];
  rewriterPasses: RewritePassName[];
  useContextTruncation: boolean;
}

const COMPRESSION_LEVELS: CompressionLevel[] = [
  // Level 1 (light)
  {
    detectors: ['filler', 'formatting'],
    rewriterPasses: [],
    useContextTruncation: false,
  },
  // Level 2 (moderate)
  {
    detectors: ['filler', 'formatting', 'redundancy', 'duplicates'],
    rewriterPasses: ['verbose-phrases', 'sentence-compression'],
    useContextTruncation: false,
  },
  // Level 3 (aggressive)
  {
    detectors: ALL_DETECTOR_NAMES,
    rewriterPasses: ALL_REWRITER_PASSES,
    useContextTruncation: false,
  },
  // Level 4 (maximum)
  {
    detectors: ALL_DETECTOR_NAMES,
    rewriterPasses: ALL_REWRITER_PASSES,
    useContextTruncation: true,
  },
];

// --- Core Optimization Logic ---

function runOptimizationPass(
  text: string,
  detectorNames: string[],
  rewriterPasses: RewritePassName[],
  useContextTruncation: boolean,
  skipDetectors: string[],
  skipRewriterPasses: string[],
): { optimized: string; suggestions: OptimizationResult[] } {
  const suggestions: OptimizationResult[] = [];

  // Run detectors
  for (const name of detectorNames) {
    if (skipDetectors.includes(name)) continue;
    const detector = DETECTOR_MAP[name];
    if (detector) {
      suggestions.push(...detector(text));
    }
  }

  // Run custom rule detectors
  for (const rule of customRules) {
    suggestions.push(...rule.detect(text));
  }

  // Apply built-in optimizations
  let optimized = text;
  if (detectorNames.includes('filler') && !skipDetectors.includes('filler')) {
    optimized = applyFillerRemoval(optimized);
  }
  if (detectorNames.includes('formatting') && !skipDetectors.includes('formatting')) {
    optimized = cleanFormatting(optimized);
  }

  // Apply rewriter passes (filter out skipped ones)
  if (rewriterPasses.length > 0) {
    const filteredPasses = rewriterPasses.filter(p => !skipRewriterPasses.includes(p));
    if (filteredPasses.length > 0) {
      const rewriteResult = rewrite(optimized, filteredPasses);
      optimized = rewriteResult.rewrittenText;

      for (const applied of rewriteResult.appliedRules) {
        suggestions.push({
          original: applied.original,
          optimized: applied.replacement,
          tokensSaved: 0,
          rule: `rewrite-${applied.category}`,
          description: applied.description,
        });
      }
    }
  }

  // Apply context truncation (Level 4)
  if (useContextTruncation) {
    const truncResult = applyContextTruncation(optimized);
    optimized = truncResult.text;
    for (const applied of truncResult.applied) {
      suggestions.push({
        original: applied.original,
        optimized: applied.replacement,
        tokensSaved: 0,
        rule: `rewrite-${applied.category}`,
        description: applied.description,
      });
    }
  }

  // Apply custom rule transforms
  for (const rule of customRules) {
    if (rule.apply) {
      optimized = rule.apply(optimized);
    }
  }

  return { optimized, suggestions };
}

function calculateTokenStats(
  original: string,
  optimized: string,
  suggestions: OptimizationResult[],
  model: string,
) {
  const originalTokens = countTokens(original, model).inputTokens;
  const optimizedTokens = countTokens(optimized, model).inputTokens;
  const tokenReduction = originalTokens - optimizedTokens;
  const reductionPercent = originalTokens > 0
    ? Math.round((tokenReduction / originalTokens) * 100)
    : 0;

  // Update token savings in suggestions
  for (const suggestion of suggestions) {
    if (suggestion.original && suggestion.optimized !== suggestion.original) {
      const origTokens = countTokens(suggestion.original, model).inputTokens;
      const optTokens = suggestion.optimized.startsWith('[')
        ? 0
        : countTokens(suggestion.optimized, model).inputTokens;
      suggestion.tokensSaved = origTokens - optTokens;
    }
  }

  return { originalTokens, optimizedTokens, tokenReduction, reductionPercent };
}

// --- Main optimize() ---

export function optimize(text: string, model?: string, options?: OptimizeOptions): OptimizeOutput;
export function optimize(text: string, model?: string): OptimizeOutput;
export function optimize(text: string, modelOrOptions?: string | OptimizeOptions, options?: OptimizeOptions): OptimizeOutput {
  // Parse overloaded arguments for backward compatibility
  let model: string = 'gpt-4o';
  let opts: OptimizeOptions | undefined;

  if (typeof modelOrOptions === 'string') {
    model = modelOrOptions;
    opts = options;
  } else if (typeof modelOrOptions === 'object') {
    opts = modelOrOptions;
  }

  // 1. Detect intent
  const intent: PromptIntent = opts?.intent
    ? { type: opts.intent, confidence: 1, matchedSignals: ['manual-override'] }
    : detectIntent(text);

  // 2. Look up config
  const config = INTENT_CONFIGS[intent.type];

  // 3. Protect patterns
  const { text: protectedText, restorations } = protectPatterns(text, config.protectedPatterns);

  let optimized: string;
  let suggestions: OptimizationResult[];
  let budget: BudgetResult | undefined;

  if (opts?.targetTokens) {
    // --- Progressive budget compression ---
    const target = opts.targetTokens;
    let currentText = protectedText;
    let allSuggestions: OptimizationResult[] = [];

    let levelApplied: 1 | 2 | 3 | 4 = 1;
    let targetMet = false;

    for (let i = 0; i < COMPRESSION_LEVELS.length; i++) {
      const level = COMPRESSION_LEVELS[i];
      levelApplied = (i + 1) as 1 | 2 | 3 | 4;

      const result = runOptimizationPass(
        currentText,
        level.detectors,
        level.rewriterPasses,
        level.useContextTruncation,
        config.skipDetectors,
        config.skipRewriterPasses,
      );

      currentText = result.optimized;
      allSuggestions = result.suggestions;

      // Check token count (restore patterns first to get accurate count)
      const restored = restorePatterns(currentText, new Map(restorations));
      const tokens = countTokens(restored, model).inputTokens;

      if (tokens <= target) {
        targetMet = true;
        break;
      }
    }

    optimized = currentText;
    suggestions = allSuggestions;

    const restoredFinal = restorePatterns(optimized, new Map(restorations));
    const finalTokens = countTokens(restoredFinal, model).inputTokens;

    budget = {
      levelApplied,
      targetMet,
      remainingGap: targetMet ? 0 : finalTokens - opts.targetTokens,
      targetTokens: opts.targetTokens,
    };
  } else {
    // --- Standard or aggressive optimization with intent gating ---
    const aggressivePasses: RewritePassName[] = opts?.aggressive
      ? [...ALL_REWRITER_PASSES, 'aggressive-phrases']
      : ALL_REWRITER_PASSES;

    const result = runOptimizationPass(
      protectedText,
      ALL_DETECTOR_NAMES,
      aggressivePasses,
      opts?.aggressive === true,
      config.skipDetectors,
      config.skipRewriterPasses,
    );
    optimized = result.optimized;
    suggestions = result.suggestions;
  }

  // 5. Restore protected patterns
  optimized = restorePatterns(optimized, restorations);

  // 6. Calculate tokens, score, return
  const { originalTokens, optimizedTokens, tokenReduction, reductionPercent } =
    calculateTokenStats(text, optimized, suggestions, model);

  const verbosityScore = scoreVerbosity(text);

  return {
    optimizedPrompt: optimized,
    originalTokens,
    optimizedTokens,
    tokenReduction,
    reductionPercent,
    verbosityScore,
    suggestions,
    intent,
    ...(budget ? { budget } : {}),
  };
}

export { scoreVerbosity } from './scorer.js';
