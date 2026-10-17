import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SetupPrompt } from './SetupPrompt';
import { useLlmStore } from '../../store/llmStore';

beforeEach(() => {
  useLlmStore.setState({ wizardOpen: false, editing: null });
});

describe('SetupPrompt', () => {
  it('explains the three routes and opens the wizard', () => {
    render(<SetupPrompt />);
    expect(screen.getByTestId('setup-prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('setup-prompt-btn'));
    expect(useLlmStore.getState().wizardOpen).toBe(true);
    expect(useLlmStore.getState().editing).toBeNull();
  });
});
