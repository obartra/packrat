import { describe, it, expect } from 'vitest';
import {
  slugify,
  tripSlug,
  tripDisplayName,
  formatMonthsLabel,
  timestampMillis,
  isAIOutdated,
  staleItemIds,
  weatherEmoji,
  staticMapUrl,
  compareTripsDesc,
  validateStep,
  canJumpToStep,
  snapshotDraft,
  spannedMonths,
  durationToDays,
  formatDuration,
  formatTemp,
  formatRainyDays,
  mapTileUrl,
  latLonToTile,
  parseDurationString,
} from '../trips';

describe('slugify', () => {
  it('lowercases, replaces non-alphanumeric with dashes', () => {
    expect(slugify('Cozumel, Mexico')).toBe('cozumel-mexico');
  });

  it('strips accents', () => {
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('Zürich')).toBe('zurich');
    expect(slugify('Córdoba')).toBe('cordoba');
  });

  it('collapses repeated separators', () => {
    expect(slugify('a   b___c!!!d')).toBe('a-b-c-d');
  });

  it('trims leading/trailing dashes', () => {
    expect(slugify('...hello...')).toBe('hello');
    expect(slugify('---x---')).toBe('x');
  });

  it('returns empty string for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});

describe('tripSlug', () => {
  it('composes a slug from destination, start month, year, duration', () => {
    expect(
      tripSlug({
        destination: 'Italy',
        startMonth: 4,
        startYear: 2026,
        durationCount: 2,
        durationUnit: 'weeks',
      }),
    ).toBe('italy-may-2026-2-weeks');
  });

  it('uses day units', () => {
    expect(
      tripSlug({
        destination: 'Cozumel',
        startMonth: 11,
        startYear: 2026,
        durationCount: 5,
        durationUnit: 'days',
      }),
    ).toBe('cozumel-dec-2026-5-days');
  });

  it('uses month units', () => {
    expect(
      tripSlug({
        destination: 'NZ',
        startMonth: 10,
        startYear: 2026,
        durationCount: 4,
        durationUnit: 'months',
      }),
    ).toBe('nz-nov-2026-4-months');
  });

  it('omits destination segment when blank but keeps rest', () => {
    expect(
      tripSlug({
        destination: '',
        startMonth: 0,
        startYear: 2026,
        durationCount: 5,
        durationUnit: 'days',
      }),
    ).toBe('jan-2026-5-days');
  });

  it('same inputs → same slug (uniqueness mechanic)', () => {
    const input = {
      destination: 'Italy',
      startMonth: 4,
      startYear: 2026,
      durationCount: 2,
      durationUnit: 'weeks' as const,
    };
    expect(tripSlug(input)).toBe(tripSlug(input));
  });

  it('different duration counts produce different slugs', () => {
    const base = {
      destination: 'Italy',
      startMonth: 4,
      startYear: 2026,
      durationUnit: 'weeks' as const,
    };
    expect(tripSlug({ ...base, durationCount: 1 })).not.toBe(
      tripSlug({ ...base, durationCount: 2 }),
    );
  });
});

describe('durationToDays', () => {
  it('days passes through', () => {
    expect(durationToDays(5, 'days')).toBe(5);
  });
  it('weeks × 7', () => {
    expect(durationToDays(2, 'weeks')).toBe(14);
  });
  it('months × 30', () => {
    expect(durationToDays(3, 'months')).toBe(90);
  });
  it('clamps count < 1 to 0', () => {
    expect(durationToDays(0, 'days')).toBe(0);
    expect(durationToDays(-5, 'weeks')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('singularizes count 1', () => {
    expect(formatDuration(1, 'days')).toBe('1 day');
    expect(formatDuration(1, 'weeks')).toBe('1 week');
    expect(formatDuration(1, 'months')).toBe('1 month');
  });
  it('uses plural for count > 1', () => {
    expect(formatDuration(2, 'days')).toBe('2 days');
    expect(formatDuration(3, 'weeks')).toBe('3 weeks');
    expect(formatDuration(4, 'months')).toBe('4 months');
  });
  it('clamps to at least 1', () => {
    expect(formatDuration(0, 'days')).toBe('1 day');
  });
});

describe('spannedMonths', () => {
  it('single month for a short trip within one month', () => {
    expect(
      spannedMonths({ startMonth: 4, startYear: 2026, durationCount: 13, durationUnit: 'days' }),
    ).toEqual([4]);
  });

  it('covers start + next month for 6-week trip', () => {
    // 6*7 = 42 days → ceil(42/30) = 2 months
    expect(
      spannedMonths({ startMonth: 3, startYear: 2026, durationCount: 6, durationUnit: 'weeks' }),
    ).toEqual([3, 4]);
  });

  it('wraps across year boundary', () => {
    // 4 months starting Nov → Nov, Dec, Jan, Feb
    expect(
      spannedMonths({ startMonth: 10, startYear: 2026, durationCount: 4, durationUnit: 'months' }),
    ).toEqual([0, 1, 10, 11]);
  });

  it('clamps to all 12 months for year-long trips', () => {
    expect(
      spannedMonths({ startMonth: 0, startYear: 2026, durationCount: 12, durationUnit: 'months' }),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('returns empty for zero duration', () => {
    expect(
      spannedMonths({ startMonth: 4, startYear: 2026, durationCount: 0, durationUnit: 'days' }),
    ).toEqual([]);
  });
});

describe('formatMonthsLabel', () => {
  it('returns empty string for empty input', () => {
    expect(formatMonthsLabel([])).toBe('');
  });

  it('returns full month name for single month', () => {
    expect(formatMonthsLabel([4])).toBe('May');
  });

  it('uses a dash for contiguous ranges', () => {
    expect(formatMonthsLabel([5, 6, 7])).toBe('June–August');
  });

  it('handles wrap-around spans (Nov–Feb)', () => {
    expect(formatMonthsLabel([0, 1, 10, 11])).toBe('November–February');
  });

  it('uses short names comma-separated for non-contiguous', () => {
    expect(formatMonthsLabel([1, 4, 9])).toBe('Feb, May, Oct');
  });

  it('sorts input before formatting', () => {
    expect(formatMonthsLabel([7, 5, 6])).toBe('June–August');
  });

  it('filters out invalid month indices', () => {
    expect(formatMonthsLabel([-1, 12, 4])).toBe('May');
  });
});

describe('tripDisplayName', () => {
  it('combines destination, derived months label, and start year', () => {
    expect(
      tripDisplayName({
        destination: 'Italy',
        startMonth: 4,
        startYear: 2026,
        durationCount: 13,
        durationUnit: 'days',
      }),
    ).toBe('Italy — May 2026');
  });

  it('shows multi-month ranges for longer trips', () => {
    // 6 weeks = 42 days starting Apr → Apr, May
    expect(
      tripDisplayName({
        destination: 'Japan',
        startMonth: 3,
        startYear: 2027,
        durationCount: 6,
        durationUnit: 'weeks',
      }),
    ).toBe('Japan — April–May 2027');
  });

  it('handles wrap-around spans', () => {
    expect(
      tripDisplayName({
        destination: 'NZ',
        startMonth: 10,
        startYear: 2026,
        durationCount: 4,
        durationUnit: 'months',
      }),
    ).toBe('NZ — November–February 2026');
  });

  it('falls back to "Trip" when destination is empty', () => {
    expect(
      tripDisplayName({
        destination: '',
        startMonth: 0,
        startYear: 2026,
        durationCount: 5,
        durationUnit: 'days',
      }),
    ).toBe('Trip — January 2026');
  });

  it('trims destination whitespace', () => {
    expect(
      tripDisplayName({
        destination: '  Rome  ',
        startMonth: 4,
        startYear: 2026,
        durationCount: 14,
        durationUnit: 'days',
      }),
    ).toBe('Rome — May 2026');
  });
});

describe('timestampMillis', () => {
  it('reads millis from a Firestore-Timestamp-like object', () => {
    expect(timestampMillis({ toMillis: () => 12345 })).toBe(12345);
  });

  it('returns null for a FieldValue sentinel (no toMillis method)', () => {
    expect(timestampMillis({ _methodName: 'serverTimestamp' })).toBeNull();
  });

  it('returns null for null / undefined / primitives', () => {
    expect(timestampMillis(null)).toBeNull();
    expect(timestampMillis(undefined)).toBeNull();
    expect(timestampMillis(0)).toBeNull();
    expect(timestampMillis('2026-01-01')).toBeNull();
  });

  it('returns null when toMillis is a property but not a function', () => {
    expect(timestampMillis({ toMillis: 123 })).toBeNull();
  });

  it('binds `this` correctly when calling toMillis', () => {
    const obj = {
      _ms: 999,
      toMillis(this: { _ms: number }) {
        return this._ms;
      },
    };
    expect(timestampMillis(obj)).toBe(999);
  });
});

describe('isAIOutdated', () => {
  it('returns false when either timestamp is null', () => {
    expect(isAIOutdated(null, null)).toBe(false);
    expect(isAIOutdated(1000, null)).toBe(false);
    expect(isAIOutdated(null, 1000)).toBe(false);
  });

  it('returns true when updatedAt is after aiGeneratedAt', () => {
    expect(isAIOutdated(2000, 1000)).toBe(true);
  });

  it('returns false when updatedAt equals aiGeneratedAt', () => {
    expect(isAIOutdated(1000, 1000)).toBe(false);
  });

  it('returns false when aiGeneratedAt is after updatedAt (fresh AI)', () => {
    expect(isAIOutdated(1000, 2000)).toBe(false);
  });

  it('handles zero as a valid timestamp, not a sentinel', () => {
    expect(isAIOutdated(0, 0)).toBe(false);
    expect(isAIOutdated(1, 0)).toBe(true);
  });

  it('null timestamp skips the "outdated" warning (regression: FieldValue sentinel)', () => {
    expect(isAIOutdated(1_700_000_000_000, null)).toBe(false);
    expect(isAIOutdated(null, 1_700_000_000_000)).toBe(false);
  });
});

describe('staleItemIds', () => {
  const known = new Set(['a', 'b', 'c']);

  it('returns empty array when packingList is null/undefined', () => {
    expect(staleItemIds(null, known)).toEqual([]);
    expect(staleItemIds(undefined, known)).toEqual([]);
  });

  it('returns empty array when packingList is empty', () => {
    expect(staleItemIds([], known)).toEqual([]);
  });

  it('returns empty array when all items still exist', () => {
    expect(staleItemIds([{ itemId: 'a' }, { itemId: 'b' }], known)).toEqual([]);
  });

  it('returns all itemIds when none exist', () => {
    expect(staleItemIds([{ itemId: 'x' }, { itemId: 'y' }], known)).toEqual(['x', 'y']);
  });

  it('returns only the missing itemIds for a partial mix', () => {
    expect(staleItemIds([{ itemId: 'a' }, { itemId: 'ghost' }, { itemId: 'c' }], known)).toEqual([
      'ghost',
    ]);
  });
});

describe('weatherEmoji', () => {
  it('returns 🌧 when precip > 40mm', () => {
    expect(weatherEmoji(25, 41, 2)).toBe('🌧');
  });

  it('returns 🌧 when rainyDays > 10', () => {
    expect(weatherEmoji(25, 0, 11)).toBe('🌧');
  });

  it('returns ☀️ when avgHigh >= 28 and not rainy', () => {
    expect(weatherEmoji(28, 10, 2)).toBe('☀️');
    expect(weatherEmoji(35, 0, 0)).toBe('☀️');
  });

  it('returns ⛅ when avgHigh >= 18 and not rainy or hot', () => {
    expect(weatherEmoji(18, 10, 2)).toBe('⛅');
    expect(weatherEmoji(27, 0, 0)).toBe('⛅');
  });

  it('returns 🌥 for cold weather', () => {
    expect(weatherEmoji(5, 10, 2)).toBe('🌥');
    expect(weatherEmoji(17, 0, 0)).toBe('🌥');
  });

  it('treats nulls as safe defaults (0s) for temp/rainy', () => {
    expect(weatherEmoji(null, null, null)).toBe('🌥');
  });

  it('rain threshold is strictly greater than (boundary)', () => {
    expect(weatherEmoji(25, 40, 0)).toBe('⛅');
    expect(weatherEmoji(25, 41, 0)).toBe('🌧');
    expect(weatherEmoji(25, 0, 10)).toBe('⛅');
    expect(weatherEmoji(25, 0, 11)).toBe('🌧');
  });
});

describe('formatTemp', () => {
  it('formats celsius as "N°"', () => {
    expect(formatTemp(24, 'celsius')).toBe('24°');
    expect(formatTemp(0, 'celsius')).toBe('0°');
    expect(formatTemp(-5, 'celsius')).toBe('-5°');
  });
  it('converts to fahrenheit and rounds', () => {
    expect(formatTemp(0, 'fahrenheit')).toBe('32°');
    expect(formatTemp(100, 'fahrenheit')).toBe('212°');
    expect(formatTemp(24, 'fahrenheit')).toBe('75°');
  });
  it('rounds to nearest integer', () => {
    expect(formatTemp(24.4, 'celsius')).toBe('24°');
    expect(formatTemp(24.6, 'celsius')).toBe('25°');
  });
  it('handles null as em-dash', () => {
    expect(formatTemp(null, 'celsius')).toBe('—');
    expect(formatTemp(null, 'fahrenheit')).toBe('—');
  });
  it('handles non-finite as em-dash', () => {
    expect(formatTemp(NaN, 'celsius')).toBe('—');
    expect(formatTemp(Infinity, 'celsius')).toBe('—');
  });
});

describe('formatRainyDays', () => {
  it('formats fraction + percent', () => {
    expect(formatRainyDays(3, 14)).toBe('3/14 rainy (~21%)');
    expect(formatRainyDays(8, 14)).toBe('8/14 rainy (~57%)');
    expect(formatRainyDays(0, 7)).toBe('0/7 rainy (~0%)');
  });
  it('rounds rainy days to integer', () => {
    expect(formatRainyDays(2.5, 14)).toBe('3/14 rainy (~21%)');
  });
  it('clamps rainyDays to [0, totalDays]', () => {
    expect(formatRainyDays(20, 14)).toBe('14/14 rainy (~100%)');
    expect(formatRainyDays(-5, 14)).toBe('0/14 rainy (~0%)');
  });
  it('handles null and zero days', () => {
    expect(formatRainyDays(null, 14)).toBe('—');
    expect(formatRainyDays(3, 0)).toBe('—');
  });
});

describe('staticMapUrl', () => {
  it('builds an OSM embed URL with bbox + marker for positive coords', () => {
    const url = staticMapUrl(41.9, 12.5);
    expect(url).toContain('openstreetmap.org/export/embed.html');
    expect(url).toContain('bbox=12.1,41.5,12.9,42.3');
    expect(url).toContain('marker=41.9,12.5');
  });

  it('handles negative longitude (western hemisphere)', () => {
    const url = staticMapUrl(20.5, -86.95);
    expect(url).toContain('bbox=-87.35,20.1,-86.55,20.9');
    expect(url).toContain('marker=20.5,-86.95');
  });

  it('handles negative latitude (southern hemisphere)', () => {
    const url = staticMapUrl(-23, -46);
    expect(url).toContain('bbox=-46.4,-23.4,-45.6,-22.6');
    expect(url).toContain('marker=-23,-46');
  });

  it('handles 0,0 origin', () => {
    const url = staticMapUrl(0, 0);
    expect(url).toContain('bbox=-0.4,-0.4,0.4,0.4');
    expect(url).toContain('marker=0,0');
  });
});

describe('latLonToTile + mapTileUrl', () => {
  it('converts equator/prime-meridian to center tile at zoom 5', () => {
    // zoom 5 = 2^5 = 32 tiles. center is (16, 16) at (0,0).
    const { x, y } = latLonToTile(0, 0, 5);
    expect(x).toBe(16);
    expect(y).toBe(16);
  });

  it('western hemisphere has x < half', () => {
    const { x } = latLonToTile(40, -74, 5); // NYC
    expect(x).toBeLessThan(16);
  });

  it('eastern hemisphere has x > half', () => {
    const { x } = latLonToTile(35, 139, 5); // Tokyo
    expect(x).toBeGreaterThan(16);
  });

  it('mapTileUrl produces a valid OSM tile URL', () => {
    const url = mapTileUrl(41.9, 12.5, 5);
    expect(url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/5\/\d+\/\d+\.png$/);
  });

  it('mapTileUrl defaults to zoom 5', () => {
    expect(mapTileUrl(0, 0)).toBe(mapTileUrl(0, 0, 5));
  });

  it('clamps to valid tile range near poles', () => {
    const { x, y } = latLonToTile(89, 0, 5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(32);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(32);
  });
});

describe('compareTripsDesc', () => {
  it('sorts newer years first', () => {
    expect(
      compareTripsDesc({ startYear: 2027, startMonth: 0 }, { startYear: 2026, startMonth: 0 }),
    ).toBeLessThan(0);
    expect(
      compareTripsDesc({ startYear: 2026, startMonth: 0 }, { startYear: 2027, startMonth: 0 }),
    ).toBeGreaterThan(0);
  });

  it('within the same year, sorts later months first', () => {
    expect(
      compareTripsDesc({ startYear: 2026, startMonth: 11 }, { startYear: 2026, startMonth: 0 }),
    ).toBeLessThan(0);
  });

  it('returns 0 for same year + same start month', () => {
    expect(
      compareTripsDesc({ startYear: 2026, startMonth: 5 }, { startYear: 2026, startMonth: 5 }),
    ).toBe(0);
  });
});

describe('validateStep', () => {
  const okDraft = {
    location: { name: 'Rome' },
    durationCount: 14,
  };

  it('step 1 requires a resolved location', () => {
    expect(validateStep(1, { ...okDraft, location: null })).toEqual({
      ok: false,
      error: 'Pick a destination first',
    });
  });

  it('step 1 passes when location is set', () => {
    expect(validateStep(1, okDraft)).toEqual({ ok: true });
  });

  it('step 2 requires durationCount >= 1', () => {
    expect(validateStep(2, { ...okDraft, durationCount: 0 })).toEqual({
      ok: false,
      error: 'Enter a duration',
    });
  });

  it('step 2 passes with positive duration (location not required)', () => {
    expect(validateStep(2, okDraft)).toEqual({ ok: true });
    expect(validateStep(2, { ...okDraft, location: null })).toEqual({ ok: true });
  });

  it('step 3 has no validation', () => {
    expect(validateStep(3, { location: null, durationCount: 0 })).toEqual({ ok: true });
  });
});

describe('canJumpToStep', () => {
  const good = { location: { name: 'Rome' }, durationCount: 14 };
  const noLoc = { location: null, durationCount: 14 };

  it('backward is always allowed', () => {
    expect(canJumpToStep(1, 3, noLoc)).toEqual({ ok: true });
    expect(canJumpToStep(2, 3, noLoc)).toEqual({ ok: true });
  });

  it('same step is allowed (no-op)', () => {
    expect(canJumpToStep(2, 2, noLoc)).toEqual({ ok: true });
  });

  it('forward requires all intermediate steps to validate', () => {
    expect(canJumpToStep(3, 1, good)).toEqual({ ok: true });
  });

  it('forward blocked by first failing step (returns that error)', () => {
    expect(canJumpToStep(3, 1, noLoc)).toEqual({
      ok: false,
      error: 'Pick a destination first',
    });
  });

  it('forward blocked by step 2 when step 1 passes', () => {
    expect(canJumpToStep(3, 1, { ...good, durationCount: 0 })).toEqual({
      ok: false,
      error: 'Enter a duration',
    });
  });
});

describe('snapshotDraft', () => {
  const base = {
    destination: 'Italy',
    location: { name: 'Rome', latitude: 41.9, longitude: 12.5 },
    startMonth: 4,
    startYear: 2026,
    durationCount: 2,
    durationUnit: 'weeks' as const,
    activities: ['City', 'Formal'],
    notes: 'Wedding',
    candidateItemIds: ['a', 'b', 'c'],
    name: 'Italy — May 2026',
  };

  it('round-trips identical drafts to the same snapshot', () => {
    expect(snapshotDraft(base)).toBe(snapshotDraft(base));
  });

  it('is insensitive to activities array order', () => {
    expect(snapshotDraft({ ...base, activities: ['City', 'Formal'] })).toBe(
      snapshotDraft({ ...base, activities: ['Formal', 'City'] }),
    );
  });

  it('is insensitive to candidateItemIds order', () => {
    expect(snapshotDraft({ ...base, candidateItemIds: ['a', 'b', 'c'] })).toBe(
      snapshotDraft({ ...base, candidateItemIds: ['c', 'a', 'b'] }),
    );
  });

  it('trims destination whitespace', () => {
    expect(snapshotDraft(base)).toBe(snapshotDraft({ ...base, destination: '  Italy  ' }));
  });

  it('detects a change in any meaningful field', () => {
    const s0 = snapshotDraft(base);
    expect(s0).not.toBe(snapshotDraft({ ...base, destination: 'Japan' }));
    expect(s0).not.toBe(snapshotDraft({ ...base, startYear: 2027 }));
    expect(s0).not.toBe(snapshotDraft({ ...base, startMonth: 5 }));
    expect(s0).not.toBe(snapshotDraft({ ...base, durationCount: 3 }));
    expect(s0).not.toBe(snapshotDraft({ ...base, durationUnit: 'days' }));
    expect(s0).not.toBe(snapshotDraft({ ...base, notes: 'Different' }));
    expect(s0).not.toBe(snapshotDraft({ ...base, name: 'Different name' }));
    expect(s0).not.toBe(snapshotDraft({ ...base, activities: ['City', 'Formal', 'Business'] }));
    expect(s0).not.toBe(snapshotDraft({ ...base, candidateItemIds: ['a', 'b'] }));
  });
});

describe('parseDurationString', () => {
  it('parses "2 weeks"', () => {
    expect(parseDurationString('2 weeks')).toEqual({ durationCount: 2, durationUnit: 'weeks' });
  });
  it('parses "5 days"', () => {
    expect(parseDurationString('5 days')).toEqual({ durationCount: 5, durationUnit: 'days' });
  });
  it('parses "1 month"', () => {
    expect(parseDurationString('1 month')).toEqual({ durationCount: 1, durationUnit: 'months' });
  });
  it('parses singular forms', () => {
    expect(parseDurationString('1 week')).toEqual({ durationCount: 1, durationUnit: 'weeks' });
    expect(parseDurationString('1 day')).toEqual({ durationCount: 1, durationUnit: 'days' });
  });
  it('is case-insensitive and trims whitespace', () => {
    expect(parseDurationString('  3 WEEKS  ')).toEqual({
      durationCount: 3,
      durationUnit: 'weeks',
    });
  });
  it('defaults to 7 days for unparseable input', () => {
    expect(parseDurationString('')).toEqual({ durationCount: 7, durationUnit: 'days' });
    expect(parseDurationString('a while')).toEqual({ durationCount: 7, durationUnit: 'days' });
    expect(parseDurationString('2 fortnights')).toEqual({ durationCount: 7, durationUnit: 'days' });
  });
  it('clamps count to at least 1', () => {
    expect(parseDurationString('0 days')).toEqual({ durationCount: 1, durationUnit: 'days' });
  });
});
