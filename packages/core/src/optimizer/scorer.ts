// Verbosity scorer: rates prompt verbosity from 0 (concise) to 100 (very verbose)

const FILLER_PATTERNS = [
  /\b(just|really|very|quite|basically|actually|literally|honestly|simply|obviously)\b/gi,
  /\b(i think|i believe|i feel like|in my opinion)\b/gi,
  /\b(kind of|sort of|a bit|a little)\b/gi,
  /\b(you know|i mean|like)\b/gi,
];

export function scoreVerbosity(text: string): number {
  if (!text || text.length < 10) return 0;

  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount === 0) return 0;

  // Factor 1: Filler word ratio (0-30 points)
  let fillerCount = 0;
  for (const pattern of FILLER_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) fillerCount += matches.length;
  }
  const fillerScore = Math.min(30, (fillerCount / wordCount) * 300);

  // Factor 2: Average sentence length (0-25 points)
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = wordCount / Math.max(sentences.length, 1);
  const sentenceLengthScore = Math.min(25, Math.max(0, (avgSentenceLength - 10) * 1.5));

  // Factor 3: Repetition ratio (0-25 points)
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const repetitionRatio = 1 - (uniqueWords.size / wordCount);
  const repetitionScore = Math.min(25, repetitionRatio * 100);

  // Factor 4: Whitespace/formatting overhead (0-20 points)
  const whitespaceRatio = (text.match(/\s/g) ?? []).length / text.length;
  const formattingScore = Math.min(20, Math.max(0, (whitespaceRatio - 0.2) * 100));

  return Math.round(
    Math.min(100, fillerScore + sentenceLengthScore + repetitionScore + formattingScore)
  );
}
