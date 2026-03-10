export interface AppliedRewrite {
  ruleName: string;
  category: 'compression' | 'voice' | 'question' | 'verbose-phrase' | 'structure';
  original: string;
  replacement: string;
  description: string;
}

export interface RewritePassResult {
  text: string;
  applied: AppliedRewrite[];
}

export interface RewriteResult {
  rewrittenText: string;
  appliedRules: AppliedRewrite[];
}
