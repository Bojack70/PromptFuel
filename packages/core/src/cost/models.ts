import pricingData from './pricing.json' with { type: 'json' };

export interface ModelInfo {
  input: number;   // Price per 1M input tokens
  output: number;  // Price per 1M output tokens
  context: number; // Context window size in tokens
}

// Extract metadata and model entries
const { _lastUpdated, ...modelEntries } = pricingData as Record<string, unknown>;

export const PRICING_LAST_UPDATED: string = (_lastUpdated as string) ?? 'unknown';
export const MODELS: Record<string, ModelInfo> = modelEntries as Record<string, ModelInfo>;

// Default fallback for unknown model variants (e.g. "gpt-4o-2024-11-20")
const DEFAULT_FALLBACK: ModelInfo = { input: 2.50, output: 10.00, context: 128000 };

export function getModelInfo(model: string): ModelInfo {
  if (!model) return DEFAULT_FALLBACK;

  const info = MODELS[model];
  if (info) return info;

  // Try matching a known base model (e.g. "gpt-4o-2024-11-20" → "gpt-4o")
  for (const knownModel of Object.keys(MODELS)) {
    if (model.startsWith(knownModel)) {
      return MODELS[knownModel];
    }
  }

  // Return fallback instead of crashing — uses GPT-4o pricing as safe default
  return DEFAULT_FALLBACK;
}

export function listModels(): string[] {
  return Object.keys(MODELS);
}

export function getContextWindow(model: string): number {
  return getModelInfo(model).context;
}
