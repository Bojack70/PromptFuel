// Intent detection, configuration, and pattern protection for intent-aware optimization

// --- Types ---

export type PromptIntentType = 'debug' | 'code-gen' | 'refactor' | 'explain' | 'creative' | 'general';

export interface PromptIntent {
  type: PromptIntentType;
  confidence: number;          // 0-1
  matchedSignals: string[];    // which patterns triggered
}

export interface OptimizeOptions {
  targetTokens?: number;       // token budget (optional)
  intent?: PromptIntentType;   // manual intent override (optional)
}

export interface BudgetResult {
  levelApplied: 1 | 2 | 3 | 4;
  targetMet: boolean;
  remainingGap: number;        // 0 if met
  targetTokens: number;
}

export interface IntentRuleConfig {
  skipDetectors: string[];
  skipRewriterPasses: string[];
  protectedPatterns: RegExp[];
  compressionLevel: 'light' | 'moderate' | 'aggressive';
}

// --- Intent Signal Definitions ---

interface IntentSignal {
  pattern: RegExp;
  weight: number;
  label: string;
}

const INTENT_SIGNALS: Record<Exclude<PromptIntentType, 'general'>, IntentSignal[]> = {
  debug: [
    { pattern: /\b(error|exception|bug|crash|fail(ing|ed|s)?|broken|issue)\b|TypeError|ReferenceError|SyntaxError|RangeError|ValueError|KeyError|AttributeError|NullPointerException/i, weight: 3, label: 'error-keyword' },
    { pattern: /\b(step[- ]by[- ]step|walk me through|trace|debug(ging)?)\b/i, weight: 2, label: 'reasoning-marker' },
    { pattern: /\b(stack\s*trace|traceback|log(s|ging)?|output|warning)\b/i, weight: 2, label: 'diagnostic-term' },
    { pattern: /```[\s\S]*?(error|Error|ERR|exception|TypeError|ReferenceError|SyntaxError)[\s\S]*?```/i, weight: 3, label: 'error-in-code-block' },
    { pattern: /\b(why\s+(is|does|doesn't|isn't|won't|can't)|what('?s|\s+(went|goes))\s+wrong)\b/i, weight: 2, label: 'why-question' },
  ],
  'code-gen': [
    { pattern: /\b(write|create|build|generate|implement|make|develop)\s+(a|an|the|me)?\s*(function|class|component|module|api|endpoint|script|program|app)/i, weight: 3, label: 'creation-verb' },
    { pattern: /\b(react|vue|angular|svelte|next\.?js|express|django|flask|fastapi|spring)\b/i, weight: 2, label: 'framework-name' },
    { pattern: /\b(typescript|javascript|python|rust|go(lang)?|java|c\+\+|ruby|swift|kotlin)\b/i, weight: 1, label: 'language-name' },
    { pattern: /\b(boilerplate|scaffold|starter|template|skeleton)\b/i, weight: 2, label: 'scaffolding-term' },
  ],
  refactor: [
    { pattern: /\b(refactor|restructure|reorganize|clean\s*up|simplify|improve\s+(the\s+)?(code|structure))\b/i, weight: 3, label: 'refactor-verb' },
    { pattern: /\b(only\s+(change|modify|touch|update|edit)|don'?t\s+(touch|change|modify)|keep\s+(the\s+)?(rest|other))\b/i, weight: 3, label: 'scope-constraint' },
    { pattern: /\b(maintainab(le|ility)|read(able|ability)|DRY|SOLID|single\s+responsibility)\b/i, weight: 2, label: 'quality-goal' },
    { pattern: /\b(extract|inline|rename|move|split|merge|decompose)\s+(the\s+)?(function|method|class|module|variable)/i, weight: 2, label: 'refactor-action' },
  ],
  explain: [
    { pattern: /\b(explain|describe|clarify|break\s*down|walk\s+me\s+through|help\s+me\s+understand)\b/i, weight: 3, label: 'explanation-verb' },
    { pattern: /\b(concept|theory|principle|mechanism|how\s+(does|do)\s+(it|this|that)\s+work)\b/i, weight: 2, label: 'conceptual-noun' },
    { pattern: /\b(ELI5|in\s+simple\s+(terms|words)|for\s+a\s+beginner|in\s+layman'?s?\s+terms)\b/i, weight: 2, label: 'simplicity-request' },
    { pattern: /\bwhat\s+(is|are)\s+(a|an|the)\s+\w+/i, weight: 1, label: 'what-is-question' },
  ],
  creative: [
    { pattern: /\b(story|poem|essay|blog\s*post|article|narrative|fiction|dialogue|screenplay)\b/i, weight: 3, label: 'creative-form' },
    { pattern: /\b(tone|voice|style|mood|persona|character)\b/i, weight: 2, label: 'style-marker' },
    { pattern: /\b(brainstorm|ideate|imagine|creative|inspiration|original)\b/i, weight: 2, label: 'creative-verb' },
    { pattern: /\b(write\s+(a|an)\s+(blog|story|poem|essay|article|song|script))\b/i, weight: 3, label: 'creative-write' },
    { pattern: /\b(conversational|formal|casual|humorous|witty|sarcastic|professional)\s+(tone|voice|style)/i, weight: 2, label: 'tone-instruction' },
  ],
};

const CONFIDENCE_THRESHOLD = 0.3;

// --- detectIntent ---

export function detectIntent(text: string): PromptIntent {
  const intents = Object.keys(INTENT_SIGNALS) as Exclude<PromptIntentType, 'general'>[];

  let bestType: PromptIntentType = 'general';
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const intentType of intents) {
    const signals = INTENT_SIGNALS[intentType];
    const maxPossible = signals.reduce((sum, s) => sum + s.weight, 0);
    let score = 0;
    const matched: string[] = [];

    for (const signal of signals) {
      if (signal.pattern.test(text)) {
        score += signal.weight;
        matched.push(signal.label);
      }
    }

    const normalized = maxPossible > 0 ? score / maxPossible : 0;

    if (normalized > bestScore) {
      bestScore = normalized;
      bestType = intentType;
      bestSignals = matched;
    }
  }

  if (bestScore < CONFIDENCE_THRESHOLD) {
    return { type: 'general', confidence: 0, matchedSignals: [] };
  }

  return {
    type: bestType,
    confidence: Math.round(bestScore * 100) / 100,
    matchedSignals: bestSignals,
  };
}

// --- Intent Configurations ---

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

export const INTENT_CONFIGS: Record<PromptIntentType, IntentRuleConfig> = {
  debug: {
    skipDetectors: ['weak-hedging'],
    skipRewriterPasses: ['question-restructuring', 'voice-transform'],
    protectedPatterns: [
      /\bstep[- ]by[- ]step\b/gi,
      CODE_BLOCK_PATTERN,
      /\b(error|Error|ERR|TypeError|ReferenceError|SyntaxError|RangeError)[:\s][^\n]+/g,
    ],
    compressionLevel: 'light',
  },
  'code-gen': {
    skipDetectors: [],
    skipRewriterPasses: [],
    protectedPatterns: [CODE_BLOCK_PATTERN],
    compressionLevel: 'moderate',
  },
  refactor: {
    skipDetectors: [],
    skipRewriterPasses: ['voice-transform'],
    protectedPatterns: [
      /\b(only\s+(change|modify|touch|update|edit)|don'?t\s+(touch|change|modify)|keep\s+(the\s+)?(rest|other))[^\n]*/gi,
      CODE_BLOCK_PATTERN,
    ],
    compressionLevel: 'moderate',
  },
  explain: {
    skipDetectors: ['missing-format'],
    skipRewriterPasses: ['question-restructuring'],
    protectedPatterns: [
      /\b(ELI5|in\s+simple\s+(terms|words)|for\s+a\s+beginner|in\s+layman'?s?\s+terms)\b/gi,
    ],
    compressionLevel: 'light',
  },
  creative: {
    skipDetectors: ['filler', 'weak-hedging'],
    skipRewriterPasses: ['voice-transform', 'sentence-compression'],
    protectedPatterns: [
      /\b(conversational|formal|casual|humorous|witty|sarcastic|professional)\s+(tone|voice|style)[^\n]*/gi,
      /\bin\s+(a|the)\s+(style|tone|voice)\s+of\b[^\n]*/gi,
    ],
    compressionLevel: 'light',
  },
  general: {
    skipDetectors: [],
    skipRewriterPasses: [],
    protectedPatterns: [],
    compressionLevel: 'aggressive',
  },
};

// --- Protected Pattern Marker System ---

const SENTINEL_PREFIX = '\u200B\u200B\u200B';
const SENTINEL_SUFFIX = '\u200B\u200B\u200B';

export function protectPatterns(
  text: string,
  patterns: RegExp[]
): { text: string; restorations: Map<string, string> } {
  const restorations = new Map<string, string>();
  let result = text;
  let counter = 0;

  for (const pattern of patterns) {
    // Clone the regex so we don't mutate the original's lastIndex
    const re = new RegExp(pattern.source, pattern.flags);
    result = result.replace(re, (match) => {
      const sentinel = `${SENTINEL_PREFIX}PROT_${counter}${SENTINEL_SUFFIX}`;
      restorations.set(sentinel, match);
      counter++;
      return sentinel;
    });
  }

  return { text: result, restorations };
}

export function restorePatterns(
  text: string,
  restorations: Map<string, string>
): string {
  let result = text;
  // Restore in reverse order so nested protections (where a later sentinel's
  // stored text contains an earlier sentinel) are expanded first.
  const entries = [...restorations.entries()].reverse();
  for (const [sentinel, original] of entries) {
    result = result.replace(sentinel, original);
  }
  return result;
}
