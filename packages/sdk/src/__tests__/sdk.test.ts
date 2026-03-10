import { describe, it, expect, beforeEach } from 'vitest';
import { PromptFuel } from '../index.js';
import { promptFuelMiddleware } from '../middleware.js';

// ── PromptFuel class ──────────────────────────────────────────────────────────

describe('PromptFuel', () => {
  let pf: PromptFuel;

  beforeEach(() => {
    pf = new PromptFuel({ model: 'gpt-4o' });
  });

  describe('constructor', () => {
    it('defaults to gpt-4o', () => {
      const defaultPf = new PromptFuel();
      expect(defaultPf.getModel()).toBe('gpt-4o');
    });

    it('uses the provided model', () => {
      const claudePf = new PromptFuel({ model: 'claude-sonnet-4-6' });
      expect(claudePf.getModel()).toBe('claude-sonnet-4-6');
    });
  });

  describe('analyze', () => {
    it('returns token counts for a prompt', () => {
      const result = pf.analyze('Explain how React hooks work');
      expect(result.tokens.input).toBeGreaterThan(0);
      expect(result.tokens.estimatedOutput).toBeGreaterThan(0);
      expect(result.tokens.total).toBe(result.tokens.input + result.tokens.estimatedOutput);
    });

    it('returns formatted cost strings', () => {
      const result = pf.analyze('Hello world');
      expect(result.cost.input).toMatch(/^\$/);
      expect(result.cost.output).toMatch(/^\$/);
      expect(result.cost.total).toMatch(/^\$/);
    });

    it('exposes raw cost estimate', () => {
      const result = pf.analyze('Hello world');
      expect(typeof result.cost.raw.inputCost).toBe('number');
      expect(typeof result.cost.raw.outputCost).toBe('number');
      expect(typeof result.cost.raw.totalCost).toBe('number');
    });
  });

  describe('optimize', () => {
    it('reduces tokens for verbose prompts', () => {
      const result = pf.optimize(
        'I would like you to please explain how React hooks work in detail'
      );
      expect(result.optimizedTokens).toBeLessThanOrEqual(result.originalTokens);
      expect(result.optimizedPrompt.length).toBeGreaterThan(0);
    });

    it('returns a reductionPercent between 0 and 100', () => {
      const result = pf.optimize('Please make sure to explain React');
      expect(result.reductionPercent).toBeGreaterThanOrEqual(0);
      expect(result.reductionPercent).toBeLessThanOrEqual(100);
    });

    it('returns the prompt unchanged when already concise', () => {
      const concise = 'Explain React hooks.';
      const result = pf.optimize(concise);
      expect(result.tokenReduction).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setModel / getModel', () => {
    it('updates the model', () => {
      pf.setModel('claude-haiku-4-5');
      expect(pf.getModel()).toBe('claude-haiku-4-5');
    });
  });

  describe('createMonitor', () => {
    it('returns a ContextMonitor', () => {
      const monitor = pf.createMonitor();
      expect(monitor).toBeDefined();
      expect(typeof monitor.addMessage).toBe('function');
      expect(typeof monitor.getStatus).toBe('function');
    });

    it('uses the provided model override', () => {
      const monitor = pf.createMonitor('claude-sonnet-4-6');
      expect(monitor).toBeDefined();
    });
  });

  describe('static methods', () => {
    it('listModels returns an array of model strings', () => {
      const models = PromptFuel.listModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models).toContain('gpt-4o');
      expect(models).toContain('claude-sonnet-4-6');
    });

    it('getModelInfo returns pricing and context window', () => {
      const info = PromptFuel.getModelInfo('gpt-4o');
      expect(typeof info.input).toBe('number');
      expect(typeof info.output).toBe('number');
      expect(info.context).toBeGreaterThan(0);
    });

    it('getContextWindow returns token limit', () => {
      expect(PromptFuel.getContextWindow('gpt-4o')).toBe(128000);
      expect(PromptFuel.getContextWindow('claude-sonnet-4-6')).toBe(200000);
    });
  });
});

// ── promptFuelMiddleware ──────────────────────────────────────────────────────

describe('promptFuelMiddleware', () => {
  const makeRes = () => {
    const headers: Record<string, string> = {};
    return {
      setHeader: (name: string, value: string) => { headers[name] = value; },
      _headers: headers,
    };
  };

  it('calls next() when body is missing', async () => {
    const middleware = promptFuelMiddleware();
    const req = {};
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('sets token headers for a prompt', () => {
    const middleware = promptFuelMiddleware({ model: 'gpt-4o' });
    const req = { body: { prompt: 'Explain React hooks' } };
    const res = makeRes();
    middleware(req, res, () => {});
    expect(res._headers['X-PromptFuel-Input-Tokens']).toBeDefined();
    expect(Number(res._headers['X-PromptFuel-Input-Tokens'])).toBeGreaterThan(0);
    expect(res._headers['X-PromptFuel-Estimated-Cost']).toMatch(/^\$/);
  });

  it('sets context headers for messages', () => {
    const middleware = promptFuelMiddleware({ model: 'gpt-4o' });
    const req = {
      body: {
        messages: [
          { role: 'user', content: 'Explain React hooks' },
          { role: 'assistant', content: 'React hooks are functions...' },
        ],
      },
    };
    const res = makeRes();
    middleware(req, res, () => {});
    expect(res._headers['X-PromptFuel-Context-Tokens']).toBeDefined();
    expect(res._headers['X-PromptFuel-Context-Percent']).toBeDefined();
    expect(res._headers['X-PromptFuel-Context-Warning']).toBeDefined();
  });

  it('sets context alert when usage exceeds warnAt threshold', () => {
    const middleware = promptFuelMiddleware({ model: 'gpt-4o', warnAt: 0 });
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
    };
    const res = makeRes();
    middleware(req, res, () => {});
    expect(res._headers['X-PromptFuel-Context-Alert']).toBeDefined();
  });

  it('uses custom header prefix', () => {
    const middleware = promptFuelMiddleware({ headerPrefix: 'X-Custom' });
    const req = { body: { prompt: 'Hello' } };
    const res = makeRes();
    middleware(req, res, () => {});
    expect(res._headers['X-Custom-Input-Tokens']).toBeDefined();
  });

  it('uses model from request body when provided', () => {
    const middleware = promptFuelMiddleware({ model: 'gpt-4o' });
    const req = { body: { prompt: 'Hello', model: 'claude-sonnet-4-6' } };
    const res = makeRes();
    middleware(req, res, () => {});
    // Should not throw — model override from body is accepted
    expect(res._headers['X-PromptFuel-Input-Tokens']).toBeDefined();
  });
});
