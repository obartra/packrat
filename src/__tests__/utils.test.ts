import { describe, it, expect } from 'vitest';
import { esc, sortOrderMidpoint } from '../utils';

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands before other entities', () => {
    expect(esc('A & B')).toBe('A &amp; B');
  });

  it('escapes double quotes for attribute contexts', () => {
    expect(esc('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('returns empty string for null and undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(esc(42)).toBe('42');
    expect(esc(true)).toBe('true');
  });

  it('is idempotent for plain text', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('handles all special chars together', () => {
    expect(esc('<a href="x">&nbsp;</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;nbsp;&lt;/a&gt;');
  });
});

describe('sortOrderMidpoint', () => {
  it('returns 1000 when both neighbors are null (first entry)', () => {
    expect(sortOrderMidpoint(null, null)).toBe(1000);
  });

  it('returns prev + 1000 when appending to end', () => {
    expect(sortOrderMidpoint(5000, null)).toBe(6000);
  });

  it('returns next - 1000 when inserting at start', () => {
    expect(sortOrderMidpoint(null, 3000)).toBe(2000);
  });

  it('returns midpoint between two neighbors', () => {
    expect(sortOrderMidpoint(1000, 2000)).toBe(1500);
  });

  it('handles tight spacing with fractional midpoint', () => {
    expect(sortOrderMidpoint(1000, 1001)).toBe(1000.5);
  });

  it('preserves ordering semantically', () => {
    const a = 1000;
    const c = 2000;
    const b = sortOrderMidpoint(a, c);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(c);
  });
});
