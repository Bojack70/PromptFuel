import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { countTokens, calculateCost, optimize, monitorContext, listModels } from '@promptfuel/core';
import type { OptimizeOutput, ContextStatus } from '@promptfuel/core';
import { TokenPanel } from './TokenPanel.js';
import { CostPanel } from './CostPanel.js';
import { ContextBar } from './ContextBar.js';
import { OptimizerView } from './OptimizerView.js';
import clipboard from 'clipboardy';

interface DashboardProps {
  initialModel: string;
}

const availableModels = listModels();

export function Dashboard({ initialModel }: DashboardProps) {
  const { exit } = useApp();
  const [model, setModel] = useState(initialModel);
  const [promptText, setPromptText] = useState('');
  const [optimizeResult, setOptimizeResult] = useState<OptimizeOutput | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Compute analysis in real-time
  const tokens = promptText.length > 0 ? countTokens(promptText, model) : { inputTokens: 0, estimatedOutputTokens: 0 };
  const cost = promptText.length > 0
    ? calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, model)
    : { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' };

  const contextStatus: ContextStatus = promptText.length > 0
    ? monitorContext([{ role: 'user', content: promptText }], model)
    : { totalTokens: 0, percentUsed: 0, warning: 'green', remainingTokens: 0, contextWindow: 0 };

  const handleCopy = useCallback(async () => {
    if (optimizeResult) {
      try {
        await clipboard.write(optimizeResult.optimizedPrompt);
        setStatusMessage('Optimized prompt copied!');
        setTimeout(() => setStatusMessage(''), 2000);
      } catch {
        setStatusMessage('Copy failed');
      }
    }
  }, [optimizeResult]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    } else if (input === 'o' && promptText.length > 0) {
      const result = optimize(promptText, model);
      setOptimizeResult(result);
    } else if (input === 'c') {
      handleCopy();
    } else if (input === 'm') {
      const currentIdx = availableModels.indexOf(model);
      const nextIdx = (currentIdx + 1) % availableModels.length;
      setModel(availableModels[nextIdx]);
      setOptimizeResult(null);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Title Bar */}
      <Box justifyContent="space-between" borderStyle="double" paddingX={1}>
        <Text bold color="cyan"> PromptFuel Dashboard</Text>
        <Text>Model: <Text bold color="green">{model}</Text></Text>
      </Box>

      {/* Token + Cost panels side by side */}
      <Box marginTop={1}>
        <TokenPanel
          inputTokens={tokens.inputTokens}
          estimatedOutputTokens={tokens.estimatedOutputTokens}
        />
        <Box marginLeft={1}>
          <CostPanel
            inputCost={cost.inputCost}
            outputCost={cost.outputCost}
            totalCost={cost.totalCost}
          />
        </Box>
      </Box>

      {/* Context Bar */}
      {promptText.length > 0 && (
        <Box marginTop={1}>
          <ContextBar
            percentUsed={contextStatus.percentUsed}
            totalTokens={contextStatus.totalTokens}
            remainingTokens={contextStatus.remainingTokens}
            contextWindow={contextStatus.contextWindow}
            warning={contextStatus.warning}
          />
        </Box>
      )}

      {/* Prompt Input */}
      <Box marginTop={1} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold> Paste your prompt below:</Text>
        <Box>
          <Text color="cyan"> {'> '}</Text>
          <TextInput value={promptText} onChange={setPromptText} placeholder="Type or paste your prompt..." />
        </Box>
      </Box>

      {/* Optimizer View */}
      <Box marginTop={1}>
        <OptimizerView result={optimizeResult} onCopy={handleCopy} />
      </Box>

      {/* Status bar */}
      <Box marginTop={1}>
        {statusMessage ? (
          <Text color="green"> {statusMessage}</Text>
        ) : (
          <Text dimColor> q:quit  o:optimize  m:model  c:copy</Text>
        )}
      </Box>
    </Box>
  );
}
