/**
 * Anti-polish — strips mechanical AI-voice tells from generated text before
 * the quality gate sees it.
 *
 * This catches the stuff regex can reliably catch: transition spam
 * ("Furthermore,"), corpspeak verbs ("leverage", "utilize"), hedge phrases
 * ("it's important to note that"), conclusion markers ("in conclusion"),
 * AI-flavoured openers ("in today's world", "in the realm of"), and
 * em-dash overuse.
 *
 * It does NOT do voice-level polish (e.g. "this sounds too balanced, make it
 * opinionated"). That's what the worldview + notebook + reading insights in
 * the generation prompt are for. The anti-polish pass is the last line of
 * defence against mechanical tells.
 *
 * Applied between generation and quality review: the reviewer sees the cleaned
 * version, so quality scores reflect what will actually ship.
 */

export type AntiPolishPlatform = 'bluesky' | 'twitter' | 'devto' | 'medium';

export interface AntiPolishResult {
  text: string;
  changes: string[];  // labels of transforms that fired, for logging
}

/**
 * Per-transform rule. `match` is applied first; if null, the rule is skipped.
 * If `match` matches, `replace` produces the new string.
 */
interface Rule {
  label: string;
  match: RegExp;
  replace: string;
  // Platforms this rule applies to; undefined = all.
  platforms?: AntiPolishPlatform[];
}

// -- Universal rules -----------------------------------------------------------

