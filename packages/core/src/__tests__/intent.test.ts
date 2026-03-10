import { describe, it, expect } from 'vitest';
import {
  detectIntent,
  protectPatterns,
  restorePatterns,
  INTENT_CONFIGS,
} from '../optimizer/intent.js';

// ── detectIntent ──────────────────────────────────────────────────────────────

describe('detectIntent', () => {
  describe('debug intent', () => {
    it('detects debug from error keywords', () => {
      const result = detectIntent('I have a TypeError, debug this step-by-step and trace the issue');
      expect(result.type).toBe('debug');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects debug from "step-by-step" reasoning marker', () => {
      const result = detectIntent('Walk me through this step-by-step and explain the error');
      expect(result.type).toBe('debug');
    });

    it('detects debug from "why does" question pattern', () => {
      const result = detectIntent("Why doesn't this code work? It keeps failing");
      expect(result.type).toBe('debug');
    });

    it('includes matched signals in result', () => {
      const result = detectIntent('There is a bug causing a crash. Debug this step-by-step');
      expect(result.matchedSignals.length).toBeGreaterThan(0);
      expect(result.matchedSignals).toContain('error-keyword');
    });
  });

  describe('code-gen intent', () => {
    it('detects code-gen from creation verbs', () => {
      const result = detectIntent('Write a function that sorts an array');
      expect(result.type).toBe('code-gen');
    });

    it('detects code-gen from framework names', () => {
      const result = detectIntent('Build an app using React for user authentication');
      expect(result.type).toBe('code-gen');
    });

    it('detects code-gen from language names', () => {
      const result = detectIntent('Write a function in TypeScript to validate user input');
      expect(result.type).toBe('code-gen');
    });

    it('detects code-gen from scaffolding terms', () => {
      const result = detectIntent('Generate a boilerplate express app');
      expect(result.type).toBe('code-gen');
    });
  });

  describe('refactor intent', () => {
    it('detects refactor from refactor verb', () => {
      const result = detectIntent('Refactor this function to be more readable');
      expect(result.type).toBe('refactor');
    });

    it('detects refactor from scope constraint', () => {
      const result = detectIntent("Only change the sorting logic, don't touch the rest");
      expect(result.type).toBe('refactor');
    });

    it('detects refactor from quality goals', () => {
      const result = detectIntent('Refactor this code to follow SOLID principles and make it maintainable');
      expect(result.type).toBe('refactor');
    });

    it('detects refactor from refactor actions', () => {
      const result = detectIntent('Refactor this: extract the function, rename the class, split the module');
      expect(result.type).toBe('refactor');
    });
  });

  describe('explain intent', () => {
    it('detects explain from explanation verb', () => {
      const result = detectIntent('Explain how closures work in JavaScript');
      expect(result.type).toBe('explain');
    });

    it('detects explain from "walk me through"', () => {
      const result = detectIntent('Walk me through how the event loop works');
      expect(result.type).toBe('explain');
    });

    it('detects explain from ELI5 / simplicity request', () => {
      const result = detectIntent('Explain promises ELI5');
      expect(result.type).toBe('explain');
    });

    it('detects explain from "what is" question', () => {
      const result = detectIntent('Explain what a closure is and help me understand the concept');
      expect(result.type).toBe('explain');
    });
  });

  describe('creative intent', () => {
    it('detects creative from creative form', () => {
      const result = detectIntent('Write a story in a casual conversational tone about a robot');
      expect(result.type).toBe('creative');
    });

    it('detects creative from tone/style marker', () => {
      const result = detectIntent('Write a blog post in a casual tone about productivity');
      expect(result.type).toBe('creative');
    });

    it('detects creative from creative verb', () => {
      const result = detectIntent('Brainstorm creative ideas for a blog post in an original style');
      expect(result.type).toBe('creative');
    });
  });

  describe('general fallback', () => {
    it('returns general for ambiguous prompts', () => {
      const result = detectIntent('Hello');
      expect(result.type).toBe('general');
      expect(result.confidence).toBe(0);
      expect(result.matchedSignals).toHaveLength(0);
    });

    it('returns general for below-threshold signals', () => {
      const result = detectIntent('The quick brown fox jumps over the lazy dog');
      expect(result.type).toBe('general');
    });
  });

  describe('confidence scoring', () => {
    it('returns confidence in range 0-1', () => {
      const result = detectIntent('Explain how React hooks work');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('returns higher confidence with more matching signals', () => {
      const weak = detectIntent('There is an error somewhere');
      const strong = detectIntent('I have a TypeError on line 5, here is the stack trace. Why does it fail? Walk me step-by-step.');
      expect(strong.confidence).toBeGreaterThan(weak.confidence);
    });
  });
});

// ── INTENT_CONFIGS ────────────────────────────────────────────────────────────

describe('INTENT_CONFIGS', () => {
  it('has a config for every intent type', () => {
    const types = ['debug', 'code-gen', 'refactor', 'explain', 'creative', 'general'];
    for (const type of types) {
      expect(INTENT_CONFIGS).toHaveProperty(type);
    }
  });

  it('debug uses light compression', () => {
    expect(INTENT_CONFIGS.debug.compressionLevel).toBe('light');
  });

  it('general uses aggressive compression', () => {
    expect(INTENT_CONFIGS.general.compressionLevel).toBe('aggressive');
  });

  it('creative skips sentence-compression rewriter pass', () => {
    expect(INTENT_CONFIGS.creative.skipRewriterPasses).toContain('sentence-compression');
  });

  it('debug skips weak-hedging detector', () => {
    expect(INTENT_CONFIGS.debug.skipDetectors).toContain('weak-hedging');
  });

  it('refactor has protected scope-constraint patterns', () => {
    expect(INTENT_CONFIGS.refactor.protectedPatterns.length).toBeGreaterThan(0);
  });
});

// ── protectPatterns / restorePatterns ─────────────────────────────────────────

describe('protectPatterns', () => {
  it('replaces matching text with sentinel placeholders', () => {
    const { text } = protectPatterns('step-by-step guide', [/step-by-step/gi]);
    expect(text).not.toContain('step-by-step');
  });

  it('stores original text in restorations map', () => {
    const { restorations } = protectPatterns('step-by-step guide', [/step-by-step/gi]);
    expect([...restorations.values()]).toContain('step-by-step');
  });

  it('handles multiple patterns', () => {
    const { text, restorations } = protectPatterns(
      'step-by-step and ELI5',
      [/step-by-step/gi, /ELI5/gi]
    );
    expect(text).not.toContain('step-by-step');
    expect(text).not.toContain('ELI5');
    expect(restorations.size).toBe(2);
  });

  it('handles text with no matches gracefully', () => {
    const { text, restorations } = protectPatterns('no matches here', [/xyz123/gi]);
    expect(text).toBe('no matches here');
    expect(restorations.size).toBe(0);
  });
});

describe('restorePatterns', () => {
  it('restores sentinels back to original text', () => {
    const { text, restorations } = protectPatterns('step-by-step guide', [/step-by-step/gi]);
    const restored = restorePatterns(text, restorations);
    expect(restored).toBe('step-by-step guide');
  });

  it('restores multiple protected patterns', () => {
    const { text, restorations } = protectPatterns(
      'step-by-step and ELI5 explanation',
      [/step-by-step/gi, /ELI5/gi]
    );
    const restored = restorePatterns(text, restorations);
    expect(restored).toBe('step-by-step and ELI5 explanation');
  });

  it('is a no-op with empty restorations map', () => {
    const restored = restorePatterns('hello world', new Map());
    expect(restored).toBe('hello world');
  });
});
