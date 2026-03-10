// Tokenizer
export { countTokens, countOpenAITokens, countClaudeTokens, getProvider } from './tokenizer/index.js';
export type { TokenCount, ModelProvider } from './tokenizer/index.js';

// Optimizer
export { optimize, scoreVerbosity, registerRule, unregisterRule, clearRules, getRegisteredRules } from './optimizer/index.js';
export type { OptimizationResult, OptimizeOutput, CustomRule } from './optimizer/index.js';

// Intent
export { detectIntent } from './optimizer/intent.js';
export type { PromptIntent, PromptIntentType, OptimizeOptions, BudgetResult } from './optimizer/intent.js';

// Rewriter
export { rewrite } from './optimizer/rewriter/index.js';
export type { RewriteResult, AppliedRewrite, RewritePassName } from './optimizer/rewriter/index.js';

// Cost
export { calculateCost, formatCost, getModelInfo, listModels, getContextWindow, PRICING_LAST_UPDATED } from './cost/index.js';
export type { CostEstimate, ModelInfo } from './cost/index.js';

// Monitor
export { monitorContext, analyzeClaudeCache, ContextMonitor } from './monitor/index.js';
export type { ContextStatus, WarningLevel, Message, CacheStats, CachedMessage } from './monitor/index.js';

// Strategies
export { analyzeStrategies } from './strategies/index.js';
export type { StrategyContext, StrategyRecommendation, StrategyAnalysis } from './strategies/index.js';

// Cache Analysis
export { analyzeCacheOpportunity } from './cache/index.js';
export type { CachePromptEntry, PromptCluster, CacheAnalysis, CacheSetupGuide } from './cache/index.js';
