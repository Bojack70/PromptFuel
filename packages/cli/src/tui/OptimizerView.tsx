import React from 'react';
import { Box, Text } from 'ink';
import type { OptimizeOutput } from '@promptfuel/core';

interface OptimizerViewProps {
  result: OptimizeOutput | null;
  onCopy: () => void;
}

export function OptimizerView({ result, onCopy }: OptimizerViewProps) {
  if (!result) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold> Optimization</Text>
        <Text dimColor> Press 'o' to optimize your prompt</Text>
      </Box>
    );
  }

  const hasSuggestions = result.suggestions.length > 0;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold> Optimization Suggestions</Text>
      {hasSuggestions ? (
        <>
          {result.suggestions.slice(0, 5).map((s, i) => (
            <Box key={i} flexDirection="column" marginTop={i > 0 ? 0 : 0}>
              <Text color="yellow"> • [{s.rule}] {s.description}</Text>
            </Box>
          ))}
          {result.suggestions.length > 5 && (
            <Text dimColor> ...and {result.suggestions.length - 5} more</Text>
          )}
        </>
      ) : (
        <Text color="green"> Prompt looks clean — no suggestions.</Text>
      )}
      <Box marginTop={1}>
        <Text bold color="green">
          Savings: {result.tokenReduction} tokens ({result.reductionPercent}%)
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor> Verbosity: {result.verbosityScore}/100 • Press 'c' to copy optimized</Text>
      </Box>
    </Box>
  );
}
