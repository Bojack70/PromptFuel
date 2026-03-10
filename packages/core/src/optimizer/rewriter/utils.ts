export function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ensurePunctuation(s: string, defaultPunct: string = '.'): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  if (/[.?!]$/.test(trimmed)) return trimmed;
  return trimmed + defaultPunct;
}

export function collapseSpaces(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

export function preserveSentenceStart(original: string, replacement: string, fullText: string): string {
  if (!replacement) return replacement;
  const idx = fullText.indexOf(original);
  if (idx === 0 || (idx > 0 && /[.!?]\s*$/.test(fullText.slice(0, idx)))) {
    return capitalizeFirst(replacement);
  }
  return replacement;
}
