import { describe, it, expect } from 'vitest';
import { countTokens, countClaudeTokens, getProvider } from '../index.js';

describe('tokenizer', () => {
  describe('getProvider', () => {
    it('returns openai for GPT models', () => {
      expect(getProvider('gpt-4o')).toBe('openai');
      expect(getProvider('gpt-3.5-turbo')).toBe('openai');
      expect(getProvider('o1')).toBe('openai');
    });

    it('returns anthropic for Claude models', () => {
      expect(getProvider('claude-sonnet-4-6')).toBe('anthropic');
      expect(getProvider('claude-opus-4-6')).toBe('anthropic');
    });
  });

  describe('countTokens', () => {
    it('returns zero for empty text', () => {
      const result = countTokens('', 'claude-sonnet-4-6');
      expect(result.inputTokens).toBe(0);
    });

    it('counts tokens for Claude models', () => {
      const result = countTokens('Hello, how are you today?', 'claude-sonnet-4-6');
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.estimatedOutputTokens).toBeGreaterThan(0);
    });

    it('counts tokens for OpenAI models', () => {
      const result = countTokens('Hello, how are you today?', 'gpt-4o');
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.estimatedOutputTokens).toBeGreaterThan(0);
    });

    it('estimates more output tokens for code requests', () => {
      const codeResult = countTokens('Write a function to sort an array', 'gpt-4o');
      const questionResult = countTokens('What is the capital of France?', 'gpt-4o');
      expect(codeResult.estimatedOutputTokens).toBeGreaterThan(questionResult.estimatedOutputTokens);
    });
  });

  describe('countClaudeTokens', () => {
    it('returns 0 for empty string', () => {
      expect(countClaudeTokens('')).toBe(0);
    });

    it('estimates tokens for English text', () => {
      const tokens = countClaudeTokens('This is a test sentence with some words.');
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(30);
    });

    it('estimates more tokens for code', () => {
      const english = countClaudeTokens('This is a simple sentence.');
      const code = countClaudeTokens('function foo() { return bar.map(x => x * 2); }');
      // Code should have roughly more tokens per character
      const englishRatio = english / 'This is a simple sentence.'.length;
      const codeRatio = code / 'function foo() { return bar.map(x => x * 2); }'.length;
      expect(codeRatio).toBeGreaterThanOrEqual(englishRatio * 0.8);
    });
  });
});
