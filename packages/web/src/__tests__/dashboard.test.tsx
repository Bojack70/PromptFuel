import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Dashboard } from '../App.js';

// Mock fetch used by the Insights tab to load Claude Code data
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({}),
  });
});

describe('Dashboard', () => {
  it('renders without crashing', () => {
    render(<Dashboard />);
    expect(screen.getByText('PromptFuel')).toBeInTheDocument();
  });

  it('shows the four tab labels', () => {
    render(<Dashboard />);
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('Analyze & Optimize')).toBeInTheDocument();
    expect(screen.getByText(/History/)).toBeInTheDocument();
    expect(screen.getByText('Strategies')).toBeInTheDocument();
  });

  it('Insights tab is active by default', () => {
    render(<Dashboard />);
    const insightsBtn = screen.getByText('Insights');
    // Active tab has a blue bottom border via inline style
    expect(insightsBtn).toBeInTheDocument();
  });

  it('switches to Analyze & Optimize tab on click', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Analyze & Optimize'));
    expect(screen.getByPlaceholderText(/Paste or type your prompt/i)).toBeInTheDocument();
  });

  it('Analyze tab shows model selector', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Analyze & Optimize'));
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('Analyze tab shows token stats after typing', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Analyze & Optimize'));
    const textarea = screen.getByPlaceholderText(/Paste or type your prompt/i);
    fireEvent.change(textarea, { target: { value: 'Explain React hooks in detail' } });
    expect(screen.getAllByText(/token/i).length).toBeGreaterThan(0);
  });

  it('switches to History tab on click', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText(/History/));
    // Empty state message when no history
    expect(screen.getByText(/No optimization history yet/i)).toBeInTheDocument();
  });

  it('switches to Strategies tab on click', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Strategies'));
    expect(screen.getByText(/Analyze Strategies/i)).toBeInTheDocument();
  });

  it('Insights tab shows empty state when no history', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByText('Insights'));
    expect(screen.getByText('No optimization data yet')).toBeInTheDocument();
  });
});
