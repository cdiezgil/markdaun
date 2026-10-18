import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArchiveSourceBar } from './ArchiveSourceBar';

const base = { source: 'Entrada/acta.pdf', archived: false, archiving: false, onArchive: vi.fn() };

describe('ArchiveSourceBar', () => {
  it('is disabled until a card was accepted', () => {
    render(<ArchiveSourceBar {...base} targetFolder={null} />);
    expect(screen.getByTestId('archive-source')).toBeDisabled();
    expect(screen.getByTestId('archive-source-bar')).toHaveTextContent('acta.pdf');
  });

  it('archives into the folder of the first accepted note', () => {
    const onArchive = vi.fn();
    render(<ArchiveSourceBar {...base} onArchive={onArchive} targetFolder="Mutua/ProyectoX" />);
    const btn = screen.getByTestId('archive-source');
    expect(btn).toBeEnabled();
    expect(screen.getByTestId('archive-source-bar')).toHaveTextContent('Mutua/ProyectoX/Fuentes');
    fireEvent.click(btn);
    expect(onArchive).toHaveBeenCalledWith('Mutua/ProyectoX');
  });

  it('names the root destination', () => {
    render(<ArchiveSourceBar {...base} targetFolder="" />);
    expect(screen.getByTestId('archive-source-bar')).toHaveTextContent('Fuentes');
    expect(screen.getByTestId('archive-source')).toBeEnabled();
  });

  it('shows where the source ended up once archived', () => {
    render(<ArchiveSourceBar {...base} source="Mutua/Fuentes/acta.pdf" archived targetFolder="Mutua" />);
    expect(screen.queryByTestId('archive-source')).toBeNull();
    expect(screen.getByTestId('archive-source-bar')).toHaveTextContent('Fuente archivada');
    expect(screen.getByTestId('archive-source-bar')).toHaveTextContent('Mutua/Fuentes/acta.pdf');
  });

  it('is disabled while archiving', () => {
    render(<ArchiveSourceBar {...base} archiving targetFolder="Mutua" />);
    expect(screen.getByTestId('archive-source')).toBeDisabled();
  });
});
