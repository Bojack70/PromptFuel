import type { OptimizationResult } from '../index.js';

export function detectFormattingIssues(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];

  // Excessive blank lines (3+ consecutive)
  const excessiveBlanks = text.match(/\n{4,}/g);
  if (excessiveBlanks) {
    results.push({
      original: '[excessive blank lines]',
      optimized: '[reduced to single blank line]',
      tokensSaved: 0,
      rule: 'formatting',
      description: `Found ${excessiveBlanks.length} instances of excessive blank lines`,
    });
  }

  // Excessive whitespace (3+ consecutive spaces)
  const excessiveSpaces = text.match(/ {3,}/g);
  if (excessiveSpaces) {
    results.push({
      original: '[excessive spaces]',
      optimized: '[single space]',
      tokensSaved: 0,
      rule: 'formatting',
      description: `Found ${excessiveSpaces.length} instances of excessive spacing`,
    });
  }

  // Unnecessary markdown in conversational prompts
  const markdownHeaders = text.match(/^#{1,6}\s/gm);
  const textLength = text.length;
  if (markdownHeaders && markdownHeaders.length > 3 && textLength < 500) {
    results.push({
      original: '[over-structured markdown]',
      optimized: '[simplified formatting]',
      tokensSaved: 0,
      rule: 'formatting',
      description: `${markdownHeaders.length} markdown headers in a short prompt — consider simplifying`,
    });
  }

  // Excessive bullet points / numbered lists for simple instructions
  const listItems = text.match(/^[\s]*[-*•]\s/gm) ?? [];
  const numberedItems = text.match(/^[\s]*\d+[.)]\s/gm) ?? [];
  const totalListItems = listItems.length + numberedItems.length;
  if (totalListItems > 5 && textLength < 300) {
    results.push({
      original: '[over-listed format]',
      optimized: '[paragraph form]',
      tokensSaved: 0,
      rule: 'formatting',
      description: `${totalListItems} list items in a short prompt — could be written more concisely as prose`,
    });
  }

  return results;
}

export function cleanFormatting(text: string): string {
  let cleaned = text;

  // Reduce excessive blank lines to single blank line
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Reduce excessive spaces to single space
  cleaned = cleaned.replace(/ {2,}/g, ' ');

  // Trim trailing whitespace per line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  return cleaned;
}
