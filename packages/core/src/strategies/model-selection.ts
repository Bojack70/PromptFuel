import type { StrategyContext, StrategyRecommendation } from './types.js';
import { getModelInfo } from '../cost/index.js';
import { countTokens } from '../tokenizer/index.js';

export function analyzeModelUsage(context: StrategyContext): StrategyRecommendation[] {
  const results: StrategyRecommendation[] = [];
  if (!context.model) return results;

  let modelInfo;
  try {
    modelInfo = getModelInfo(context.model);
  } catch {
    return results;
  }

  // 1. Expensive model for simple/short prompts
  if (context.conversation && context.conversation.length > 0) {
    const userMessages = context.conversation.filter(m => m.role === 'user');
    if (userMessages.length === 0) return results;

    const avgLength = userMessages.reduce((s, m) => s + m.content.length, 0) / userMessages.length;

    // If using expensive model ($10+/1M input) for short prompts (<200 chars avg)
    if (modelInfo.input >= 10 && avgLength < 200) {
      // Calculate potential savings with a cheaper model
      const totalTokens = userMessages.reduce(
        (s, m) => s + countTokens(m.content, context.model!).inputTokens,
        0,
      );
      const currentCost = (totalTokens / 1_000_000) * modelInfo.input;

      // Suggest gpt-4o-mini or claude-haiku based on current model family
      const isClaude = context.model.includes('claude');
      const cheapModel = isClaude ? 'claude-haiku-4-5' : 'gpt-4o-mini';
      let cheapInfo;
      try {
        cheapInfo = getModelInfo(cheapModel);
      } catch {
        return results;
      }

      const cheapCost = (totalTokens / 1_000_000) * cheapInfo.input;
      const savings = currentCost - cheapCost;

      if (savings > 0.001) {
        results.push({
          id: 'model-downgrade',
          name: 'Consider a cheaper model',
          category: 'model-selection',
          description:
            `You're using ${context.model} ($${modelInfo.input.toFixed(2)}/1M tokens) for relatively simple prompts ` +
            `(avg ${Math.round(avgLength)} chars). ${cheapModel} ($${cheapInfo.input.toFixed(2)}/1M tokens) ` +
            `could handle these tasks at a fraction of the cost.`,
          impact: 'medium',
          estimatedTokenSavings: 0,
          estimatedCostSavings: savings,
          actionDescription: `Switch to ${cheapModel} for simple tasks`,
        });
      }
    }
  }

  // 2. Context window utilization check
  if (context.conversation && context.conversation.length > 0) {
    let totalTokens = 0;
    for (const m of context.conversation) {
      totalTokens += countTokens(m.content, context.model).inputTokens;
    }

    const utilization = totalTokens / modelInfo.contextWindow;

    // If using large context model but only using <10%
    if (modelInfo.contextWindow >= 128000 && utilization < 0.1 && modelInfo.input >= 5) {
      results.push({
        id: 'context-window-oversize',
        name: 'Model context window is oversized for this usage',
        category: 'model-selection',
        description:
          `You're using only ${Math.round(utilization * 100)}% of ${context.model}'s ` +
          `${(modelInfo.contextWindow / 1000).toFixed(0)}K context window. ` +
          'A smaller, cheaper model would work just as well for this conversation size.',
        impact: 'low',
        estimatedTokenSavings: 0,
        estimatedCostSavings: 0,
        actionDescription: 'Consider a model with a smaller context window for cost savings',
      });
    }
  }

  return results;
}
