import React from 'react';
import { Box, Text } from 'ink';

interface TokenPanelProps {
  inputTokens: number;
  estimatedOutputTokens: number;
}

export function TokenPanel({ inputTokens, estimatedOutputTokens }: TokenPanelProps) {
  const total = inputTokens + estimatedOutputTokens;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={28}>
      <Text bold> Token Count</Text>
      <Text> Input:  {inputTokens.toLocaleString()}</Text>
      <Text> Output: ~{estimatedOutputTokens.toLocaleString()}</Text>
      <Text bold> Total:  {total.toLocaleString()}</Text>
    </Box>
  );
}
