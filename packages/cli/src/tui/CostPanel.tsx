import React from 'react';
import { Box, Text } from 'ink';
import { formatCost } from '@promptfuel/core';

interface CostPanelProps {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export function CostPanel({ inputCost, outputCost, totalCost }: CostPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={32}>
      <Text bold> Estimated Cost</Text>
      <Text> Input:  {formatCost(inputCost)}</Text>
      <Text> Output: {formatCost(outputCost)}</Text>
      <Text bold> Total:  {formatCost(totalCost)}</Text>
    </Box>
  );
}
