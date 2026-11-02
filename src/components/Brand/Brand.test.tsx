import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Seal } from './Seal';
import { BrandMark } from './BrandMark';

describe('Seal', () => {
  it('reads "by { cdiezgil }" with the brand weights and gold braces', () => {
    render(<Seal />);
    const seal = screen.getByTestId('brand-seal');
    expect(seal).toHaveTextContent('by { cdiezgil }');
    expect(seal).toHaveAccessibleName('by cdiezgil');
    const [by, open, name, close] = Array.from(seal.children) as HTMLElement[];
    expect(by.style.fontWeight).toBe('300');
    expect(name.style.fontWeight).toBe('700');
    expect(open.style.color).toBe('var(--daun)');
    expect(close.style.color).toBe('var(--daun)');
  });
});

describe('BrandMark', () => {
  it('draws the leaf in the logo colour with gold nodes, and nothing else', () => {
    render(<BrandMark size={20} />);
    const svg = screen.getByTestId('brand-mark');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.querySelector('path')?.getAttribute('fill')).toBe('var(--logo)');
    const nodes = svg.querySelectorAll('circle');
    expect(nodes).toHaveLength(2);
    nodes.forEach((n) => expect(n.getAttribute('fill')).toBe('var(--gold)'));
    expect(svg.querySelector('mask')).toBeNull();
  });
});
