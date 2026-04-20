/**
 * Claude content client — dispatches between Claude Code CLI (subscription) and
 * Anthropic API (paid) based on MAX_LLM_MODE env var.
 *
 * Modes:
 *   cli  (default) — spawns `claude -p --bare` subprocess, uses your subscription quota.
 *                    Zero additional $ cost. Needs `claude` on PATH and an active session.
 *   api            — direct POST to api.anthropic.com with apiKey. Real $ cost, isolated
 *                    from subscription quota. Enforces MAX_MONTHLY_API_USD cap (future).
 *
 * Flip via: MAX_LLM_MODE=api node dist/index.js --mode generate-week
 *
 * Model routing (unchanged across modes):
 *   claude-haiku-4-5    — Bluesky/Dev.to generation, quality review for short-form
 *   claude-sonnet-4-6   — calendar, reflection, strategy, quality review for long-form
 *   claude-opus-4-7     — Medium content (highest quality — user reviews before publish)
 *
 * Observability: every call appends to <MAX_DATA_DIR>/llm-calls.json so you can
 * read call volume / mode / model mix after a couple of weeks and judge quota pressure.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export type ClaudeModel = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7';
export type LLMMode = 'cli' | 'api';

interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  model?: ClaudeModel;
}

function currentMode(): LLMMode {
  const raw = (process.env.MAX_LLM_MODE ?? 'cli').toLowerCase();
  return raw === 'api' ? 'api' : 'cli';
}

function fallbackEnabled(): boolean {
  return (process.env.MAX_LLM_FALLBACK ?? 'false').toLowerCase() === 'true';
}

function modelAlias(model: ClaudeModel): string {
  if (model.startsWith('claude-haiku')) return 'haiku';
  if (model.startsWith('claude-sonnet')) return 'sonnet';
  if (model.startsWith('claude-opus')) return 'opus';
  return model;
}

export async function generateContent(
  apiKey: string,
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const { temperature = 0.9, maxTokens = 2048, model = 'claude-haiku-4-5' } = options;
  const mode = currentMode();

  const startedAt = Date.now();

  if (mode === 'cli') {
    try {
      const raw = await generateViaCLI(prompt, model);
      const out = cleanOutput(raw);
      trackCall({ mode: 'cli', model, promptChars: prompt.length, responseChars: out.length, ms: Date.now() - startedAt, ok: true });
      return out;
    } catch (err) {
      const msg = (err as Error).message;
      trackCall({ mode: 'cli', model, promptChars: prompt.length, responseChars: 0, ms: Date.now() - startedAt, ok: false, error: msg });

      if (fallbackEnabled() && apiKey) {
        console.warn(`[Max] CLI call failed (${msg.slice(0, 80)}) — falling back to API (MAX_LLM_FALLBACK=true)`);
        const api = await generateViaAPI(apiKey, prompt, { temperature, maxTokens, model });
        trackCall({ mode: 'api', model, promptChars: prompt.length, responseChars: api.length, ms: Date.now() - startedAt, ok: true, fallback: true });
        return api;
      }
      throw err;
    }
  }

  // api mode
  if (!apiKey) {
    throw new Error('MAX_LLM_MODE=api but ANTHROPIC_API_KEY is not set');
  }
  const out = await generateViaAPI(apiKey, prompt, { temperature, maxTokens, model });
  trackCall({ mode: 'api', model, promptChars: prompt.length, responseChars: out.length, ms: Date.now() - startedAt, ok: true });
  return out;
}

/** Direct Anthropic API path (original implementation, preserved). */
async function generateViaAPI(
  apiKey: string,
  prompt: string,
  options: Required<GenerateOptions>,
): Promise<string> {
  const { temperature, maxTokens, model } = options;

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw: string = data.content?.[0]?.text ?? '';
  return cleanOutput(raw);
}

/**
 * Claude Code CLI subprocess path — uses active subscription, no API key needed.
 *
 * Flags explained:
 *   -p / --print               non-interactive, print and exit
 *   --model <alias>            haiku/sonnet/opus — matches the API tier we need
 *   --system-prompt <str>      override default system prompt so the subprocess
 *                              does NOT auto-load project CLAUDE.md or user memory
 *                              (otherwise Nate-Voss persona / project context leak in)
 *   --no-session-persistence   don't write a session file for every call
 *   --disable-slash-commands   prevent accidental / interpretation in prompts
 *   --setting-sources ""       don't load user/project settings (MCP servers, etc.)
 *
 * We explicitly do NOT use --bare: it disables keychain reads, which is exactly
 * how the subscription auth is found. --bare would force ANTHROPIC_API_KEY auth,
 * defeating the whole point of cli mode.
 */
function generateViaCLI(prompt: string, model: ClaudeModel): Promise<string> {
  return new Promise((resolve, reject) => {
    const systemPrompt =
      'You are a text generation assistant. Reply with only the requested content — no preamble, no meta-commentary, no "here is" phrases. Follow the user instructions exactly.';
    const args = [
      '-p',
      '--model', modelAlias(model),
      '--system-prompt', systemPrompt,
      '--no-session-persistence',
      '--disable-slash-commands',
      '--setting-sources', '',
    ];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Number.parseInt(process.env.MAX_LLM_CLI_TIMEOUT_MS ?? '120000', 10);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`claude CLI timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf-8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf-8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`claude CLI spawn failed: ${err.message} (is \`claude\` on PATH?)`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exit ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

interface CallRecord {
  ts: string;
  date: string;
  mode: LLMMode;
  model: ClaudeModel;
  promptChars: number;
  responseChars: number;
  ms: number;
  ok: boolean;
  error?: string;
  fallback?: boolean;
}

function trackCall(r: Omit<CallRecord, 'ts' | 'date'>): void {
  try {
    const dataDir = process.env.MAX_DATA_DIR ?? join(process.cwd(), 'data');
    const file = join(dataDir, 'llm-calls.json');
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });

    const now = new Date();
    const record: CallRecord = {
      ts: now.toISOString(),
      date: now.toISOString().split('T')[0],
      ...r,
    };

    let records: CallRecord[] = [];
    if (existsSync(file)) {
      try {
        records = JSON.parse(readFileSync(file, 'utf-8'));
        if (!Array.isArray(records)) records = [];
      } catch {
        records = [];
      }
    }
    records.push(record);
    // Keep last 2000 records to avoid unbounded growth
    if (records.length > 2000) records = records.slice(-2000);
    writeFileSync(file, JSON.stringify(records, null, 2));
  } catch {
    // Counter failures must never break content generation
  }
  // Avoid unused-import warning when appendFileSync isn't used elsewhere
  void appendFileSync;
}

/** Strip markdown fences, "Here's a post:" preamble, and surrounding whitespace. */
function cleanOutput(text: string): string {
  let cleaned = text.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  }

  cleaned = cleaned
    .replace(/^(?:Here(?:'s| is) (?:a |the |your )?(?:tweet|post|article)[:\-—]*\s*\n?)/i, '')
    .trim();

  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}
