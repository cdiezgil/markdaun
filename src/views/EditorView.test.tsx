import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EditorView } from './EditorView';
import React from 'react';

describe('TC-06: EditorView', () => {
  it('TC-06: muestra el path decodificado en data-testid="editor-path"', () => {
    const path = '/vault/nota.md';
    const encoded = encodeURIComponent(path);

    render(
      <MemoryRouter initialEntries={[`/editor/${encoded}`]}>
        <Routes>
          <Route path="/editor/:encodedPath" element={<EditorView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('editor-path').textContent).toBe(path);
  });
});
