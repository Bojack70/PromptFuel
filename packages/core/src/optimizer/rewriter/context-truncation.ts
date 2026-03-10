import type { RewritePassResult, AppliedRewrite } from './types.js';

/**
 * Level 4 aggressive context section truncation.
 * Detects sections starting with "Background:", "Context:", "Additional info:", etc.
 * Keeps the header + first sentence, drops remaining lines until a blank line ends the block.
 */

const SECTION_HEADERS = /^(background|context|additional\s+info(rmation)?|note(s)?|detail(s)?|preamble|overview)\s*:/im;

export function applyContextTruncation(text: string): RewritePassResult {
  const lines = text.split('\n');
  const result: string[] = [];
  const applied: AppliedRewrite[] = [];

  let inSection = false;
  let sectionStart = -1;
  let keptFirstSentence = false;
  let droppedLines: string[] = [];
  let headerLine = '';

  const flushDropped = () => {
    if (droppedLines.length > 0) {
      applied.push({
        ruleName: 'context-truncation',
        category: 'structure',
        original: `${headerLine}\n${droppedLines.join('\n')}`,
        replacement: headerLine,
        description: `Truncated "${headerLine.trim()}" section — kept header + first sentence, removed ${droppedLines.length} lines`,
      });
      droppedLines = [];
    }
    inSection = false;
    keptFirstSentence = false;
    headerLine = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inSection) {
      // Blank line ends the section block
      if (line.trim() === '') {
        flushDropped();
        result.push(line);
        continue;
      }

      if (!keptFirstSentence) {
        // Keep the first content line after the header
        result.push(line);
        keptFirstSentence = true;
      } else {
        // Drop subsequent lines in this section
        droppedLines.push(line);
      }
      continue;
    }

    // Check if this line starts a context section
    if (SECTION_HEADERS.test(line)) {
      inSection = true;
      sectionStart = i;
      keptFirstSentence = false;
      droppedLines = [];
      headerLine = line;

      // The header line itself is kept, and if the content is on the same line after the colon,
      // that counts as the "first sentence"
      const colonIdx = line.indexOf(':');
      const afterColon = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : '';
      if (afterColon.length > 0) {
        keptFirstSentence = true;
      }
      result.push(line);
      continue;
    }

    result.push(line);
  }

  // Flush any remaining section at end of text
  flushDropped();

  const output = result.join('\n');
  return { text: output, applied };
}
