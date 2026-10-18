import { describe, it, expect } from 'vitest';
import { dayLabel, groupByDay } from './groupByDay';

const now = new Date(2024, 5, 10, 12, 0);

describe('groupByDay', () => {
  it('labels today, yesterday and older days', () => {
    expect(dayLabel(new Date(2024, 5, 10, 1), now)).toBe('Hoy');
    expect(dayLabel(new Date(2024, 5, 9, 23), now)).toBe('Ayer');
    expect(dayLabel(new Date(2024, 5, 1), now)).toMatch(/1.*jun/);
  });

  it('groups consecutive items of the same day, preserving order', () => {
    const items = [
      { id: 'a', created_at: new Date(2024, 5, 10, 9).toISOString() },
      { id: 'b', created_at: new Date(2024, 5, 10, 8).toISOString() },
      { id: 'c', created_at: new Date(2024, 5, 9, 8).toISOString() },
    ];
    const g = groupByDay(items, now);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Hoy', ['a', 'b']],
      ['Ayer', ['c']],
    ]);
  });
});
