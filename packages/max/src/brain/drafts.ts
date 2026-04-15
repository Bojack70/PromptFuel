/**
 * Reddit/HN/LinkedIn draft generation — creates posts for manual review or auto-posting.
 * Reddit drafts are auto-posted (1/week). HN + LinkedIn drafts are saved for manual review.
 * Drafts are saved to data/drafts/.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MaxConfig } from '../config.js';
import type { PromptContext } from '../content/templates.js';
import { generateContent } from '../content/claude.js';
import { postToReddit, pickSubreddit } from '../publish/reddit.js';
import { appendHistory } from '../content/history.js';

const PERSONA = `You are Nate Voss, an indie developer who built PromptFuel — a free, open-source token optimization toolkit for LLM applications. You write in a casual, authentic developer voice.`;

const REDDIT_PROMPT = (ctx: PromptContext, subreddit: string) => `${PERSONA}

Write a Reddit post for r/${subreddit}. Format:

TITLE: [catchy but not clickbait title]

[body]

Rules:
- Lead with the problem you solved, not the tool
- Be genuinely helpful — share insights about token optimization, LLM costs, or prompt engineering
- Mention PromptFuel naturally, not as a sales pitch
- Include a link to https://promptfuel.vercel.app?utm_source=reddit&utm_medium=social&utm_campaign=max or the npm package
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
- Include link to https://github.com/Bojack70/PromptFuel and https://promptfuel.vercel.app?utm_source=hackernews&utm_medium=social&utm_campaign=max
- No marketing language — HN will destroy you for it
- Mention it's open source and zero-dependency where relevant

Context: PromptFuel has ${ctx.stars} GitHub stars. It's a monorepo with CLI, Chrome extension, MCP server, and npm SDK. Zero runtime deps in the core. Built with TypeScript.`;

const LINKEDIN_PROMPT = (ctx: PromptContext) => `${PERSONA}

Write a LinkedIn post about a developer challenge related to LLM API costs or prompt engineering. Format it for LinkedIn:

Rules:
- Open with a hook line (1 sentence that stops the scroll)
- Use short paragraphs (1-2 sentences each) — LinkedIn readers skim
- Share a genuine insight or lesson from building PromptFuel
- Mention PromptFuel naturally with a link to https://promptfuel.vercel.app?utm_source=linkedin&utm_medium=social&utm_campaign=max
- End with a question to drive engagement
- 150-300 words total
- Professional but not corporate — you're an indie dev, not a startup founder playing the LinkedIn game
- No hashtag spam — 2-3 relevant hashtags max at the end

Context: PromptFuel has ${ctx.stars} GitHub stars, ${ctx.npmDownloadsWeek.toLocaleString('en-US')} weekly npm downloads. Built as open source with CLI, Chrome extension, MCP server, and npm SDK.`;

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Parse Reddit draft into title + body.
 */
function parseRedditDraft(content: string): { title: string; body: string } {
  const lines = content.trim().split('\n');
  let title = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('TITLE:')) {
      title = line.replace(/^TITLE:\s*/, '').trim();
      bodyStart = i + 1;
      // Skip blank line after title
      if (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
      break;
    }
  }

  if (!title) {
    title = lines[0].replace(/^#\s*/, '').trim();
    bodyStart = 1;
  }

  const body = lines.slice(bodyStart).join('\n').trim();
  return { title, body };
}

export async function generateDrafts(config: MaxConfig, ctx: PromptContext): Promise<void> {
  const draftsDir = join(config.dataDir, 'drafts');
  mkdirSync(draftsDir, { recursive: true });

  const date = today();
  const weekNum = getWeekNumber();
  const subreddit = pickSubreddit(weekNum);

  // Reddit draft — auto-post (1/week)
  try {
    const redditContent = await generateContent(config.claudeApiKey, REDDIT_PROMPT(ctx, subreddit), {
      temperature: 0.8,
      maxTokens: 1024,
    });
    const redditPath = join(draftsDir, `${date}-reddit.md`);
    writeFileSync(redditPath, redditContent);
    console.log(`[Max] Reddit draft saved: ${redditPath}`);

    // Auto-post to Reddit
    try {
      const { title, body } = parseRedditDraft(redditContent);
      const result = await postToReddit(subreddit, title, body, {
        clientId: config.redditClientId,
        clientSecret: config.redditClientSecret,
        username: config.redditUsername,
        password: config.redditPassword,
      });
      appendHistory(config.dataDir, {
        date,
        timestamp: new Date().toISOString(),
        platform: 'reddit',
        category: 'tip',
        title,
        content: body.slice(0, 200),
        postId: result.id,
        postUrl: result.url,
      });
      console.log(`[Max] Reddit post published to r/${subreddit}: ${result.url}`);
    } catch (err) {
      console.error(`[Max] Reddit auto-post to r/${subreddit} failed (draft saved):`, err);
    }
  } catch (err) {
    console.error('[Max] Reddit draft generation failed:', err);
  }

  // HN draft (manual posting only)
  try {
    const hnContent = await generateContent(config.claudeApiKey, HN_PROMPT(ctx), {
      temperature: 0.7,
      maxTokens: 768,
    });
    const hnPath = join(draftsDir, `${date}-hn.md`);
    writeFileSync(hnPath, hnContent);
    console.log(`[Max] HN draft saved: ${hnPath}`);
  } catch (err) {
    console.error('[Max] HN draft generation failed:', err);
  }

  // LinkedIn draft (manual posting only)
  try {
    const linkedinContent = await generateContent(config.claudeApiKey, LINKEDIN_PROMPT(ctx), {
      temperature: 0.8,
      maxTokens: 768,
    });
    const linkedinPath = join(draftsDir, `${date}-linkedin.md`);
    writeFileSync(linkedinPath, linkedinContent);
    console.log(`[Max] LinkedIn draft saved: ${linkedinPath}`);
  } catch (err) {
    console.error('[Max] LinkedIn draft generation failed:', err);
  }
}
