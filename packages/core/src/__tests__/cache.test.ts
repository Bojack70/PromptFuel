import { describe, it, expect } from 'vitest';
import { analyzeCacheOpportunity } from '../cache/index.js';
import type { CachePromptEntry } from '../cache/index.js';

function makeEntry(prompt: string, tokens = 100, cost = 0.01, model = 'claude-sonnet-4-6'): CachePromptEntry {
  return { prompt, tokens, cost, model };
}

describe('analyzeCacheOpportunity', () => {
  it('returns empty analysis with setup guides for empty input', () => {
    const result = analyzeCacheOpportunity([]);
    expect(result.clusters).toHaveLength(0);
    expect(result.totalPrompts).toBe(0);
    expect(result.cacheablePrompts).toBe(0);
    expect(result.estimatedCacheHitRate).toBe(0);
    expect(result.estimatedMonthlySavings).toBe(0);
    expect(result.setupGuides).toHaveLength(3);
    expect(result.setupGuides[0].id).toBe('anthropic-cache');
  });

  it('clusters identical prompts correctly', () => {
    const prompt = 'Explain the difference between async and await in JavaScript';
    const entries = [
      makeEntry(prompt, 200, 0.05),
      makeEntry(prompt, 200, 0.05),
      makeEntry(prompt, 200, 0.05),
    ];
    const result = analyzeCacheOpportunity(entries);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].promptCount).toBe(3);
    // N-1 = 2 prompts are cacheable
    expect(result.cacheablePrompts).toBe(2);
    // Savings = 2 * 0.05 * 0.9 = 0.09
    expect(result.estimatedMonthlySavings).toBeCloseTo(0.09, 2);
  });

  it('clusters similar (not identical) prompts together', () => {
    const entries = [
      makeEntry('Write a function to sort an array of numbers in JavaScript', 150, 0.03),
      makeEntry('Write a function to sort an array of strings in JavaScript', 150, 0.03),
      makeEntry('Write a function to sort an array of objects in JavaScript', 150, 0.03),
    ];
    const result = analyzeCacheOpportunity(entries);

    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    // All three should be in one cluster since they share most keywords
    const biggestCluster = result.clusters[0];
    expect(biggestCluster.promptCount).toBeGreaterThanOrEqual(2);
  });

  it('does not cluster unrelated prompts', () => {
    const entries = [
      makeEntry('Explain quantum computing and its applications in cryptography', 200, 0.05),
      makeEntry('Write a recipe for chocolate chip cookies with brown butter', 200, 0.05),
      makeEntry('Describe the migration patterns of arctic terns across hemispheres', 200, 0.05),
    ];
    const result = analyzeCacheOpportunity(entries);

    // No clusters should form — all prompts are unrelated
    expect(result.clusters).toHaveLength(0);
    expect(result.cacheablePrompts).toBe(0);
    expect(result.estimatedMonthlySavings).toBe(0);
  });

  it('skips short prompts (fewer than 5 words)', () => {
    const entries = [
      makeEntry('yes', 5, 0.001),
      makeEntry('ok', 5, 0.001),
      makeEntry('no thanks', 5, 0.001),
      makeEntry('do it', 5, 0.001),
    ];
    const result = analyzeCacheOpportunity(entries);

    expect(result.clusters).toHaveLength(0);
    expect(result.totalPrompts).toBe(4);
    expect(result.cacheablePrompts).toBe(0);
  });

  it('calculates correct cache hit rate for repeated prompts', () => {
    const prompt = 'Refactor this component to use React hooks instead of class methods';
    const entries = Array.from({ length: 10 }, () => makeEntry(prompt, 300, 0.10));
    const result = analyzeCacheOpportunity(entries);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].promptCount).toBe(10);
    // 9 out of 10 are cacheable = 90% hit rate
    expect(result.estimatedCacheHitRate).toBeCloseTo(90, 0);
  });

  it('sorts clusters by savings descending', () => {
    const entries = [
      // Cheap cluster (2 identical)
      makeEntry('Write a hello world program in Python with comments', 50, 0.01),
      makeEntry('Write a hello world program in Python with comments', 50, 0.01),
      // Expensive cluster (3 identical)
      makeEntry('Analyze the full codebase and refactor all database queries', 500, 0.50),
      makeEntry('Analyze the full codebase and refactor all database queries', 500, 0.50),
      makeEntry('Analyze the full codebase and refactor all database queries', 500, 0.50),
    ];
    const result = analyzeCacheOpportunity(entries);

    expect(result.clusters.length).toBe(2);
    // Expensive cluster should be first
    expect(result.clusters[0].cacheableCost).toBeGreaterThan(result.clusters[1].cacheableCost);
  });
});
