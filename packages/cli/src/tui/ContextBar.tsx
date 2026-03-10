import React from 'react';
import { Box, Text } from 'ink';
import type { WarningLevel } from '@promptfuel/core';

interface ContextBarProps {
  percentUsed: number;
  totalTokens: number;
  remainingTokens: number;
  contextWindow: number;
  warning: WarningLevel;
}

const WARNING_COLORS: Record<WarningLevel, string> = {
  green: 'green',
  yellow: 'yellow',
  orange: 'yellowBright',
  red: 'red',
};

export function ContextBar({ percentUsed, totalTokens, remainingTokens, contextWindow, warning }: ContextBarProps) {
  const barWidth = 40;
  const filled = Math.round((percentUsed / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = WARNING_COLORS[warning];

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold> Context Window</Text>
      <Box>
        <Text> [</Text>
        <Text color={color}>{bar}</Text>
        <Text>] {percentUsed}%</Text>
      </Box>
      <Text dimColor> {totalTokens.toLocaleString()} / {contextWindow.toLocaleString()} tokens • {remainingTokens.toLocaleString()} remaining</Text>
    </Box>
  );
}
