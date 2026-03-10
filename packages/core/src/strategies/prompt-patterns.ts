import type { StrategyContext, StrategyRecommendation } from './types.js';
import { optimize } from '../optimizer/index.js';
import { countTokens } from '../tokenizer/index.js';

const FORMAT_KEYWORDS = /\b(?:bullet|list|concise|brief|json|format|short|succinct|numbered|markdown|table|csv|xml|one.?line|one.?word|paragraph|sentence)\b/i;

export function analyzePromptPatterns(context: StrategyContext): StrategyRecommendation[] {
  const results: StrategyRecommendation[] = [];
  if (!context.conversation || context.conversation.length === 0) return results;

  const model = context.model ?? 'gpt-4o';
  const userMessages = context.conversation.filter(m => m.role === 'user');
  if (userMessages.length === 0) return results;

  // 1. Missing output format constraints
  const missingFormatCount = userMessages.filter(m =>
    m.content.length > 50 && !FORMAT_KEYWORDS.test(m.content)
  ).length;

  if (missingFormatCount > userMessages.length * 0.5 && userMessages.length >= 3) {
    results.push({
      id: 'add-format-constraints',
      name: 'Add output format constraints',
      category: 'prompt-engineering',
      description:
        `${missingFormatCount} of ${userMessages.length} prompts lack output format guidance. ` +
        'Adding constraints like "Respond concisely in 3 bullet points" or "Keep response under 100 words" ' +
        'can reduce output tokens by 30-60%.',
      impact: 'high',
      estimatedTokenSavings: missingFormatCount * 200,
      estimatedCostSavings: (missingFormatCount * 200 / 1_000_000) * 15.0, // output pricing
      actionDescription: 'Add format constraints to your prompts to control response length',
    });
  }

  // 2. High verbosity across messages
  let totalVerbosity = 0;
  let totalPotentialSavings = 0;

  for (const msg of userMessages) {
    if (msg.content.length > 30) {
      const optimized = optimize(msg.content, model);
      totalVerbosity += optimized.verbosityScore;
      totalPotentialSavings += optimized.tokenReduction;
    }
  }

  const avgVerbosity = Math.round(totalVerbosity / Math.max(userMessages.length, 1));

  if (avgVerbosity > 40 && totalPotentialSavings > 50) {
    results.push({
      id: 'high-verbosity',
      name: 'Prompts are consistently verbose',
      category: 'prompt-engineering',
      description:
        `Average verbosity score: ${avgVerbosity}/100 across ${userMessages.length} prompts. ` +
        `Running your prompts through PromptFuel's optimizer could save ~${totalPotentialSavings.toLocaleString()} tokens total.`,
      impact: avgVerbosity > 60 ? 'high' : 'medium',
      estimatedTokenSavings: totalPotentialSavings,
      estimatedCostSavings: (totalPotentialSavings / 1_000_000) * 3.0,
      actionDescription: 'Use "promptfuel optimize" before sending prompts to reduce verbosity',
    });
  }

  // 3. System prompt optimization (first message if very long)
  if (userMessages.length > 0) {
    const firstMsg = userMessages[0];
    const firstMsgTokens = countTokens(firstMsg.content, model).inputTokens;

    if (firstMsgTokens > 500 && userMessages.length > 3) {
      const optimized = optimize(firstMsg.content, model);
      if (optimized.tokenReduction > 100) {
        results.push({
          id: 'optimize-system-prompt',
          name: 'Optimize your system prompt / initial context',
          category: 'prompt-engineering',
          description:
            `Your initial message is ${firstMsgTokens.toLocaleString()} tokens. Since this gets re-sent with every ` +
            `message in the conversation, optimizing it could save ~${optimized.tokenReduction} tokens per exchange ` +
            `(${optimized.tokenReduction * (context.conversation!.length / 2)} tokens across this conversation).`,
          impact: 'high',
          estimatedTokenSavings: optimized.tokenReduction * Math.round(context.conversation!.length / 2),
          estimatedCostSavings: (optimized.tokenReduction * (context.conversation!.length / 2) / 1_000_000) * 3.0,
          actionDescription: 'Compress your system prompt using PromptFuel optimizer',
          generatedContent: optimized.optimizedPrompt,
        });
      }
    }
  }

  // 4. Claude cache optimization
  if (model.includes('claude') && context.conversation && context.conversation.length > 5) {
    results.push({
      id: 'use-claude-cache',
      name: 'Enable Claude prompt caching',
      category: 'prompt-engineering',
      description:
        'Claude supports prompt caching which can reduce costs by up to 90% for repeated context. ' +
        'Add cache_control breakpoints to your system prompt and static context blocks via the API.',
      impact: 'high',
      estimatedTokenSavings: 0,
      estimatedCostSavings: 0.01, // Approximate
      actionDescription: 'Add cache_control headers to your Claude API calls',
    });
  }

  return results;
}
