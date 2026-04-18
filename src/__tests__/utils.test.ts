import { describe, it, expect } from 'vitest';
import { esc, sortOrderMidpoint, hexToBucket, COLOR_BUCKETS } from '../utils';

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

describe('hexToBucket', () => {
  it('returns null for invalid hex', () => {
    expect(hexToBucket('')).toBeNull();
    expect(hexToBucket('not-a-color')).toBeNull();
    expect(hexToBucket('#GG0000')).toBeNull();
  });

  it('maps pure black', () => {
    expect(hexToBucket('#000000')).toBe('black');
    expect(hexToBucket('#0A0A0A')).toBe('black');
    expect(hexToBucket('#111111')).toBe('black');
  });

  it('maps pure white', () => {
    expect(hexToBucket('#FFFFFF')).toBe('white');
    expect(hexToBucket('#F5F5F5')).toBe('white');
  });

  it('maps grays (low saturation, medium lightness)', () => {
    expect(hexToBucket('#808080')).toBe('gray');
    expect(hexToBucket('#A0A0A0')).toBe('gray');
    expect(hexToBucket('#555555')).toBe('gray');
  });

  it('maps reds', () => {
    expect(hexToBucket('#FF0000')).toBe('red');
    expect(hexToBucket('#DC2626')).toBe('red');
    expect(hexToBucket('#B91C1C')).toBe('red');
  });

  it('maps oranges', () => {
    expect(hexToBucket('#FF8C00')).toBe('orange');
    expect(hexToBucket('#EA580C')).toBe('orange');
  });

  it('maps yellows', () => {
    expect(hexToBucket('#FFD700')).toBe('yellow');
    expect(hexToBucket('#EAB308')).toBe('yellow');
  });

  it('maps greens', () => {
    expect(hexToBucket('#00FF00')).toBe('green');
    expect(hexToBucket('#16A34A')).toBe('green');
    expect(hexToBucket('#166534')).toBe('green');
  });

  it('maps blues', () => {
    expect(hexToBucket('#0000FF')).toBe('blue');
    expect(hexToBucket('#2563EB')).toBe('blue');
    expect(hexToBucket('#1E3A8A')).toBe('blue');
    expect(hexToBucket('#06B6D4')).toBe('blue');
  });

  it('maps purples', () => {
    expect(hexToBucket('#7C3AED')).toBe('purple');
    expect(hexToBucket('#6B21A8')).toBe('purple');
  });

  it('maps pinks', () => {
    expect(hexToBucket('#EC4899')).toBe('pink');
    expect(hexToBucket('#DB2777')).toBe('pink');
    expect(hexToBucket('#FF69B4')).toBe('pink');
  });

  it('maps browns (warm, low saturation, dark)', () => {
    expect(hexToBucket('#78350F')).toBe('brown');
    expect(hexToBucket('#92400E')).toBe('brown');
  });

  it('every COLOR_BUCKETS swatch maps to its own bucket', () => {
    for (const [name, swatch] of COLOR_BUCKETS) {
      expect(hexToBucket(swatch), `swatch ${swatch} should map to "${name}"`).toBe(name);
    }
  });

  it('handles lowercase hex', () => {
    expect(hexToBucket('#ff0000')).toBe('red');
    expect(hexToBucket('#00ff00')).toBe('green');
  });
});
