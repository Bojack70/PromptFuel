import { getModelInfo } from './models.js';

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): CostEstimate {
  const info = getModelInfo(model);

  const inputCost = (inputTokens / 1_000_000) * info.input;
  const outputCost = (outputTokens / 1_000_000) * info.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: roundToSixDecimals(inputCost),
    outputCost: roundToSixDecimals(outputCost),
    totalCost: roundToSixDecimals(totalCost),
    currency: 'USD',
  };
}

export function formatCost(cost: number): string {
  if (typeof cost !== 'number' || isNaN(cost) || !isFinite(cost) || cost < 0) {
    return '$0.000000';
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(6)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

function roundToSixDecimals(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export { getModelInfo, listModels, getContextWindow, PRICING_LAST_UPDATED } from './models.js';
export type { ModelInfo } from './models.js';
