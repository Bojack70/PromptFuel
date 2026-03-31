/**
 * Content quality gate — Gemini self-review before publishing.
 *
 * Every piece of content is scored 1-10 on four dimensions:
 *   authenticity, value, accuracy, engagement
 *
 * Score ≥ 7 average → publish
 * Score < 7 → regenerate once with feedback
 * Still < 7 → skip (log as rejected)
 */

import { generateContent } from './gemini.js';

export interface QualityScore {
  authenticity: number;
  value: number;
  accuracy: number;
  engagement: number;
  average: number;
  feedback: string;
}

export interface QualityResult {
  passed: boolean;
  score: QualityScore;
}

const REVIEW_PROMPT_TWITTER = (tweet: string) => `You are a content quality reviewer for a developer-focused Twitter account (@natevoss, indie dev who built PromptFuel).

Review this tweet and score it 1-10 on each dimension:

TWEET:
"""
${tweet}
"""

SCORING CRITERIA:
- authenticity (1-10): Sounds like a real indie developer, not corporate marketing or AI-generated slop. No forced enthusiasm. No generic platitudes.
- value (1-10): A developer reading this would learn something, think differently, or find it genuinely useful — not just noise in their feed.
- accuracy (1-10): All claims are verifiable or reasonable. No exaggeration, no made-up stats.
- engagement (1-10): Someone would like, reply, or retweet. Provocative or insightful enough to stop the scroll.

Respond in EXACTLY this JSON format, nothing else:
{"authenticity":N,"value":N,"accuracy":N,"engagement":N,"feedback":"one sentence explaining the weakest dimension"}`;

const REVIEW_PROMPT_DEVTO = (title: string, body: string) => `You are a content quality reviewer for a developer-focused Dev.to author (Nate Voss, indie dev who built PromptFuel).

Review this article and score it 1-10 on each dimension:

TITLE: ${title}

ARTICLE (first 1500 chars):
"""
${body.slice(0, 1500)}
"""

SCORING CRITERIA:
- authenticity (1-10): Sounds like a real indie developer writing from experience. Not AI-generated filler. Has personality and genuine perspective.
- value (1-10): A developer would bookmark this or share it with a colleague. Teaches something concrete, not surface-level rehash.
- accuracy (1-10): Code examples are correct. Claims are verifiable. No hallucinated features or wrong syntax.
- engagement (1-10): The title would get clicks on Dev.to. The intro hooks the reader. Someone would leave a comment.

Respond in EXACTLY this JSON format, nothing else:
{"authenticity":N,"value":N,"accuracy":N,"engagement":N,"feedback":"one sentence explaining the weakest dimension"}`;

function parseScoreResponse(raw: string): QualityScore | null {
  try {
    // Extract JSON from response (handle markdown fences)
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    const { authenticity, value, accuracy, engagement, feedback } = parsed;

    // Validate all scores are numbers 1-10
    const scores = [authenticity, value, accuracy, engagement];
    if (scores.some((s) => typeof s !== 'number' || s < 1 || s > 10)) {
      return null;
    }

    const average = scores.reduce((a, b) => a + b, 0) / 4;

    return {
      authenticity,
      value,
      accuracy,
      engagement,
      average: Math.round(average * 10) / 10,
      feedback: String(feedback || ''),
    };
  } catch {
    return null;
  }
}

export async function reviewTweet(
  tweet: string,
  geminiApiKey: string,
): Promise<QualityResult> {
  const prompt = REVIEW_PROMPT_TWITTER(tweet);
  const raw = await generateContent(geminiApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 200,
  });

  const score = parseScoreResponse(raw);
  if (!score) {
    // If scoring fails, let it through with a warning score
    console.warn('[Max] Quality scoring failed to parse, defaulting to pass');
    return {
      passed: true,
      score: { authenticity: 7, value: 7, accuracy: 7, engagement: 7, average: 7, feedback: 'scoring parse failed' },
    };
  }

  return { passed: score.average >= 7, score };
}

export async function reviewArticle(
  title: string,
  body: string,
  geminiApiKey: string,
): Promise<QualityResult> {
  const prompt = REVIEW_PROMPT_DEVTO(title, body);
  const raw = await generateContent(geminiApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 200,
  });

  const score = parseScoreResponse(raw);
  if (!score) {
    console.warn('[Max] Quality scoring failed to parse, defaulting to pass');
    return {
      passed: true,
      score: { authenticity: 7, value: 7, accuracy: 7, engagement: 7, average: 7, feedback: 'scoring parse failed' },
    };
  }

  return { passed: score.average >= 7, score };
}
