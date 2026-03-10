import type { OptimizationResult } from '../index.js';

// N-gram analysis to find repeated phrases
function extractNgrams(text: string, n: number): Map<string, number[]> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const ngrams = new Map<string, number[]>();

  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(' ');
    if (!ngrams.has(ngram)) {
      ngrams.set(ngram, []);
    }
    ngrams.get(ngram)!.push(i);
  }

  return ngrams;
}

export function detectRedundancy(text: string): OptimizationResult[] {
  const results: OptimizationResult[] = [];
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);

  // Check for repeated phrases (3-gram and above)
  for (let n = 3; n <= 6; n++) {
    const ngrams = extractNgrams(text, n);

    for (const [ngram, positions] of ngrams) {
      if (positions.length > 1 && ngram.split(' ').some(w => w.length > 3)) {
        results.push({
          original: ngram,
          optimized: `[keep first occurrence]`,
          tokensSaved: 0,
          rule: 'redundancy',
          description: `Repeated phrase found ${positions.length} times: "${ngram}"`,
        });
        break; // Only report the first redundancy per n-gram size
      }
    }
  }

  // Check for near-duplicate sentences
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const similarity = jaccardSimilarity(sentences[i], sentences[j]);
      if (similarity > 0.6) {
        results.push({
          original: sentences[j],
          optimized: '[remove — similar to earlier sentence]',
          tokensSaved: 0,
          rule: 'redundancy',
          description: `Sentences ${i + 1} and ${j + 1} are ${Math.round(similarity * 100)}% similar — consider merging`,
        });
      }
    }
  }

  return results;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
