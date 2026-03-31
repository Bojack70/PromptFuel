/**
 * Dev.to article publishing via REST API.
 */

import type { MaxConfig } from '../config.js';

const ARTICLES_URL = 'https://dev.to/api/articles';

export interface ArticleResult {
  id: number;
  url: string;
}

export async function postArticle(
  title: string,
  bodyMarkdown: string,
  tags: string[],
  config: MaxConfig,
): Promise<ArticleResult> {
  const res = await fetch(ARTICLES_URL, {
    method: 'POST',
    headers: {
      'api-key': config.devtoApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: bodyMarkdown,
        published: true,
        tags: tags.slice(0, 4), // Dev.to max 4 tags
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dev.to API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { id: data.id, url: data.url };
}

/** Extract title from the first # heading in markdown. Returns [title, bodyWithoutTitle]. */
export function parseArticle(markdown: string): { title: string; body: string } {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? 'PromptFuel Update';
  const body = markdown.replace(/^#\s+.+$/m, '').trim();
  return { title, body };
}
