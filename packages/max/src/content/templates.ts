/**
 * Prompt templates for content generation.
 * 6 content categories × 2 platforms (Twitter, Dev.to).
 */

export type ContentCategory =
  | 'tip'
  | 'comparison'
  | 'tutorial'
  | 'stats'
  | 'launch'
  | 'opinion';

export interface PromptContext {
  stars: number;
  forks: number;
  npmDownloadsWeek: number;
  npmDownloadsMonth: number;
  deltaStars: number;
  recentPosts: string[];
}

const PERSONA = `You are Nate Voss, an indie developer who built PromptFuel — a free, open-source token optimization toolkit for LLM applications (CLI, SDK, Chrome extension, MCP server). You write in a casual, authentic developer voice. No corporate speak, no excessive emojis, no hashtag spam. You talk like someone who genuinely cares about helping devs save money on API calls. PromptFuel is at https://promptfuel.vercel.app and installs via: npm install -g promptfuel`;

const TWITTER_RULES = `Write a single tweet. MUST be under 280 characters — this is a hard limit, count carefully. No thread format. No hashtags unless they feel completely natural. No "🧵" or "1/" prefixes.`;

const DEVTO_RULES = `Write a Dev.to article in markdown. Start with a single # title line. 500-1500 words. Include practical code examples where relevant. End with a brief call-to-action mentioning PromptFuel. The tone should be educational, not salesy.`;

const AVOID_REPETITION = (recent: string[]) =>
  recent.length > 0
    ? `\n\nAvoid covering the same ground as these recent posts:\n${recent.map((p) => `- ${p}`).join('\n')}`
    : '';

const TWITTER_PROMPTS: Record<ContentCategory, (ctx: PromptContext) => string> = {
  tip: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nWrite a quick, practical tip about token optimization, prompt engineering, or saving money on LLM API calls. Share something genuinely useful that devs can apply immediately.${AVOID_REPETITION(ctx.recentPosts)}`,

  comparison: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nWrite a punchy before/after comparison showing how PromptFuel optimizes a prompt — or compare the cost of different models for the same task. Use concrete numbers if possible.${AVOID_REPETITION(ctx.recentPosts)}`,

  stats: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nShare a genuine milestone or interesting stat about PromptFuel. Current numbers: ${ctx.stars} GitHub stars${ctx.deltaStars > 0 ? ` (+${ctx.deltaStars} today)` : ''}, ${ctx.npmDownloadsWeek.toLocaleString('en-US')} npm downloads this week, ${ctx.npmDownloadsMonth.toLocaleString('en-US')} this month. Pick the most interesting angle. Keep it humble — no "we're crushing it" energy.${AVOID_REPETITION(ctx.recentPosts)}`,

  launch: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nWrite a short announcement about a PromptFuel feature. Pick one: the CLI (pf optimize, pf dashboard), the Chrome extension (works on ChatGPT/Claude/Gemini), the MCP server for Claude Code, or the npm SDK. Focus on one specific capability and why it matters.${AVOID_REPETITION(ctx.recentPosts)}`,

  opinion: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nShare a developer-focused hot take about LLM costs, token usage, prompt engineering, or AI tooling. Be opinionated but not inflammatory. The kind of tweet that makes devs nod and think "yeah, exactly."${AVOID_REPETITION(ctx.recentPosts)}`,

  tutorial: (ctx) =>
    `${PERSONA}\n\n${TWITTER_RULES}\n\nShare a mini-tutorial or code snippet showing one specific thing PromptFuel can do. Keep it tight — a one-liner command or a 2-3 line code example max.${AVOID_REPETITION(ctx.recentPosts)}`,
};

const DEVTO_PROMPTS: Record<ContentCategory, (ctx: PromptContext) => string> = {
  tip: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite an article sharing 3-5 practical tips for reducing LLM API costs. Include code examples using PromptFuel CLI or SDK where they naturally fit. Tag suggestions: ai, javascript, webdev, productivity.${AVOID_REPETITION(ctx.recentPosts)}`,

  comparison: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite a comparison article: take a real-world prompt and show the optimization process step by step using PromptFuel. Include before/after token counts and cost calculations. Tag suggestions: ai, tutorial, javascript, optimization.${AVOID_REPETITION(ctx.recentPosts)}`,

  tutorial: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite a getting-started tutorial for PromptFuel. Cover installation (npm install -g promptfuel), basic usage (pf optimize, pf dashboard), and one advanced feature (MCP server or SDK integration). Tag suggestions: ai, tutorial, javascript, beginners.${AVOID_REPETITION(ctx.recentPosts)}`,

  stats: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite an article analyzing LLM API pricing trends and how developers can optimize costs. Reference real model pricing (GPT-4o, Claude Sonnet, Gemini Pro) and show how tools like PromptFuel help. Current PromptFuel stats: ${ctx.stars} GitHub stars, ${ctx.npmDownloadsMonth.toLocaleString('en-US')} monthly downloads. Tag suggestions: ai, webdev, discuss, productivity.${AVOID_REPETITION(ctx.recentPosts)}`,

  launch: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite a feature deep-dive article about one PromptFuel component. Choose from: the Chrome extension (real-time token counting on ChatGPT/Claude/Gemini), the CLI dashboard (session analytics), the MCP server (auto-optimization in Claude Code), or the SDK. Explain the problem it solves and show it in action. Tag suggestions: ai, javascript, opensource, webdev.${AVOID_REPETITION(ctx.recentPosts)}`,

  opinion: (ctx) =>
    `${PERSONA}\n\n${DEVTO_RULES}\n\nWrite an opinion piece about why most developers are overpaying for LLM API calls and don't realize it. Discuss common antipatterns (system prompt bloat, no caching strategy, wrong model selection). Mention PromptFuel as one solution but keep the article genuinely educational. Tag suggestions: ai, discuss, webdev, productivity.${AVOID_REPETITION(ctx.recentPosts)}`,
};

export function twitterPrompt(category: ContentCategory, ctx: PromptContext): string {
  return TWITTER_PROMPTS[category](ctx);
}

export function devtoPrompt(category: ContentCategory, ctx: PromptContext): string {
  return DEVTO_PROMPTS[category](ctx);
}

/** Map categories to Dev.to tags. */
export function tagsForCategory(category: ContentCategory): string[] {
  const base = ['ai'];
  const map: Record<ContentCategory, string[]> = {
    tip: [...base, 'javascript', 'webdev', 'productivity'],
    comparison: [...base, 'tutorial', 'javascript', 'optimization'],
    tutorial: [...base, 'tutorial', 'javascript', 'beginners'],
    stats: [...base, 'webdev', 'discuss', 'productivity'],
    launch: [...base, 'javascript', 'opensource', 'webdev'],
    opinion: [...base, 'discuss', 'webdev', 'productivity'],
  };
  return map[category];
}
