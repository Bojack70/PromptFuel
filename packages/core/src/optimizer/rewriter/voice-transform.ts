import type { RewritePassResult, AppliedRewrite } from './types.js';

interface VoicePattern {
  pattern: RegExp;
  replacement: string | ((...args: string[]) => string);
  description: string;
}

const IMPERSONAL_PATTERNS: VoicePattern[] = [
  {
    pattern: /it should be noted that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it should be noted that"',
  },
  {
    pattern: /it is recommended that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is recommended that"',
  },
  {
    pattern: /it is important to note that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is important to note that"',
  },
  {
    pattern: /it is important to\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is important to"',
  },
  {
    pattern: /it can be seen that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it can be seen that"',
  },
  {
    pattern: /it is expected that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is expected that"',
  },
  {
    pattern: /it is worth noting that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is worth noting that"',
  },
  {
    pattern: /it is necessary to\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is necessary to"',
  },
  {
    pattern: /it is possible that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is possible that"',
  },
  {
    pattern: /it should be pointed out that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it should be pointed out that"',
  },
  {
    pattern: /it is believed that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is believed that"',
  },
  {
    pattern: /it is understood that\s*/gi,
    replacement: '',
    description: 'Removed impersonal "it is understood that"',
  },
];

// "X needs to be [verb]ed" → "[Verb] X"
const NEEDS_TO_BE_PATTERN: VoicePattern = {
  pattern: /(\b\w[\w\s]{0,30}?)\s+(?:needs?|need)\s+to\s+be\s+(\w+ed)\b/gi,
  replacement: (_full: string, subject: string, verb: string) => {
    const activeVerb = verb.replace(/ed$/, '');
    return `${activeVerb.charAt(0).toUpperCase() + activeVerb.slice(1)} ${subject.trim().toLowerCase()}`;
  },
  description: 'Converted "needs to be" passive to active imperative',
};

export function applyVoiceTransform(text: string): RewritePassResult {
  const applied: AppliedRewrite[] = [];
  let current = text;

  // Apply impersonal pattern removals
  for (const { pattern, replacement, description } of IMPERSONAL_PATTERNS) {
    pattern.lastIndex = 0;

    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const before = current;
      current = current.replace(pattern, replacement as string);

      if (current !== before) {
        const matchText = before.match(pattern);
        applied.push({
          ruleName: 'voice-transform',
          category: 'voice',
          original: matchText?.[0]?.trim() ?? '',
          replacement: (replacement as string) || '[removed]',
          description,
        });
      }
    }
  }

  // Apply "needs to be" transformation
  {
    const { pattern, replacement, description } = NEEDS_TO_BE_PATTERN;
    pattern.lastIndex = 0;

    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const before = current;
      current = current.replace(pattern, replacement as (...args: string[]) => string);

      if (current !== before) {
        applied.push({
          ruleName: 'voice-transform',
          category: 'voice',
          original: before.match(pattern)?.[0]?.trim() ?? '',
          replacement: current.trim(),
          description,
        });
      }
    }
  }

  // Fix capitalization after removals
  current = current.replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  if (current.length > 0 && /^[a-z]/.test(current)) {
    current = current.charAt(0).toUpperCase() + current.slice(1);
  }

  return { text: current, applied };
}
