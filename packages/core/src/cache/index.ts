// ── Types ──

export interface CachePromptEntry {
  prompt: string;
  tokens: number;
  cost: number;
  model: string;
  timestamp?: string;
}

export interface PromptCluster {
  id: number;
  representative: string;
  promptCount: number;
  totalTokens: number;
  totalCost: number;
  cacheableTokens: number;
  cacheableCost: number;
  avgSimilarity: number;
  samplePrompts: string[];
}

export interface CacheAnalysis {
  clusters: PromptCluster[];
  totalPrompts: number;
  cacheablePrompts: number;
  estimatedCacheHitRate: number;
  estimatedMonthlySavings: number;
  estimatedMonthlyTokenSavings: number;
  topPatterns: Array<{ pattern: string; count: number; savings: number }>;
  setupGuides: CacheSetupGuide[];
}

export interface CacheSetupGuide {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'advanced';
  infrastructure: string;
  steps: string[];
  estimatedSetupTime: string;
}

// ── Stop Words ──

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'that', 'this', 'these', 'those', 'it', 'its', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'please', 'also', 'like', 'make', 'get', 'use',
]);

// ── Helpers ──

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ── Static Setup Guides ──

const SETUP_GUIDES: CacheSetupGuide[] = [
  {
    id: 'anthropic-cache',
    name: 'Anthropic Prompt Caching',
    description: 'Native Claude API caching — mark static content with cache_control breakpoints for 90% cheaper cache reads.',
    difficulty: 'easy',
    infrastructure: 'None (built into Claude API)',
    steps: [
      'Identify static system prompts and few-shot examples in your requests',
      'Add cache_control: { type: "ephemeral" } to those content blocks',
      'Place cacheable content at the beginning of your messages',
      'Monitor cache_read_input_tokens in API responses to verify hits',
    ],
    estimatedSetupTime: '30 minutes',
  },
  {
    id: 'redis-semantic',
    name: 'Redis Semantic Cache (GPTCache)',
    description: 'Open-source semantic caching with Redis backend — works with any LLM provider, uses embeddings for fuzzy matching.',
    difficulty: 'medium',
    infrastructure: 'Redis + embedding model (e.g. OpenAI text-embedding-3-small)',
    steps: [
      'Install GPTCache: pip install gptcache',
      'Configure Redis as the cache backend',
      'Set up an embedding model for semantic similarity',
      'Wrap your LLM calls with GPTCache middleware',
      'Tune similarity threshold (0.8-0.95) based on your use case',
    ],
    estimatedSetupTime: '2-4 hours',
  },
  {
    id: 'app-level-dedup',
    name: 'Application-Level Deduplication',
    description: 'Zero-infrastructure approach — normalize prompts, hash with SHA-256, and return cached responses for exact or near-exact matches.',
    difficulty: 'easy',
    infrastructure: 'None (in-memory or any key-value store)',
    steps: [
      'Normalize incoming prompts: lowercase, trim whitespace, remove punctuation',
      'Generate SHA-256 hash of the normalized prompt',
      'Check hash against your cache store before calling the LLM',
      'Store response with hash key and a TTL (e.g. 1 hour)',
      'Add cache-hit metrics to monitor effectiveness',
    ],
    estimatedSetupTime: '1-2 hours',
  },
];

// ── Core Analysis ──

const SIMILARITY_THRESHOLD = 0.45;
const MIN_WORDS = 5;

export function analyzeCacheOpportunity(entries: CachePromptEntry[]): CacheAnalysis {
  const empty: CacheAnalysis = {
    clusters: [],
    totalPrompts: entries.length,
    cacheablePrompts: 0,
    estimatedCacheHitRate: 0,
    estimatedMonthlySavings: 0,
    estimatedMonthlyTokenSavings: 0,
    topPatterns: [],
    setupGuides: SETUP_GUIDES,
  };

  if (entries.length === 0) return empty;

  // Filter out very short prompts
  const validEntries = entries.filter(e => {
    const wordCount = e.prompt.trim().split(/\s+/).length;
    return wordCount >= MIN_WORDS;
  });

  if (validEntries.length === 0) return { ...empty, totalPrompts: entries.length };

  // Extract keywords for each entry
  const entryKeywords = validEntries.map(e => extractKeywords(e.prompt));

  // Greedy single-pass clustering
  const clusters: Array<{
    keywords: Set<string>;
    entries: Array<{ entry: CachePromptEntry; similarity: number }>;
  }> = [];

  for (let i = 0; i < validEntries.length; i++) {
    const kw = entryKeywords[i];
    let bestClusterIdx = -1;
    let bestSim = 0;

    for (let c = 0; c < clusters.length; c++) {
      const sim = jaccardSimilarity(kw, clusters[c].keywords);
      if (sim > bestSim) {
        bestSim = sim;
        bestClusterIdx = c;
      }
    }

    if (bestClusterIdx >= 0 && bestSim >= SIMILARITY_THRESHOLD) {
      clusters[bestClusterIdx].entries.push({ entry: validEntries[i], similarity: bestSim });
    } else {
      clusters.push({
        keywords: kw,
        entries: [{ entry: validEntries[i], similarity: 1 }],
      });
    }
  }

  // Keep only clusters with 2+ members
  const multiClusters = clusters.filter(c => c.entries.length >= 2);

  // Build PromptCluster results
  const promptClusters: PromptCluster[] = multiClusters.map((c, idx) => {
    const count = c.entries.length;
    const totalTokens = c.entries.reduce((s, e) => s + e.entry.tokens, 0);
    const totalCost = c.entries.reduce((s, e) => s + e.entry.cost, 0);
    // First prompt pays full, remaining N-1 are cache hits saving 90% of input cost
    const cacheableCount = count - 1;
    const avgTokensPerPrompt = totalTokens / count;
    const avgCostPerPrompt = totalCost / count;
    const cacheableTokens = Math.round(avgTokensPerPrompt * cacheableCount);
    const cacheableCost = avgCostPerPrompt * cacheableCount * 0.9;
    const avgSimilarity = c.entries.reduce((s, e) => s + e.similarity, 0) / count;

    const samples = c.entries
      .slice(0, 3)
      .map(e => truncate(e.entry.prompt, 120));

    return {
      id: idx + 1,
      representative: truncate(c.entries[0].entry.prompt, 100),
      promptCount: count,
      totalTokens,
      totalCost,
      cacheableTokens,
      cacheableCost,
      avgSimilarity,
      samplePrompts: samples,
    };
  });

  // Sort by savings descending
  promptClusters.sort((a, b) => b.cacheableCost - a.cacheableCost);

  // Aggregate
  const cacheablePrompts = promptClusters.reduce((s, c) => s + (c.promptCount - 1), 0);
  const estimatedMonthlySavings = promptClusters.reduce((s, c) => s + c.cacheableCost, 0);
  const estimatedMonthlyTokenSavings = promptClusters.reduce((s, c) => s + c.cacheableTokens, 0);
  const estimatedCacheHitRate = entries.length > 0
    ? (cacheablePrompts / entries.length) * 100
    : 0;

  // Top patterns: extract common keyword pattern from each cluster
  const topPatterns = promptClusters.slice(0, 5).map(c => ({
    pattern: c.representative,
    count: c.promptCount,
    savings: c.cacheableCost,
  }));

  return {
    clusters: promptClusters,
    totalPrompts: entries.length,
    cacheablePrompts,
    estimatedCacheHitRate,
    estimatedMonthlySavings,
    estimatedMonthlyTokenSavings,
    topPatterns,
    setupGuides: SETUP_GUIDES,
  };
}
