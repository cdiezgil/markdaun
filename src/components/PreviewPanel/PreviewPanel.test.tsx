import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewPanel } from './PreviewPanel';

describe('TC-07: PreviewPanel', () => {
  it('TC-07: .png renderiza un <img>', () => {
    const { container } = render(<PreviewPanel filePath="/vault/foto.png" />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('asset:///vault/foto.png');
  });

  it('TC-07: .pdf renderiza un <iframe>', () => {
    const { container } = render(<PreviewPanel filePath="/vault/doc.pdf" />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute('src')).toBe('asset:///vault/doc.pdf');
  });

  it('TC-07: extensión desconocida devuelve null (nada renderizado)', () => {
    const { container } = render(<PreviewPanel filePath="/vault/script.py" />);
    expect(container.firstChild).toBeNull();
  });

  it('TC-07: extensión en mayúsculas (.PNG) funciona igual', () => {
    const { container } = render(<PreviewPanel filePath="/vault/foto.PNG" />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('asset:///vault/foto.PNG');
  });
});
