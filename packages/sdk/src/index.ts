import {
  countTokens,
  calculateCost,
  formatCost,
  optimize,
  ContextMonitor,
  monitorContext,
  listModels,
  getModelInfo,
  getContextWindow,
  type TokenCount,
  type CostEstimate,
  type OptimizeOutput,
  type ContextStatus,
  type Message,
  type ModelInfo,
} from '@promptfuel/core';

export interface PromptFuelOptions {
  model?: string;
}

export interface AnalysisResult {
  tokens: {
    input: number;
    estimatedOutput: number;
    total: number;
  };
  cost: {
    input: string;
    output: string;
    total: string;
    raw: CostEstimate;
  };
}

export class PromptFuel {
  private model: string;

  constructor(options: PromptFuelOptions = {}) {
    this.model = options.model ?? 'gpt-4o';
  }

  analyze(text: string): AnalysisResult {
    const tokens = countTokens(text, this.model);
    const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, this.model);

    return {
      tokens: {
        input: tokens.inputTokens,
        estimatedOutput: tokens.estimatedOutputTokens,
        total: tokens.inputTokens + tokens.estimatedOutputTokens,
      },
      cost: {
        input: formatCost(cost.inputCost),
        output: formatCost(cost.outputCost),
        total: formatCost(cost.totalCost),
        raw: cost,
      },
    };
  }

  optimize(text: string): OptimizeOutput {
    return optimize(text, this.model);
  }

  createMonitor(model?: string): ContextMonitor {
    return new ContextMonitor(model ?? this.model);
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  static listModels(): string[] {
    return listModels();
  }

  static getModelInfo(model: string): ModelInfo {
    return getModelInfo(model);
  }

  static getContextWindow(model: string): number {
    return getContextWindow(model);
  }
}

// Re-export core types for convenience
export type {
  TokenCount,
  CostEstimate,
  OptimizeOutput,
  OptimizationResult,
  ContextStatus,
  WarningLevel,
  Message,
  ModelInfo,
  CustomRule,
} from '@promptfuel/core';

export { formatCost, countTokens, calculateCost, registerRule, unregisterRule, clearRules, getRegisteredRules } from '@promptfuel/core';
