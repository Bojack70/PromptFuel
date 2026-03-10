export interface StrategyContext {
  /** Current working directory (project root) */
  projectDir?: string;
  /** Relative file paths found in the project */
  projectFiles?: string[];
  /** Content of key project files (keyed by relative path) */
  fileContents?: Record<string, string>;
  /** Conversation messages if analyzing a chat */
  conversation?: Array<{ role: string; content: string }>;
  /** Current model being used */
  model?: string;
}

export interface StrategyRecommendation {
  id: string;
  name: string;
  category: 'project-config' | 'conversation' | 'model-selection' | 'prompt-engineering';
  description: string;
  impact: 'high' | 'medium' | 'low';
  estimatedTokenSavings: number;
  estimatedCostSavings: number;
  /** What will happen if the user accepts */
  actionDescription: string;
  /** Generated content to write/apply */
  generatedContent?: string;
  /** Target file path (relative to project root) */
  targetFile?: string;
  /** Whether this creates a new file */
  createsFile?: boolean;
}

export interface StrategyAnalysis {
  recommendations: StrategyRecommendation[];
  totalEstimatedTokenSavings: number;
  totalEstimatedCostSavings: number;
  projectSummary: string;
}
