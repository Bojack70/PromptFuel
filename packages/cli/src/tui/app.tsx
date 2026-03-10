import React from 'react';
import { render } from 'ink';
import { Dashboard } from './Dashboard.js';

export async function launchTUI(model: string): Promise<void> {
  const { waitUntilExit } = render(<Dashboard initialModel={model} />);
  await waitUntilExit();
}
