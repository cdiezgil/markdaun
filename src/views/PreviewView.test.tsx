import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreviewView } from './PreviewView';
import React from 'react';

describe('PreviewView', () => {
  it('renderiza PreviewPanel con el path decodificado (imagen)', () => {
    const path = '/vault/foto.png';
    const encoded = encodeURIComponent(path);

    const { container } = render(
      <MemoryRouter initialEntries={[`/preview/${encoded}`]}>
        <Routes>
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
        </Routes>
      </MemoryRouter>,
    );

    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('asset:///vault/foto.png');
  });

  it('renderiza PreviewPanel con el path decodificado (pdf)', () => {
    const path = '/vault/doc.pdf';
    const encoded = encodeURIComponent(path);

    const { container } = render(
      <MemoryRouter initialEntries={[`/preview/${encoded}`]}>
        <Routes>
          <Route path="/preview/:encodedPath" element={<PreviewView />} />
        </Routes>
      </MemoryRouter>,
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute('src')).toBe('asset:///vault/doc.pdf');
  });
});