const UNIVERSAL_RULES: Rule[] = [
  // AI openers — strip the opening phrase and keep the rest of the sentence.
  { label: 'opener:in-todays-world', match: /^\s*In today'?s (world|age|landscape|era|market|economy)[,:]?\s*/i, replace: '' },
  { label: 'opener:in-the-realm-of', match: /^\s*In the (realm|world|space|domain|landscape|age) of [^,.]+[,.]?\s*/i, replace: '' },
  { label: 'opener:we-live-in', match: /^\s*We live in (a|an) [a-z-]+ (world|age|time|era)[,.]?\s*/i, replace: '' },
  { label: 'opener:picture-this', match: /^\s*Picture this[:.]?\s*/i, replace: '' },
  { label: 'opener:imagine-this', match: /^\s*Imagine this[:.]?\s*/i, replace: '' },

  // Transition spam
  { label: 'transition:furthermore', match: /\bFurthermore,?\s*/g, replace: '' },
  { label: 'transition:moreover', match: /\bMoreover,?\s*/g, replace: '' },
  { label: 'transition:additionally', match: /\bAdditionally,?\s*/g, replace: '' },
  { label: 'transition:in-addition', match: /\bIn addition,?\s*/g, replace: '' },
  { label: 'transition:that-being-said', match: /\bThat being said,?\s*/g, replace: '' },
  { label: 'transition:with-that-in-mind', match: /\bWith that in mind,?\s*/g, replace: '' },

  // Hedge phrases — straight deletion is safe; the surrounding sentence still works
  { label: 'hedge:important-to-note', match: /\bIt'?s (important|worth noting|crucial) to (note|mention|understand|remember) that\s*/gi, replace: '' },
  { label: 'hedge:worth-mentioning', match: /\bIt'?s worth mentioning that\s*/gi, replace: '' },
  { label: 'hedge:keep-in-mind', match: /\bKeep in mind that\s*/gi, replace: '' },

  // Conclusion markers
  { label: 'conclusion:in-conclusion', match: /\bIn conclusion,?\s*/gi, replace: '' },
  { label: 'conclusion:to-summarize', match: /\bTo (summarize|summarise|sum up|conclude|wrap up),?\s*/gi, replace: '' },
  { label: 'conclusion:all-in-all', match: /\bAll in all,?\s*/gi, replace: '' },
  { label: 'conclusion:at-the-end-of-the-day', match: /\bAt the end of the day,?\s*/gi, replace: '' },

  // Corpspeak verbs → plain
  { label: 'corpspeak:leverage', match: /\bleverag(e|es|ed|ing)\b/gi, replace: (m: string) => {
    const map: Record<string, string> = { leverage: 'use', leverages: 'uses', leveraged: 'used', leveraging: 'using' };
    return map[m.toLowerCase()] ?? m;
  } } as unknown as Rule,
  { label: 'corpspeak:utilize', match: /\butiliz(e|es|ed|ing)\b/gi, replace: (m: string) => {
    const map: Record<string, string> = { utilize: 'use', utilizes: 'uses', utilized: 'used', utilizing: 'using' };
    return map[m.toLowerCase()] ?? m;
  } } as unknown as Rule,
  { label: 'corpspeak:utilise', match: /\butilis(e|es|ed|ing)\b/gi, replace: (m: string) => {
    const map: Record<string, string> = { utilise: 'use', utilises: 'uses', utilised: 'used', utilising: 'using' };
    return map[m.toLowerCase()] ?? m;
  } } as unknown as Rule,
  { label: 'corpspeak:facilitate', match: /\bfacilitat(e|es|ed|ing)\b/gi, replace: (m: string) => {
    const map: Record<string, string> = { facilitate: 'enable', facilitates: 'enables', facilitated: 'enabled', facilitating: 'enabling' };
    return map[m.toLowerCase()] ?? m;
  } } as unknown as Rule,
  { label: 'corpspeak:spearhead', match: /\bspearhead(s|ed|ing)?\b/gi, replace: (m: string) => {
    const map: Record<string, string> = { spearhead: 'lead', spearheads: 'leads', spearheaded: 'led', spearheading: 'leading' };
    return map[m.toLowerCase()] ?? m;
  } } as unknown as Rule,
  { label: 'corpspeak:in-order-to', match: /\bin order to\b/gi, replace: 'to' },

  // AI cliché nouns
  { label: 'cliche:tapestry', match: /\btapestry\b/gi, replace: 'mix' },
  { label: 'cliche:realm', match: /\brealm\b/gi, replace: 'world' },
  { label: 'cliche:robust-solution', match: /\brobust solutions?\b/gi, replace: 'fix' },

  // "Navigate" as a metaphor is an AI tell — but it has legit literal uses.
  // Only catch the common metaphor phrasings.
  { label: 'cliche:navigate-complexities', match: /\bnavigat(e|es|ed|ing) (the )?complexit(y|ies)( of)?\b/gi, replace: 'handle the complexity' },
  { label: 'cliche:navigate-challenges', match: /\bnavigat(e|es|ed|ing) (the )?challenges?\b/gi, replace: 'handle the challenge' },
];

// -- Platform-specific rules ---------------------------------------------------

const TWITTER_BLUESKY_RULES: Rule[] = [
  // Bullet lists look mechanical on short-form. Convert single-word bullets to a comma list;
  // otherwise strip the bullet marker and keep the line.
  { label: 'shortform:strip-bullet-dash', match: /^[-•*]\s+/gm, replace: '' },
  // Emoji bullets at line start
  { label: 'shortform:strip-emoji-bullet', match: /^[📌🔥✅💡🚀⚡️]\s+/gm, replace: '' },
];

// -- Em-dash moderation --------------------------------------------------------

function moderateEmDashes(text: string, maxAllowed: number): { text: string; replaced: number } {
  const matches = text.match(/—/g);
  if (!matches || matches.length <= maxAllowed) return { text, replaced: 0 };

  const toReplace = matches.length - maxAllowed;
  const positions: number[] = [];
  let i = -1;
  while ((i = text.indexOf('—', i + 1)) !== -1) positions.push(i);

  // Replace the LAST `toReplace` occurrences — keep the first use intact (feels natural).
  const targets = positions.slice(-toReplace).reverse();
  let out = text;
  let replaced = 0;

  for (const pos of targets) {
    // Handle the common " — " (space em-dash space) pattern: replace with ". ".
    // Also capitalize the next letter if alphabetic.
    const hasSpaceBefore = pos > 0 && out[pos - 1] === ' ';
    const hasSpaceAfter = pos + 1 < out.length && out[pos + 1] === ' ';
    const nextChar = pos + 2 < out.length ? out[pos + 2] : '';

    if (hasSpaceBefore && hasSpaceAfter) {
      // "word — next" → "word. Next"
      const capped = nextChar >= 'a' && nextChar <= 'z' ? nextChar.toUpperCase() : nextChar;
      out = out.slice(0, pos - 1) + '. ' + capped + out.slice(pos + 3);
    } else {
      // Edge case: no surrounding spaces, just swap in a period.
      out = out.slice(0, pos) + '.' + out.slice(pos + 1);
    }
    replaced++;
  }

  return { text: out, replaced };
}

// -- Main entry ----------------------------------------------------------------

/**
 * Apply anti-polish to a generated post. Non-destructive: if no rule fires, the
 * text is returned unchanged.
 */
export function antiPolish(input: string, platform: AntiPolishPlatform): AntiPolishResult {
  let text = input;
  const changes: string[] = [];

  const rules: Rule[] = [
    ...UNIVERSAL_RULES,
    ...((platform === 'bluesky' || platform === 'twitter') ? TWITTER_BLUESKY_RULES : []),
  ];

  for (const rule of rules) {
    const before = text;
    // Some rules use function replacers; TypeScript can't easily express
    // "regex-string replace OR regex-function replace" in a single shape so
    // the rules array stores `replace` as string | function and we dispatch here.
    const replace = rule.replace as unknown;
    if (typeof replace === 'function') {
      text = text.replace(rule.match, replace as (substring: string) => string);
    } else {
      text = text.replace(rule.match, replace as string);
    }
    if (text !== before) changes.push(rule.label);
  }

  // Em-dash moderation — more aggressive on short-form platforms
  const emDashMax = (platform === 'bluesky' || platform === 'twitter') ? 1 : 3;
  const emResult = moderateEmDashes(text, emDashMax);
  text = emResult.text;
  if (emResult.replaced > 0) changes.push(`em-dash:reduced-${emResult.replaced}`);

  // Final tidy: collapse double spaces, fix "leading whitespace after opener removal"
  // and restore sentence capitalization where an opener deletion left a lowercase start.
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If the first character is lowercase after our transforms (likely from opener removal),
  // capitalize it — AI openers end with a comma so the next word was lowercase.
  if (text.length > 0 && text[0] >= 'a' && text[0] <= 'z') {
    text = text[0].toUpperCase() + text.slice(1);
    changes.push('cap:restore-opener');
  }

  return { text, changes };
}
