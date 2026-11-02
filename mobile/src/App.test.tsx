import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the setup screen when no config exists', () => {
    render(<App />);
    expect(screen.getByText('Conecta tu repositorio')).toBeInTheDocument();
  });
});
