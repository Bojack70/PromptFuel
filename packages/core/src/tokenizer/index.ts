import { countOpenAITokens } from './tiktoken.js';
import { countClaudeTokens } from './claude.js';

export type ModelProvider = 'openai' | 'anthropic';

export interface TokenCount {
  inputTokens: number;
  estimatedOutputTokens: number;
}

// Improved output estimation using intent classification + complexity signal
function estimateOutputTokens(text: string, inputTokens: number): number {
  const lower = text.toLowerCase();

  // Complexity signal: longer prompts with more instructions need more output
  const complexityMultiplier = Math.log2(Math.max(inputTokens, 10)) / 4;

  // Code generation — requires both an action verb AND a code-related noun
  const isCode = /\b(write|create|build|implement|generate|refactor|fix|debug)\b/.test(lower)
    && /\b(code|function|class|component|script|api|endpoint|query|module|test|app|server)\b/.test(lower);

  // Summary requests — explicitly asking for shorter output
  const isSummary = /\b(summarize|tldr|brief|overview|synopsis|in short)\b/.test(lower);

  // List/enumeration requests
  const isList = /\b(list|enumerate|give me \d+|top \d+|pros and cons|steps to)\b/.test(lower);

  // Explanation/analysis
  const isExplanation = /\b(explain|describe|what is|how does|how do|why does|why do|walk me through|teach me)\b/.test(lower);

  // Short answer — check first sentence only, not full text
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? '';
  const isShortAnswer = /^(what|how|why|when|where|who|which|is|can|does|will|do)\b/i.test(firstSentence)
    && firstSentence.length < 60;

  if (isCode) return Math.min(Math.max(800, Math.round(inputTokens * 3 * complexityMultiplier)), 8000);
  if (isSummary) return Math.min(Math.max(100, Math.round(inputTokens * 0.3)), 500);
  if (isList) return Math.min(Math.max(300, Math.round(inputTokens * 1.5 * complexityMultiplier)), 2000);
  if (isExplanation) return Math.min(Math.max(300, Math.round(inputTokens * 1.5 * complexityMultiplier)), 4000);
  if (isShortAnswer) return Math.min(Math.max(100, Math.round(inputTokens * 0.5)), 500);

  // Default
  return Math.min(Math.max(200, Math.round(inputTokens * complexityMultiplier)), 2000);
}

const OPENAI_MODELS = new Set([
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
  'gpt-4', 'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini',
]);

export function getProvider(model: string): ModelProvider {
  if (!model) return 'openai';
  if (OPENAI_MODELS.has(model)) return 'openai';
  // Prefix match for dated variants like 'gpt-4o-2024-11-20'
  for (const m of OPENAI_MODELS) {
    if (model.startsWith(m)) return 'openai';
  }
  return 'anthropic';
}

export function countTokens(text: string, model: string): TokenCount {
  if (!text) return { inputTokens: 0, estimatedOutputTokens: 0 };

  const provider = getProvider(model);
  let inputTokens: number;

  if (provider === 'openai') {
    inputTokens = countOpenAITokens(text, model);
  } else {
    inputTokens = countClaudeTokens(text);
  }

  const estimatedOutputTokens = estimateOutputTokens(text, inputTokens);

  return { inputTokens, estimatedOutputTokens };
}

export { countOpenAITokens } from './tiktoken.js';
export { countClaudeTokens } from './claude.js';
