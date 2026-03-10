import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAnalyze } from '../commands/analyze.js';
import { runOptimize } from '../commands/optimize.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(chunk.toString());
    return true;
  };
  return {
    output: () => chunks.join(''),
    restore: () => { process.stdout.write = original; },
  };
}

function captureStderr(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(chunk.toString());
    return true;
  };
  return {
    output: () => chunks.join(''),
    restore: () => { process.stderr.write = original; },
  };
}

// ── runAnalyze ────────────────────────────────────────────────────────────────

describe('runAnalyze', () => {
  let stdout: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    stdout = captureStdout();
  });

  afterEach(() => {
    stdout.restore();
  });

  it('outputs token breakdown for a given prompt', async () => {
    await runAnalyze('Explain how React hooks work', 'gpt-4o');
    const out = stdout.output();
    expect(out).toContain('TOKEN BREAKDOWN');
    expect(out).toContain('Input tokens');
    expect(out).toContain('Est. output tokens');
  });

  it('outputs cost estimate section', async () => {
    await runAnalyze('Explain how React hooks work', 'gpt-4o');
    const out = stdout.output();
    expect(out).toContain('COST ESTIMATE');
    expect(out).toContain('Input cost');
    expect(out).toContain('Total cost');
  });

  it('outputs context window usage section', async () => {
    await runAnalyze('Explain how React hooks work', 'gpt-4o');
    const out = stdout.output();
    expect(out).toContain('CONTEXT WINDOW USAGE');
    expect(out).toContain('tokens remaining');
  });

  it('works with claude models', async () => {
    await runAnalyze('Debug this error', 'claude-sonnet-4-6');
    const out = stdout.output();
    expect(out).toContain('claude-sonnet-4-6');
    expect(out).toContain('TOKEN BREAKDOWN');
  });

  it('shows OK warning for small prompts', async () => {
    await runAnalyze('Hi', 'gpt-4o');
    const out = stdout.output();
    expect(out).toContain('OK');
  });
});

// ── runOptimize ───────────────────────────────────────────────────────────────

describe('runOptimize', () => {
  let stdout: ReturnType<typeof captureStdout>;
  const baseOptions = { model: 'gpt-4o', copy: false, outputOptimized: false };

  beforeEach(() => {
    stdout = captureStdout();
    // Prevent interactive readline prompt in tests
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    stdout.restore();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  it('outputs the optimized prompt section', async () => {
    await runOptimize(
      'I would like you to please explain how React hooks work in detail',
      baseOptions
    );
    const out = stdout.output();
    expect(out).toContain('OPTIMIZED PROMPT');
    expect(out).toContain('ORIGINAL PROMPT');
  });

  it('outputs savings summary', async () => {
    await runOptimize(
      'I would like you to please explain how React hooks work in detail',
      baseOptions
    );
    const out = stdout.output();
    expect(out).toContain('SAVINGS SUMMARY');
    expect(out).toContain('Token reduction');
  });

  it('outputs verbosity score', async () => {
    await runOptimize(
      'I would like you to please explain how React works',
      baseOptions
    );
    const out = stdout.output();
    expect(out).toContain('VERBOSITY SCORE');
  });

  it('--output flag prints only the optimized prompt', async () => {
    await runOptimize(
      'I would like you to please explain React',
      { ...baseOptions, outputOptimized: true }
    );
    const out = stdout.output().trim();
    // Should be just the prompt — no section headers
    expect(out).not.toContain('SAVINGS SUMMARY');
    expect(out).not.toContain('VERBOSITY SCORE');
    expect(out.length).toBeGreaterThan(0);
  });

  it('shows suggestions when verbose phrases are found', async () => {
    await runOptimize(
      'I would like you to please make sure to basically just explain React',
      baseOptions
    );
    const out = stdout.output();
    expect(out).toContain('SUGGESTIONS');
  });

  it('--intent flag shows intent line in output', async () => {
    await runOptimize(
      'Explain how closures work',
      { ...baseOptions, intent: 'explain' }
    );
    const out = stdout.output();
    expect(out).toContain('Intent');
    expect(out).toContain('explain');
  });

  it('--intent flag uses manual override (confidence 100%)', async () => {
    await runOptimize(
      'Explain how closures work',
      { ...baseOptions, intent: 'code-gen' }
    );
    const out = stdout.output();
    expect(out).toContain('code-gen');
    expect(out).toContain('100%');
  });

  it('--budget flag shows budget line in output', async () => {
    await runOptimize(
      'I would like you to please explain React hooks in great detail',
      { ...baseOptions, budget: 500 }
    );
    const out = stdout.output();
    expect(out).toContain('Budget');
    expect(out).toContain('500');
  });

  it('--budget and --intent can be used together', async () => {
    await runOptimize(
      'I would like you to please explain React hooks in great detail',
      { ...baseOptions, budget: 500, intent: 'explain' }
    );
    const out = stdout.output();
    expect(out).toContain('Intent');
    expect(out).toContain('explain');
    expect(out).toContain('Budget');
    expect(out).toContain('500');
  });

  it('shows intent line even without explicit --intent flag', async () => {
    await runOptimize(
      'Explain how closures work in JavaScript',
      baseOptions
    );
    const out = stdout.output();
    expect(out).toContain('Intent');
  });
});
