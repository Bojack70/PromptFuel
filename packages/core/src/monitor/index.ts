import { countTokens } from '../tokenizer/index.js';
import { getContextWindow } from '../cost/models.js';

export type WarningLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface ContextStatus {
  totalTokens: number;
  percentUsed: number;
  warning: WarningLevel;
  remainingTokens: number;
  contextWindow: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Claude cache tracking
export interface CacheStats {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  cacheHitRate: number;
  estimatedCacheSavings: number;
}

export interface CachedMessage extends Message {
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

function getWarningLevel(percentUsed: number): WarningLevel {
  if (percentUsed >= 90) return 'red';
  if (percentUsed >= 75) return 'orange';
  if (percentUsed >= 50) return 'yellow';
  return 'green';
}

export function monitorContext(messages: Message[], model: string): ContextStatus {
  const contextWindow = getContextWindow(model);

  let totalTokens = 0;
  for (const message of messages) {
    // Each message has ~4 tokens of overhead for role/formatting
    totalTokens += countTokens(message.content, model).inputTokens + 4;
  }

  const percentUsed = Math.round((totalTokens / contextWindow) * 100);
  const remainingTokens = Math.max(0, contextWindow - totalTokens);
  const warning = getWarningLevel(percentUsed);

  return {
    totalTokens,
    percentUsed: Math.min(percentUsed, 100),
    warning,
    remainingTokens,
    contextWindow,
  };
}

// Claude cache analysis — tracks cache creation vs cache read tokens
// Cache read tokens cost 90% less than regular input tokens on Claude
export function analyzeClaudeCache(messages: CachedMessage[], model: string): CacheStats {
  let totalInputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for (const msg of messages) {
    const inputTokens = countTokens(msg.content, model).inputTokens;
    totalInputTokens += inputTokens;
    cacheCreationTokens += msg.cacheCreationTokens ?? 0;
    cacheReadTokens += msg.cacheReadTokens ?? 0;
  }

  const totalCacheable = cacheReadTokens + cacheCreationTokens;
  const cacheHitRate = totalCacheable > 0
    ? cacheReadTokens / totalCacheable
    : 0;

  // Claude cache pricing:
  // - Cache creation: 1.25x base input price (25% surcharge)
  // - Cache read: 0.1x base input price (90% discount)
  // Savings = what you'd pay without cache - what you pay with cache
  const baseRate = 3.00 / 1_000_000; // Claude Sonnet default rate per token
  const withoutCache = (cacheReadTokens + cacheCreationTokens) * baseRate;
  const withCache = (cacheCreationTokens * baseRate * 1.25) + (cacheReadTokens * baseRate * 0.1);
  const estimatedCacheSavings = Math.max(0, withoutCache - withCache);

  return {
    cacheCreationTokens,
    cacheReadTokens,
    totalInputTokens,
    cacheHitRate: Math.round(cacheHitRate * 1000) / 10, // e.g. 71.5%
    estimatedCacheSavings: Math.round(estimatedCacheSavings * 1_000_000) / 1_000_000,
  };
}

export class ContextMonitor {
  private messages: CachedMessage[] = [];
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  addMessage(message: CachedMessage): ContextStatus {
    this.messages.push(message);
    return this.getStatus();
  }

  getStatus(): ContextStatus {
    return monitorContext(this.messages, this.model);
  }

  getCacheStats(): CacheStats {
    return analyzeClaudeCache(this.messages, this.model);
  }

  getMessages(): CachedMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  setModel(model: string): void {
    this.model = model;
  }
}
