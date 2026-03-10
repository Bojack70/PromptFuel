import type { RewritePassResult, AppliedRewrite } from './types.js';
import { capitalizeFirst } from './utils.js';

interface QuestionPattern {
  pattern: RegExp;
  rebuild: (...args: string[]) => string;
  description: string;
}

function cleanTrailing(s: string): string {
  return s.replace(/[.?!,;:\s]+$/, '').trim();
}

const PATTERNS: QuestionPattern[] = [
  // "Please let me know [this] on which day X" → "When did X happen?"
  {
    pattern: /(?:please\s+)?(?:let me know|tell me)(?:\s+this)?\s+(?:on\s+which\s+day|when)\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `When did ${cleanTrailing(captured)}?`,
    description: 'Converted indirect time question to direct question',
  },
  // "Can/Could you tell me what X is" → "What is X?"
  {
    pattern: /(?:can|could)\s+you\s+(?:please\s+)?(?:tell|inform|let)\s+(?:me|us)\s+(?:about\s+)?what\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `What ${cleanTrailing(captured)}?`,
    description: 'Converted indirect "what" question to direct question',
  },
  // "Can you explain how X works" → "How does X work?"
  {
    pattern: /(?:can|could)\s+you\s+(?:please\s+)?(?:explain|describe|tell me)\s+how\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `How ${cleanTrailing(captured)}?`,
    description: 'Converted indirect "how" question to direct question',
  },
  // "I want to know why X" → "Why X?"
  {
    pattern: /(?:I\s+(?:want|would like|need)\s+to\s+(?:know|understand)|please\s+(?:explain|tell me))\s+why\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `Why ${cleanTrailing(captured)}?`,
    description: 'Converted indirect "why" question to direct question',
  },
  // "I want to know where X" → "Where X?"
  {
    pattern: /(?:I\s+(?:want|would like|need)\s+to\s+(?:know|understand|find out))\s+where\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `Where ${cleanTrailing(captured)}?`,
    description: 'Converted indirect "where" question to direct question',
  },
  // "Could you provide me with information about X" → "What is X?"
  {
    pattern: /(?:can|could)\s+you\s+(?:please\s+)?(?:provide|give)\s+(?:me|us)\s+(?:with\s+)?(?:information|details|info)\s+(?:about|on|regarding)\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `What is ${cleanTrailing(captured)}?`,
    description: 'Converted information request to direct question',
  },
  // "I was wondering if you could tell me X" → "X?"
  {
    pattern: /I\s+was\s+wondering\s+if\s+you\s+could\s+(?:please\s+)?(?:tell me|explain|describe)\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `${capitalizeFirst(cleanTrailing(captured))}?`,
    description: 'Removed indirect preamble from question',
  },
  // "Do you know X" → "X?"
  {
    pattern: /(?:do|does)\s+(?:you|anyone)\s+(?:happen to\s+)?know\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `${capitalizeFirst(cleanTrailing(captured))}?`,
    description: 'Converted "do you know" to direct question',
  },
  // "I have a question about X. Y" → "Y" (remove preamble)
  {
    pattern: /I\s+have\s+a\s+question\s+(?:about|regarding|concerning)\s+[^.?]+[.?]\s*/gi,
    rebuild: () => '',
    description: 'Removed "I have a question about" preamble',
  },
  // "I'm curious about X" → "X?"
  {
    pattern: /I(?:'m| am)\s+curious\s+(?:about|to know|whether|if)\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `${capitalizeFirst(cleanTrailing(captured))}?`,
    description: 'Converted "I\'m curious" to direct question',
  },
  // "I'd like to ask about X" → "X?"
  {
    pattern: /I(?:'d| would)\s+like\s+to\s+ask\s+(?:you\s+)?(?:about|regarding)\s+(.+?)(?:[.?]|$)/gi,
    rebuild: (_full, captured) => `${capitalizeFirst(cleanTrailing(captured))}?`,
    description: 'Converted "I\'d like to ask" to direct question',
  },
];

export function applyQuestionRestructuring(text: string): RewritePassResult {
  const applied: AppliedRewrite[] = [];
  let current = text;

  for (const { pattern, rebuild, description } of PATTERNS) {
    pattern.lastIndex = 0;

    if (pattern.test(current)) {
      pattern.lastIndex = 0;
      const before = current;

      current = current.replace(pattern, (...args) => {
        const fullMatch = args[0] as string;
        const captured = args[1] as string | undefined;
        const result = rebuild(fullMatch, captured ?? '');

        applied.push({
          ruleName: 'question-restructure',
          category: 'question',
          original: fullMatch.trim(),
          replacement: result || '[removed]',
          description,
        });

        return result;
      });
    }
  }

  // Fix capitalization at start
  if (current.length > 0 && /^[a-z]/.test(current)) {
    current = current.charAt(0).toUpperCase() + current.slice(1);
  }

  return { text: current, applied };
}
