import type { StrategyContext, StrategyRecommendation } from './types.js';
import { countTokens } from '../tokenizer/index.js';
import { generateConversationSummary, extractCommonContext } from './generators.js';

function getNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function computeOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

export function analyzeConversation(context: StrategyContext): StrategyRecommendation[] {
  const results: StrategyRecommendation[] = [];
  if (!context.conversation || context.conversation.length < 3) return results;

  const messages = context.conversation;
  const userMessages = messages.filter(m => m.role === 'user');
  const model = context.model ?? 'gpt-4o';

  // 1. Detect repeated context across user messages
  if (userMessages.length >= 2) {
    let totalOverlapTokens = 0;

    for (let i = 0; i < userMessages.length; i++) {
      for (let j = i + 1; j < userMessages.length; j++) {
        const ngramsA = getNgrams(userMessages[i].content, 4);
        const ngramsB = getNgrams(userMessages[j].content, 4);
        const overlap = computeOverlap(ngramsA, ngramsB);

        // Each overlapping 4-gram represents ~4 tokens of repeated content
        totalOverlapTokens += overlap * 4;
      }
    }

    // Deduplicate: approximate unique overlap
    const estimatedRepeated = Math.round(totalOverlapTokens / Math.max(userMessages.length - 1, 1));

    if (estimatedRepeated > 500) {
      const commonContext = extractCommonContext(userMessages);
      results.push({
        id: 'reduce-repeated-context',
        name: 'Reduce repeated context in messages',
        category: 'conversation',
        description:
          `Detected ~${estimatedRepeated.toLocaleString()} tokens of repeated context across your messages. ` +
          'Move shared context into a system prompt, CLAUDE.md, or project file to avoid re-sending it every message.',
        impact: 'high',
        estimatedTokenSavings: estimatedRepeated,
        estimatedCostSavings: (estimatedRepeated / 1_000_000) * 3.0,
        actionDescription: 'Extract common context into a reusable file',
        generatedContent: commonContext || undefined,
        targetFile: commonContext ? 'shared-context.md' : undefined,
        createsFile: !!commonContext,
      });
    }
  }

  // 2. Conversation pruning for long conversations
  if (messages.length > 20) {
    const earlyMessages = messages.slice(0, Math.floor(messages.length * 0.3));
    const lateMessages = messages.slice(Math.floor(messages.length * 0.7));

    // Check if early context is still referenced
    const earlyKeywords = new Set<string>();
    for (const m of earlyMessages) {
      const words = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      words.forEach(w => earlyKeywords.add(w));
    }

    const lateKeywords = new Set<string>();
    for (const m of lateMessages) {
      const words = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      words.forEach(w => lateKeywords.add(w));
    }

    const overlap = computeOverlap(earlyKeywords, lateKeywords);
    const overlapRatio = earlyKeywords.size > 0 ? overlap / earlyKeywords.size : 0;

    // If less than 30% of early topics are still relevant
    if (overlapRatio < 0.3) {
      const prunePoint = Math.floor(messages.length * 0.3);
      let prunedTokens = 0;
      for (const m of earlyMessages) {
        prunedTokens += countTokens(m.content, model).inputTokens;
      }

      const summary = generateConversationSummary(messages, prunePoint);
      results.push({
        id: 'prune-conversation',
        name: 'Prune stale conversation history',
        category: 'conversation',
        description:
          `The first ${prunePoint} messages contain context that is no longer referenced in recent messages. ` +
          `Starting a new conversation with a summary could save ~${prunedTokens.toLocaleString()} tokens per message.`,
        impact: 'high',
        estimatedTokenSavings: prunedTokens,
        estimatedCostSavings: (prunedTokens / 1_000_000) * 3.0,
        actionDescription: `Generate a summary of messages 1-${prunePoint} to start a fresh conversation`,
        generatedContent: summary,
      });
    }
  }

  // 3. Detect very long individual messages
  for (let i = 0; i < userMessages.length; i++) {
    const tokens = countTokens(userMessages[i].content, model).inputTokens;
    if (tokens > 2000) {
      results.push({
        id: `long-message-${i}`,
        name: 'Break up long message',
        category: 'conversation',
        description:
          `Message ${i + 1} is ${tokens.toLocaleString()} tokens. Very long messages reduce response quality ` +
          'and waste tokens. Consider breaking it into smaller, focused prompts.',
        impact: 'medium',
        estimatedTokenSavings: Math.round(tokens * 0.2), // ~20% savings from focused prompts
        estimatedCostSavings: (tokens * 0.2 / 1_000_000) * 3.0,
        actionDescription: 'Break this message into smaller, focused prompts',
      });
      break; // Only report first long message
    }
  }

  return results;
}
