/**
 * Claude API client — native fetch, zero external dependencies.
 *
 * Uses claude-haiku-4-5 for fast/cheap post generation and quality review.
 * Uses claude-sonnet-4-6 for calendar and weekly reflection (needs more reasoning).
 */

const BASE_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export type ClaudeModel = 'claude-haiku-4-5' | 'claude-sonnet-4-6';

interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  model?: ClaudeModel;
}

export async function generateContent(
  apiKey: string,
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const { temperature = 0.9, maxTokens = 2048, model = 'claude-haiku-4-5' } = options;

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
