import type { RewritePassResult, AppliedRewrite } from './types.js';

// Sorted longest-first to avoid partial match issues
const VERBOSE_MAP: Array<[RegExp, string]> = [
  // --- Polite padding (prompt context — removed entirely) ---
  [/I would appreciate it if you could\s*/gi, ''],
  [/it would be great if you could\s*/gi, ''],
  [/would it be possible for you to\s*/gi, ''],
  [/I was wondering if you could\s*/gi, ''],
  [/I would be grateful if you could\s*/gi, ''],
  [/please be so kind as to\s*/gi, ''],
  [/if you don't mind,?\s*/gi, ''],
  [/if it's not too much trouble,?\s*/gi, ''],

  // --- Wordy connectors (long → short) ---
  [/in the not too distant future/gi, 'soon'],
  [/in spite of the fact that/gi, 'although'],
  [/on account of the fact that/gi, 'because'],
  [/in light of the fact that/gi, 'since'],
  [/regardless of the fact that/gi, 'although'],
  [/notwithstanding the fact that/gi, 'although'],
  [/due to the fact that/gi, 'because'],
  [/despite the fact that/gi, 'although'],
  [/for the reason that/gi, 'because'],
  [/on the grounds that/gi, 'because'],
  [/with the result that/gi, 'so'],
  [/with the exception of/gi, 'except'],
  [/as a consequence of/gi, 'because of'],
  [/at this point in time/gi, 'now'],
  [/at the present time/gi, 'now'],
  [/in a situation where/gi, 'when'],
  [/in the near future/gi, 'soon'],
  [/with reference to/gi, 'about'],
  [/in the absence of/gi, 'without'],
  [/in the amount of/gi, 'for'],
  [/\bin the process of/gi, 'while'],
  [/as a matter of fact/gi, 'in fact'],
  [/with respect to/gi, 'about'],
  [/with regard to/gi, 'about'],
  [/in relation to/gi, 'about'],
  [/in addition to/gi, 'besides'],
  [/for the purpose of/gi, 'to'],
  [/in close proximity to/gi, 'near'],
  [/close proximity to/gi, 'near'],
  [/during the course of/gi, 'during'],
  [/in the event that/gi, 'if'],
  [/on a daily basis/gi, 'daily'],
  [/on a regular basis/gi, 'regularly'],
  [/on a weekly basis/gi, 'weekly'],
  [/in terms of/gi, 'regarding'],
  [/in regard to/gi, 'about'],
  [/in order to/gi, 'to'],
  [/subsequent to/gi, 'after'],
  [/in excess of/gi, 'over'],
  [/prior to/gi, 'before'],
  [/the fact that/gi, 'that'],
  [/whether or not/gi, 'whether'],

  // --- Unnecessary "the" before abstract/uncountable nouns in "how X works" patterns ---
  // Safe: only removes "the" when the noun is used generically, not referencing a specific thing
  [/\bhow (does |do |did )?the (gravity|electricity|photosynthesis|evolution|relativity|quantum mechanics|magnetism|friction|momentum|entropy|radiation|thermodynamics|nuclear fission|osmosis|diffusion|combustion|oxidation|metabolism|respiration|digestion|circulation|inflation|democracy|capitalism|socialism|machine learning|deep learning|artificial intelligence|blockchain|encryption|compression|recursion|polymorphism|inheritance|abstraction|concurrency|parallelism)\b/gi, 'how $1$2'],

  // --- Wordy verbs ---
  [/conduct an investigation (?:into|of|on)/gi, 'investigate'],
  [/perform an analysis (?:of|on)/gi, 'analyze'],
  [/carry out an evaluation (?:of|on)/gi, 'evaluate'],
  [/take into consideration/gi, 'consider'],
  [/come to a conclusion/gi, 'conclude'],
  [/make a recommendation/gi, 'recommend'],
  [/give a description of/gi, 'describe'],
  [/give an explanation of/gi, 'explain'],
  [/make an improvement to/gi, 'improve'],
  [/provide a summary of/gi, 'summarize'],
  [/give an indication of/gi, 'indicate'],
  [/reach an agreement on/gi, 'agree on'],
  [/make a comparison of/gi, 'compare'],
  [/conduct an investigation/gi, 'investigate'],
  [/perform an analysis/gi, 'analyze'],
  [/carry out an evaluation/gi, 'evaluate'],
  [/give a description/gi, 'describe'],
  [/give an explanation/gi, 'explain'],
  [/make an improvement/gi, 'improve'],
  [/provide a summary/gi, 'summarize'],
  [/give an indication/gi, 'indicate'],
  [/reach an agreement/gi, 'agree'],
  [/make a comparison/gi, 'compare'],
  [/has the capability to/gi, 'can'],
  [/have the capability to/gi, 'can'],
  [/has the potential to/gi, 'could'],
  [/have the potential to/gi, 'could'],
  [/has the ability to/gi, 'can'],
  [/have the ability to/gi, 'can'],
  [/provide assistance to/gi, 'help'],
  [/provide assistance/gi, 'help'],
  [/make a decision/gi, 'decide'],
  [/make an attempt/gi, 'try'],
  [/it is possible to/gi, 'can'],
  [/is it possible to/gi, 'can'],
  [/is able to/gi, 'can'],
  [/are able to/gi, 'can'],

  // --- Redundant qualifiers ---
  [/absolutely essential/gi, 'essential'],
  [/absolutely necessary/gi, 'necessary'],
  [/basic fundamentals/gi, 'fundamentals'],
  [/completely finished/gi, 'finished'],
  [/completely eliminated/gi, 'eliminated'],
  [/currently existing/gi, 'existing'],
  [/close proximity/gi, 'proximity'],
  [/each and every/gi, 'every'],
  [/end result/gi, 'result'],
  [/exact same/gi, 'same'],
  [/final outcome/gi, 'outcome'],
  [/first and foremost/gi, 'first'],
  [/free gift/gi, 'gift'],
  [/future plans/gi, 'plans'],
  [/general consensus/gi, 'consensus'],
  [/joint collaboration/gi, 'collaboration'],
  [/mutual cooperation/gi, 'cooperation'],
  [/new innovation/gi, 'innovation'],
  [/overall summary/gi, 'summary'],
  [/past experience/gi, 'experience'],
  [/past history/gi, 'history'],
  [/personal opinion/gi, 'opinion'],
  [/brief summary/gi, 'summary'],
  [/true fact/gi, 'fact'],
  [/unexpected surprise/gi, 'surprise'],
  [/advance planning/gi, 'planning'],
  [/added bonus/gi, 'bonus'],
  [/basic necessity/gi, 'necessity'],
  [/completely unanimous/gi, 'unanimous'],
  [/entirely eliminate/gi, 'eliminate'],
  [/final conclusion/gi, 'conclusion'],
  [/major breakthrough/gi, 'breakthrough'],
  [/one and only/gi, 'only'],
  [/part and parcel/gi, 'part'],
  [/any and all/gi, 'all'],
  [/if and when/gi, 'if'],
  [/unless and until/gi, 'until'],
  [/null and void/gi, 'void'],

  // --- Wordy quantity/quality phrases ---
  [/a sufficient number of/gi, 'enough'],
  [/a large number of/gi, 'many'],
  [/a small number of/gi, 'few'],
  [/a great deal of/gi, 'much'],
  [/a majority of/gi, 'most'],
  [/a significant amount of/gi, 'much'],
  [/a wide variety of/gi, 'various'],
  [/a considerable amount of/gi, 'much'],
  [/a limited number of/gi, 'few'],
  [/as far as I know/gi, ''],
  [/as far as I can tell/gi, ''],
  [/by means of/gi, 'by'],
  [/by virtue of/gi, 'by'],

  // --- Redundant adjective pairs ---
  [/\bdetailed and comprehensive\b/gi, 'detailed'],
  [/\bcomprehensive and detailed\b/gi, 'detailed'],
  [/\bthorough and comprehensive\b/gi, 'thorough'],
  [/\bcomprehensive and thorough\b/gi, 'thorough'],
  [/\bclear and concise\b/gi, 'concise'],
  [/\bconcise and clear\b/gi, 'concise'],
  [/\bfull and complete\b/gi, 'complete'],
  [/\bcomplete and full\b/gi, 'complete'],
  [/\baccurate and precise\b/gi, 'precise'],
  [/\bprecise and accurate\b/gi, 'precise'],

  // --- Prompt-specific filler ---
  [/please provide me with a\s*/gi, 'provide a '],
  [/please provide me with an\s*/gi, 'provide an '],
  [/please provide me with\s*/gi, 'provide '],
  [/provide me with a\s*/gi, 'provide a '],
  [/provide me with an\s*/gi, 'provide an '],
  [/provide me with\s*/gi, 'provide '],
  [/please give me a\s*/gi, 'give a '],
  [/please give me an\s*/gi, 'give an '],
  [/please give me\s*/gi, 'give '],
  [/I would like you to\s*/gi, ''],
  [/I would like to\s*/gi, ''],
  [/I want you to\s*/gi, ''],
  [/I need you to\s*/gi, ''],
  [/please make sure to\s*/gi, ''],
  [/please ensure that\s*/gi, 'ensure '],
  [/can you please\s*/gi, ''],
  [/could you please\s*/gi, ''],
  [/could you\s+(?=[a-zA-Z])/gi, ''],
  [/can you\s+(?=[a-zA-Z])/gi, ''],
  [/please go ahead and\s*/gi, ''],
  [/go ahead and\s*/gi, ''],
  [/I'm looking for\s*/gi, ''],
  [/what I'm looking for is\s*/gi, ''],
  // Standalone politeness tokens — no semantic value in LLM prompts
  // Must come AFTER compound "please/kindly" phrases above so those are handled first
  [/\bplease\b,?\s*/gi, ''],
  [/\bkindly\b,?\s*/gi, ''],

  // --- Conversational affirmatives (acknowledge-then-instruct pattern) ---
  // Patterns are intentionally specific to avoid garbling mid-sentence adjectives
  [/\byeah,?\s+/gi, ''],
  [/\byes,?\s+/gi, ''],
  [/\bright,?\s+so\s+/gi, ''],
  // "yes, that's correct." / "yes that's right." — full affirmative sentence fragment
  [/\byes,?\s+that(?:'s| is)\s+(?:correct|right|good|great)[,.]?\s*/gi, ''],
  // "that looks great, now" — conversational acknowledge-then-redirect
  [/\bthat looks (?:great|good|perfect|awesome),?\s+now\s+/gi, ''],
  // "good, now" / "great, now" only at start of string or after sentence boundary
  [/(?:^|(?<=[.!?]\s{0,2}))(?:good|great|perfect|awesome)[,!]?\s+now\s+/gim, ''],

  // --- Transition fillers ---
  [/just to clarify,?\s+/gi, ''],
  [/just so you know,?\s+/gi, ''],
  [/by the way,?\s+/gi, ''],
  [/one more thing,?\s*/gi, ''],
  [/moving on,?\s+/gi, ''],
  [/before we continue,?\s+/gi, ''],
  [/to be clear,?\s+/gi, ''],
  [/for context,?\s+/gi, ''],
  [/for what it(?:'s| is) worth,?\s+/gi, ''],
  [/as a reminder,?\s+/gi, ''],

  // --- Weak hedges ---
  // Handle "I think that" / "I believe that" — remove whole phrase including "that"
  [/\bI think\s+that\s+/gi, ''],
  [/\bI believe\s+that\s+/gi, ''],
  [/\bI think\s+(?=\w)/gi, ''],
  [/\bI believe\s+(?=\w)/gi, ''],
  [/so I was thinking\s+/gi, ''],
  [/I was thinking\s+/gi, ''],
  // Weak hedge adverbs — reduce noise without changing meaning
  [/\bprobably\s+(?=try|want|need|should|could|would|might)/gi, ''],
  [/\bmaybe\s+you\s+should\s+/gi, 'you should '],
];

export function applyVerbosePhrases(text: string): RewritePassResult {
  const applied: AppliedRewrite[] = [];
  let current = text;

  for (const [pattern, replacement] of VERBOSE_MAP) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;

    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(current)) !== null) {
      matches.push({ ...match, index: match.index } as RegExpExecArray);
      if (!pattern.global) break;
    }

    if (matches.length > 0) {
      const before = current;
      current = current.replace(pattern, replacement);

      for (const m of matches) {
        applied.push({
          ruleName: 'verbose-phrase',
          category: 'verbose-phrase',
          original: m[0].trim(),
          replacement: replacement || '[removed]',
          description: replacement
            ? `Replaced "${m[0].trim()}" with "${replacement}"`
            : `Removed unnecessary phrase: "${m[0].trim()}"`,
        });
      }
    }
  }

  // Fix capitalization after removals at sentence starts
  current = current.replace(/([.!?]\s+)([a-z])/g, (_, punct, char) => punct + char.toUpperCase());
  // Fix start of string
  if (current.length > 0 && /^[a-z]/.test(current)) {
    current = current.charAt(0).toUpperCase() + current.slice(1);
  }

  return { text: current, applied };
}
