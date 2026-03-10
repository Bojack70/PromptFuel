import type { StrategyContext, StrategyAnalysis } from './types.js';
import { analyzeProjectConfig } from './project-config.js';
import { analyzeConversation } from './conversation.js';
import { analyzeModelUsage } from './model-selection.js';
import { analyzePromptPatterns } from './prompt-patterns.js';

export function analyzeStrategies(context: StrategyContext): StrategyAnalysis {
  const recommendations = [
    ...analyzeProjectConfig(context),
    ...analyzeConversation(context),
    ...analyzeModelUsage(context),
    ...analyzePromptPatterns(context),
  ];

  // Sort by impact (high first), then by estimated savings
  const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => {
    return (impactOrder[a.impact] ?? 2) - (impactOrder[b.impact] ?? 2)
      || b.estimatedTokenSavings - a.estimatedTokenSavings;
  });

  return {
    recommendations,
    totalEstimatedTokenSavings: recommendations.reduce((s, r) => s + r.estimatedTokenSavings, 0),
    totalEstimatedCostSavings: recommendations.reduce((s, r) => s + r.estimatedCostSavings, 0),
    projectSummary: generateProjectSummary(context),
  };
}

function generateProjectSummary(context: StrategyContext): string {
  const parts: string[] = [];

  if (context.fileContents?.['package.json']) {
    try {
      const pkg = JSON.parse(context.fileContents['package.json']);
      parts.push(`Project: ${pkg.name ?? 'Unknown'}`);
      if (pkg.description) parts.push(pkg.description);
    } catch { /* ignore */ }
  }

  if (context.projectFiles) {
    parts.push(`${context.projectFiles.length} files scanned`);
  }

  if (context.conversation) {
    parts.push(`${context.conversation.length} messages analyzed`);
  }

  if (context.model) {
    parts.push(`Model: ${context.model}`);
  }

  return parts.join(' | ');
}

export type { StrategyContext, StrategyRecommendation, StrategyAnalysis } from './types.js';
