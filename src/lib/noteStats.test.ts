import { describe, it, expect } from 'vitest';
import { countWords, countBytes, countLines, readingTime, formatBytes } from './noteStats';

describe('countWords', () => {
  it('is 0 for empty and whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n\t ')).toBe(0);
  });
  it('does not count markdown syntax tokens', () => {
    expect(countWords('# Title here\n\n- one\n- two\n* three\n1. four\n> quote\n---')).toBe(7);
    expect(countWords('**bold** and _it_ and ==mark==')).toBe(5);
  });
  it('counts link text but not URLs', () => {
    expect(countWords('see [the docs](https://example.com/x) now')).toBe(4);
    expect(countWords('![alt text](img.png)')).toBe(2);
  });
  it('handles accented words', () => {
    expect(countWords('canción añadida rápidamente')).toBe(3);
  });
});

describe('countBytes', () => {
  it('counts utf-8 bytes', () => {
    expect(countBytes('')).toBe(0);
    expect(countBytes('añ€')).toBe(1 + 2 + 3);
  });
});

describe('countLines', () => {
  it('handles empty, trailing newline and plain', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });
});

describe('readingTime', () => {
  it('is <1 min below 200 words and ~N min otherwise', () => {
    expect(readingTime(0)).toBe('<1 min');
    expect(readingTime(199)).toBe('<1 min');
    expect(readingTime(200)).toBe('~1 min');
    expect(readingTime(650)).toBe('~3 min');
  });
});

describe('formatBytes', () => {
  it('formats human sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1229)).toBe('1.2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
