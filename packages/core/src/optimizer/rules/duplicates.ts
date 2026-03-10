import type { OptimizationResult } from '../index.js';

// Detect duplicate instructions that say the same thing differently
export function detectDuplicates(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  const sentences = text
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15);

  if (sentences.length < 2) return results;

  // Extract key action words from each sentence
  const sentenceKeys = sentences.map(s => extractKeyWords(s));

  for (let i = 0; i < sentenceKeys.length; i++) {
    for (let j = i + 1; j < sentenceKeys.length; j++) {
      const overlap = keywordOverlap(sentenceKeys[i], sentenceKeys[j]);
      if (overlap > 0.5 && sentenceKeys[i].size >= 3) {
        results.push({
          original: sentences[j],
          optimized: '[remove — duplicates earlier instruction]',
          tokensSaved: 0,
          rule: 'duplicate-instruction',
          description: `"${truncate(sentences[i], 50)}" and "${truncate(sentences[j], 50)}" appear to give the same instruction`,
        });
      }
    }
  }

  return results;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'which',
  'and', 'or', 'but', 'not', 'so', 'if', 'then', 'than', 'i', 'you',
  'me', 'my', 'your', 'we', 'our', 'they', 'their', 'please', 'make',
  'sure', 'also', 'just', 'very', 'really', 'quite',
]);

function extractKeyWords(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap++;
  }
  const minSize = Math.min(a.size, b.size);
  return minSize === 0 ? 0 : overlap / minSize;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}
