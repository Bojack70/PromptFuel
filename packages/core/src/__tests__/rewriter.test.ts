import { describe, it, expect } from 'vitest';
import { rewrite } from '../optimizer/rewriter/index.js';
import { applyVerbosePhrases } from '../optimizer/rewriter/verbose-phrases.js';
import { applyQuestionRestructuring } from '../optimizer/rewriter/question-restructuring.js';
import { applyVoiceTransform } from '../optimizer/rewriter/voice-transform.js';
import { applySentenceCompression } from '../optimizer/rewriter/sentence-compression.js';

describe('rewriter', () => {
  describe('verbose phrase replacement', () => {
    it('replaces "due to the fact that" with "because"', () => {
      const result = applyVerbosePhrases('We failed due to the fact that the server crashed.');
      expect(result.text).toContain('because');
      expect(result.text).not.toContain('due to the fact that');
      expect(result.applied.length).toBeGreaterThan(0);
    });

    it('replaces "in the event that" with "if"', () => {
      const result = applyVerbosePhrases('In the event that it fails, retry.');
      expect(result.text.toLowerCase()).toContain('if');
    });

    it('replaces "in order to" with "to"', () => {
      const result = applyVerbosePhrases('Do this in order to fix the bug.');
      expect(result.text).toBe('Do this to fix the bug.');
    });

    it('removes polite padding', () => {
      const result = applyVerbosePhrases('I would like you to explain React hooks.');
      expect(result.text).toBe('Explain React hooks.');
    });

    it('handles multiple replacements', () => {
      const result = applyVerbosePhrases(
        'Due to the fact that we need to make a decision in order to proceed.'
      );
      expect(result.text.toLowerCase()).toContain('because');
      expect(result.text).toContain('decide');
      expect(result.text).toContain('to proceed');
      expect(result.applied.length).toBeGreaterThanOrEqual(3);
    });

    it('preserves capitalization at sentence start', () => {
      const result = applyVerbosePhrases('I would like you to explain this.');
      expect(result.text).toMatch(/^[A-Z]/);
    });

    it('leaves clean text unchanged', () => {
      const result = applyVerbosePhrases('Explain React hooks with examples.');
      expect(result.text).toBe('Explain React hooks with examples.');
      expect(result.applied.length).toBe(0);
    });
  });

  describe('question restructuring', () => {
    it('rewrites "Please let me know on which day" to "When did"', () => {
      const result = applyQuestionRestructuring('Please let me know this on which day covid arrived.');
      expect(result.text).toMatch(/^When did/i);
      expect(result.text).toContain('?');
    });

    it('rewrites "Can you tell me what X is"', () => {
      const result = applyQuestionRestructuring('Can you tell me what a closure is?');
      expect(result.text).toMatch(/^What/i);
      expect(result.text).toContain('?');
    });

    it('rewrites "Can you explain how"', () => {
      const result = applyQuestionRestructuring('Can you explain how React hooks work?');
      expect(result.text).toMatch(/^How/i);
      expect(result.text).toContain('?');
    });

    it('rewrites "I want to know why"', () => {
      const result = applyQuestionRestructuring('I want to know why the build fails.');
      expect(result.text).toMatch(/^Why/i);
    });

    it('leaves direct questions unchanged', () => {
      const result = applyQuestionRestructuring('When did COVID arrive?');
      expect(result.text).toBe('When did COVID arrive?');
      expect(result.applied.length).toBe(0);
    });
  });

  describe('passive to active voice', () => {
    it('removes "it should be noted that"', () => {
      const result = applyVoiceTransform('It should be noted that React is fast.');
      expect(result.text).toBe('React is fast.');
    });

    it('removes "it is important to"', () => {
      const result = applyVoiceTransform('It is important to test your code.');
      expect(result.text).toBe('Test your code.');
    });

    it('does not modify active voice sentences', () => {
      const result = applyVoiceTransform('The developer wrote clean code.');
      expect(result.text).toBe('The developer wrote clean code.');
      expect(result.applied.length).toBe(0);
    });
  });

  describe('sentence compression', () => {
    it('removes intensifiers before absolutes', () => {
      const result = applySentenceCompression('This is very unique and really important.');
      expect(result.text).toContain('unique');
      expect(result.text).toContain('important');
      expect(result.text).not.toContain('very unique');
      expect(result.text).not.toContain('really important');
    });

    it('removes meta-commentary', () => {
      const result = applySentenceCompression('As I mentioned earlier, the API is slow.');
      expect(result.text).not.toContain('As I mentioned earlier');
      expect(result.text).toContain('API is slow');
    });

    it('removes unnecessary qualifiers', () => {
      const result = applySentenceCompression('Basically, the code is broken.');
      expect(result.text).not.toContain('Basically');
      expect(result.text).toContain('code is broken');
    });
  });

  describe('full rewrite pipeline', () => {
    it('compresses a verbose prompt significantly', () => {
      const input = 'Please let me know this on which day covid arrived';
      const result = rewrite(input);
      expect(result.rewrittenText.length).toBeLessThan(input.length);
      expect(result.appliedRules.length).toBeGreaterThan(0);
    });

    it('does not break already concise text', () => {
      const input = 'Explain React hooks with examples.';
      const result = rewrite(input);
      expect(result.rewrittenText).toBe(input);
      expect(result.appliedRules.length).toBe(0);
    });

    it('handles complex verbose input', () => {
      const input =
        'I would like you to please explain to me how, due to the fact that React uses a virtual DOM, ' +
        'it is able to achieve very unique performance characteristics. As I mentioned earlier, this is really important.';
      const result = rewrite(input);
      expect(result.rewrittenText.length).toBeLessThan(input.length * 0.7);
      expect(result.appliedRules.length).toBeGreaterThan(2);
    });

    it('is idempotent — running twice produces same output', () => {
      const input = 'I would like you to explain in order to understand the basic fundamentals.';
      const first = rewrite(input);
      const second = rewrite(first.rewrittenText);
      expect(second.rewrittenText).toBe(first.rewrittenText);
    });
  });
});
