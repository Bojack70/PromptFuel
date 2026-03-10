import { describe, it, expect } from 'vitest';
import { calculateCost, formatCost, getModelInfo, listModels, getContextWindow } from '../index.js';

describe('cost', () => {
  describe('calculateCost', () => {
    it('calculates cost for GPT-4o', () => {
      const cost = calculateCost(1000, 500, 'gpt-4o');
      // GPT-4o: $2.50/1M input, $10.00/1M output
      expect(cost.inputCost).toBeCloseTo(0.0025, 4);
      expect(cost.outputCost).toBeCloseTo(0.005, 4);
      expect(cost.totalCost).toBeCloseTo(0.0075, 4);
      expect(cost.currency).toBe('USD');
    });

    it('calculates cost for Claude Sonnet', () => {
      const cost = calculateCost(1000, 500, 'claude-sonnet-4-6');
      // Claude Sonnet: $3.00/1M input, $15.00/1M output
      expect(cost.inputCost).toBeCloseTo(0.003, 4);
      expect(cost.outputCost).toBeCloseTo(0.0075, 4);
    });

    it('returns zero for zero tokens', () => {
      const cost = calculateCost(0, 0, 'gpt-4o');
      expect(cost.totalCost).toBe(0);
    });

    it('returns fallback pricing for unknown model', () => {
      const cost = calculateCost(100, 100, 'unknown-model');
      expect(cost.totalCost).toBeGreaterThan(0);
    });
  });

  describe('formatCost', () => {
    it('formats small costs with 6 decimals', () => {
      expect(formatCost(0.000025)).toBe('$0.000025');
    });

    it('formats medium costs with 4 decimals', () => {
      expect(formatCost(0.05)).toBe('$0.0500');
    });

    it('formats large costs with 2 decimals', () => {
      expect(formatCost(1.5)).toBe('$1.50');
    });
  });

  describe('getModelInfo', () => {
    it('returns model info for known models', () => {
      const info = getModelInfo('gpt-4o');
      expect(info.input).toBe(2.50);
      expect(info.output).toBe(10.00);
      expect(info.context).toBe(128000);
    });

    it('returns fallback for unknown model', () => {
      const info = getModelInfo('fake-model');
      expect(info.input).toBeGreaterThan(0);
      expect(info.output).toBeGreaterThan(0);
      expect(info.context).toBeGreaterThan(0);
    });

    it('matches model variants to base model', () => {
      const info = getModelInfo('gpt-4o-2024-11-20');
      expect(info.input).toBe(2.50);
    });
  });

  describe('listModels', () => {
    it('returns array of model names', () => {
      const models = listModels();
      expect(models).toContain('gpt-4o');
      expect(models).toContain('claude-sonnet-4-6');
      expect(models.length).toBeGreaterThan(5);
    });
  });

  describe('getContextWindow', () => {
    it('returns context window size', () => {
      expect(getContextWindow('gpt-4o')).toBe(128000);
      expect(getContextWindow('claude-sonnet-4-6')).toBe(200000);
    });
  });
});
