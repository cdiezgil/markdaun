import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Toast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renders nothing without a message', () => {
    render(<Toast message={null} onDismiss={() => {}} />);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('shows the message politely and dismisses itself after a few seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Guardado en Entrada" onDismiss={onDismiss} />);
    const toast = screen.getByTestId('toast');
    expect(toast).toHaveTextContent('Guardado en Entrada');
    expect(toast).toHaveAttribute('role', 'status');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
