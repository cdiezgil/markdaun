import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChooseRoute } from './ChooseRoute';

describe('ChooseRoute', () => {
  it('shows the three routes and reports the chosen one', () => {
    const onSelect = vi.fn();
    render(<ChooseRoute onSelect={onSelect} />);
    expect(screen.getByText('Usar mi suscripción')).toBeInTheDocument();
    expect(screen.getByText('Tengo una API key')).toBeInTheDocument();
    expect(screen.getByText('Endpoint o proxy de mi empresa')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('route-subscription'));
    fireEvent.click(screen.getByTestId('route-apiKey'));
    fireEvent.click(screen.getByTestId('route-company'));
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['subscription', 'apiKey', 'company']);
  });
});
