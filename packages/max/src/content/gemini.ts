/**
 * Gemini REST API client — native fetch, zero dependencies.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash';

interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export async function generateContent(
  apiKey: string,
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const { temperature = 0.9, maxTokens = 2048 } = options;

  const res = await fetch(`${BASE_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  return cleanOutput(raw);
}

/** Strip markdown fences, "Here's a tweet:" preamble, and surrounding whitespace. */
function cleanOutput(text: string): string {
  let cleaned = text.trim();

  // Remove wrapping code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  }

  // Remove common LLM preamble lines
  cleaned = cleaned
    .replace(/^(?:Here(?:'s| is) (?:a |the |your )?(?:tweet|post|article)[:\-—]*\s*\n?)/i, '')
    .trim();

  // Remove surrounding quotes if the entire output is quoted
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}
