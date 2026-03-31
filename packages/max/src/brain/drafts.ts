/**
 * Reddit/HN draft generation — creates posts for manual review.
 * Drafts are saved to data/drafts/ and NOT auto-posted.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MaxConfig } from '../config.js';
import type { PromptContext } from '../content/templates.js';
import { generateContent } from '../content/gemini.js';

const PERSONA = `You are Nate Voss, an indie developer who built PromptFuel — a free, open-source token optimization toolkit for LLM applications. You write in a casual, authentic developer voice.`;

const REDDIT_PROMPT = (ctx: PromptContext) => `${PERSONA}

Write a Reddit post for r/programming or r/webdev. Format:

TITLE: [catchy but not clickbait title]

[body]

Rules:
- Lead with the problem you solved, not the tool
- Be genuinely helpful — share insights about token optimization, LLM costs, or prompt engineering
- Mention PromptFuel naturally, not as a sales pitch
- Include a link to https://promptfuel.vercel.app or the npm package
- 200-400 words
- Reddit hates self-promotion that doesn't add value — make the post educational first

Context: PromptFuel has ${ctx.stars} GitHub stars, ${ctx.npmDownloadsWeek.toLocaleString('en-US')} weekly npm downloads. It's a CLI + Chrome extension + MCP server for token counting and prompt optimization.`;

const HN_PROMPT = (ctx: PromptContext) => `${PERSONA}

Write a Hacker News "Show HN" post. Format:

TITLE: Show HN: [concise technical title]

[body]

Rules:
- HN audience is technical — lead with the engineering decisions
- Keep it concise (150-250 words)
- Explain what it does, why you built it, and what's interesting technically
- Include link to https://github.com/Bojack70/PromptFuel
- No marketing language — HN will destroy you for it
- Mention it's open source and zero-dependency where relevant

Context: PromptFuel has ${ctx.stars} GitHub stars. It's a monorepo with CLI, Chrome extension, MCP server, and npm SDK. Zero runtime deps in the core. Built with TypeScript.`;

function today(): string {
  return new Date().toISOString().split('T')[0];
}

export async function generateDrafts(config: MaxConfig, ctx: PromptContext): Promise<void> {
  const draftsDir = join(config.dataDir, 'drafts');
  mkdirSync(draftsDir, { recursive: true });

  const date = today();

  // Reddit draft
  try {
    const redditContent = await generateContent(config.geminiApiKey, REDDIT_PROMPT(ctx), {
      temperature: 0.8,
      maxTokens: 1024,
    });
    const redditPath = join(draftsDir, `${date}-reddit.md`);
    writeFileSync(redditPath, redditContent);
    console.log(`[Max] Reddit draft saved: ${redditPath}`);
  } catch (err) {
    console.error('[Max] Reddit draft generation failed:', err);
  }

  // HN draft
  try {
    const hnContent = await generateContent(config.geminiApiKey, HN_PROMPT(ctx), {
      temperature: 0.7,
      maxTokens: 768,
    });
    const hnPath = join(draftsDir, `${date}-hn.md`);
    writeFileSync(hnPath, hnContent);
    console.log(`[Max] HN draft saved: ${hnPath}`);
  } catch (err) {
    console.error('[Max] HN draft generation failed:', err);
  }
}
