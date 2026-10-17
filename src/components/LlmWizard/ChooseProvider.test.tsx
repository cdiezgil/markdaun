import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChooseProvider } from './ChooseProvider';
import { PRESETS } from '../../lib/llm/presets';

describe('ChooseProvider', () => {
  it('lists only the presets of the route and reports the chosen one', () => {
    const onSelect = vi.fn();
    render(<ChooseProvider route="subscription" onSelect={onSelect} onBack={() => {}} />);
    expect(screen.getByTestId('preset-claude-code')).toBeInTheDocument();
    expect(screen.getByTestId('preset-gemini-cli')).toBeInTheDocument();
    expect(screen.queryByTestId('preset-anthropic-api')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('preset-claude-code'));
    expect(onSelect).toHaveBeenCalledWith(PRESETS.find((p) => p.id === 'claude-code'));
  });

  it('shows each preset help text', () => {
    render(<ChooseProvider route="company" onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getByTestId('preset-proxy')).toHaveTextContent(/compatible con OpenAI/i);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4);
  });

  it('has a back button', () => {
    const onBack = vi.fn();
    render(<ChooseProvider route="apiKey" onSelect={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
