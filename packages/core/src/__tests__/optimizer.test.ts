import { describe, it, expect, afterEach } from 'vitest';
import { optimize, scoreVerbosity, registerRule, unregisterRule, clearRules, getRegisteredRules } from '../index.js';
import type { CustomRule } from '../index.js';
import { countTokens } from '../index.js';

describe('optimizer', () => {
  describe('optimize', () => {
    it('removes filler phrases', () => {
      const result = optimize('I would like you to explain how React works', 'gpt-4o');
      expect(result.optimizedPrompt.toLowerCase()).not.toContain('i would like you to');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('replaces filler phrases with concise alternatives', () => {
      const result = optimize('In order to build a website, you need HTML', 'gpt-4o');
      expect(result.optimizedPrompt.toLowerCase()).toContain('to build');
      expect(result.optimizedPrompt.toLowerCase()).not.toContain('in order to');
    });

    it('shows token reduction', () => {
      const verbose = 'I would like you to please make sure to explain how React works. It is important that you cover hooks. Please be sure to include examples.';
      const result = optimize(verbose, 'gpt-4o');
      expect(result.tokenReduction).toBeGreaterThan(0);
      expect(result.reductionPercent).toBeGreaterThan(0);
      expect(result.optimizedTokens).toBeLessThan(result.originalTokens);
    });

    it('cleans formatting', () => {
      const messy = 'Hello\n\n\n\n\nworld   with   spaces';
      const result = optimize(messy, 'gpt-4o');
      expect(result.optimizedPrompt).not.toContain('\n\n\n');
      expect(result.optimizedPrompt).not.toContain('   ');
    });

    it('returns suggestions for redundant text', () => {
      const redundant = 'Make it fast. The code should be fast. Performance is key. The code must be fast.';
      const result = optimize(redundant, 'gpt-4o');
      const redundancySuggestions = result.suggestions.filter(s =>
        s.rule === 'redundancy' || s.rule === 'duplicate-instruction'
      );
      expect(redundancySuggestions.length).toBeGreaterThan(0);
    });
  });

  describe('scoreVerbosity', () => {
    it('returns 0 for empty text', () => {
      expect(scoreVerbosity('')).toBe(0);
    });

    it('returns low score for concise text', () => {
      const score = scoreVerbosity('Explain React hooks with examples.');
      expect(score).toBeLessThan(40);
    });

    it('returns higher score for verbose text', () => {
      const verbose = 'I would really like it if you could basically just sort of explain to me how React hooks actually work. I think it is very important and I honestly believe that you should really cover the basics. Just make sure you kind of include some examples if you know what I mean.';
      const score = scoreVerbosity(verbose);
      expect(score).toBeGreaterThan(30);
    });
  });

  describe('intent override', () => {
    it('accepts a manual intent override and sets confidence to 1', () => {
      const result = optimize('Explain React hooks', 'gpt-4o', { intent: 'code-gen' });
      expect(result.intent?.type).toBe('code-gen');
      expect(result.intent?.confidence).toBe(1);
      expect(result.intent?.matchedSignals).toContain('manual-override');
    });

    it('auto-detects intent when no override is given', () => {
      const result = optimize('Explain how closures work in JavaScript', 'gpt-4o');
      expect(result.intent?.type).toBe('explain');
    });

    it('returns general intent for ambiguous prompts', () => {
      const result = optimize('hello', 'gpt-4o');
      expect(result.intent?.type).toBe('general');
    });

    it('includes intent in output even for general', () => {
      const result = optimize('hello world', 'gpt-4o');
      expect(result.intent).toBeDefined();
    });
  });

  describe('token budget targeting', () => {
    const verbosePrompt = 'I would like you to please make sure to very carefully and thoroughly explain in great detail how React hooks work, why they are useful, and please be sure to include multiple clear examples so I can really understand. It is very important that you cover useState, useEffect, and useCallback with detailed explanations for each one.';

    it('returns a budget result when targetTokens is set', () => {
      const result = optimize(verbosePrompt, 'gpt-4o', { targetTokens: 1000 });
      expect(result.budget).toBeDefined();
      expect(result.budget?.targetTokens).toBe(1000);
    });

    it('budget.levelApplied is between 1 and 4', () => {
      const result = optimize(verbosePrompt, 'gpt-4o', { targetTokens: 500 });
      expect(result.budget?.levelApplied).toBeGreaterThanOrEqual(1);
      expect(result.budget?.levelApplied).toBeLessThanOrEqual(4);
    });

    it('budget.targetMet is true when prompt already fits', () => {
      const shortPrompt = 'Explain React';
      const tokens = countTokens(shortPrompt, 'gpt-4o').inputTokens;
      const result = optimize(shortPrompt, 'gpt-4o', { targetTokens: tokens + 50 });
      expect(result.budget?.targetMet).toBe(true);
      expect(result.budget?.remainingGap).toBe(0);
    });

    it('budget.remainingGap is 0 when target is met', () => {
      const result = optimize(verbosePrompt, 'gpt-4o', { targetTokens: 10000 });
      expect(result.budget?.targetMet).toBe(true);
      expect(result.budget?.remainingGap).toBe(0);
    });

    it('produces no budget result when targetTokens is not set', () => {
      const result = optimize(verbosePrompt, 'gpt-4o');
      expect(result.budget).toBeUndefined();
    });

    it('optimized prompt has fewer tokens than original when budget forces compression', () => {
      const result = optimize(verbosePrompt, 'gpt-4o', { targetTokens: 10 });
      expect(result.optimizedTokens).toBeLessThan(result.originalTokens);
    });
  });

  describe('custom rules plugin system', () => {
    afterEach(() => {
      clearRules();
    });

    it('registers and runs a custom detect rule', () => {
      const rule: CustomRule = {
        name: 'no-please',
        detect: (text) => {
          const matches = text.match(/\bplease\b/gi);
          if (matches && matches.length > 0) {
            return [{
              original: 'please',
              optimized: '',
              tokensSaved: 0,
              rule: 'no-please',
              description: 'Remove unnecessary "please" — LLMs don\'t need politeness tokens',
            }];
          }
          return [];
        },
      };
      registerRule(rule);
      const result = optimize('Please explain React hooks please', 'gpt-4o');
      const custom = result.suggestions.filter(s => s.rule === 'no-please');
      expect(custom.length).toBeGreaterThan(0);
    });

    it('applies custom rule transforms', () => {
      const rule: CustomRule = {
        name: 'shout-remover',
        detect: (text) => {
          if (text !== text.toLowerCase() && text === text.toUpperCase()) {
            return [{
              original: text,
              optimized: text.toLowerCase(),
              tokensSaved: 0,
              rule: 'shout-remover',
              description: 'Convert ALL CAPS to lowercase',
            }];
          }
          return [];
        },
        apply: (text) => {
          // Convert ALL-CAPS words to lowercase
          return text.replace(/\b[A-Z]{2,}\b/g, m => m.toLowerCase());
        },
      };
      registerRule(rule);
      const result = optimize('EXPLAIN HOW REACT WORKS', 'gpt-4o');
      expect(result.optimizedPrompt).toContain('explain');
    });

    it('replaces rule with same name on re-register', () => {
      registerRule({ name: 'test', detect: () => [], });
      registerRule({ name: 'test', detect: () => [{ original: '', optimized: '', tokensSaved: 0, rule: 'test', description: 'v2' }], });
      expect(getRegisteredRules().length).toBe(1);
      const result = optimize('anything', 'gpt-4o');
      const testSuggestions = result.suggestions.filter(s => s.rule === 'test');
      expect(testSuggestions[0].description).toBe('v2');
    });

    it('unregisters a rule by name', () => {
      registerRule({ name: 'temp', detect: () => [], });
      expect(getRegisteredRules().length).toBe(1);
      const removed = unregisterRule('temp');
      expect(removed).toBe(true);
      expect(getRegisteredRules().length).toBe(0);
    });

    it('clearRules removes all custom rules', () => {
      registerRule({ name: 'a', detect: () => [], });
      registerRule({ name: 'b', detect: () => [], });
      expect(getRegisteredRules().length).toBe(2);
      clearRules();
      expect(getRegisteredRules().length).toBe(0);
    });
  });
});
