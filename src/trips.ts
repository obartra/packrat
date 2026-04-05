// Pure helpers for trips: naming, slugging, validation, staleness, dates.
// No DOM or Firestore access — all deps passed in as params.

import { MONTHS } from './constants';
import type { DurationUnit } from './types';

/** Lowercase, ASCII, dash-separated slug. Empty string if nothing survives. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TripSlugInput {
  destination: string;
  startMonth: number; // 0-11
  startYear: number;
  durationCount: number;
  durationUnit: DurationUnit;
}

/**
 * Build a trip doc ID from its defining fields.
 * Same input → same slug, so Firestore's existence check enforces uniqueness.
 * Example: { destination: "Italy", startMonth: 4, startYear: 2026, durationCount: 2, durationUnit: "weeks" }
 *        → "italy-may-2026-2-weeks"
 */
export function tripSlug(input: TripSlugInput): string {
  const parts: string[] = [];
  const dest = slugify(input.destination);
  if (dest) parts.push(dest);
  const monthAbbrev = monthAbbrev3(input.startMonth);
  if (monthAbbrev) parts.push(monthAbbrev);
  parts.push(String(input.startYear));
  parts.push(String(input.durationCount));
  parts.push(input.durationUnit);
  return parts.join('-');
}

/** 3-letter lowercased abbreviation for a month index; empty if out of range. */
function monthAbbrev3(m: number): string {
  if (m < 0 || m >= 12) return '';
  return (MONTHS[m] ?? '').toLowerCase().slice(0, 3);
}

// ============================================================
//  Date math: start-month + duration → spanned months
// ============================================================

/**
 * Convert a duration count + unit into an approximate day count.
 * Weeks = 7×, months = 30× (calendar-approximate is fine for monthly
 * climate aggregation and rainy-day fractions).
 */
export function durationToDays(count: number, unit: DurationUnit): number {
  if (count < 1) return 0;
  if (unit === 'days') return count;
  if (unit === 'weeks') return count * 7;
  return count * 30; // months
}

/**
 * Human-readable duration string. "2 weeks", "5 days", "1 month".
 * Count 1 uses singular unit; anything else uses plural.
 */
export function formatDuration(count: number, unit: DurationUnit): string {
  const n = Math.max(1, Math.floor(count));
  const singular = unit.replace(/s$/, '');
  return n === 1 ? `${n} ${singular}` : `${n} ${unit}`;
}

export interface SpanInput {
  startMonth: number; // 0-11
  startYear: number;
  durationCount: number;
  durationUnit: DurationUnit;
}

/**
 * Month indices (0-11) covered by a trip, starting at startMonth.
 * Uses 30-day-month and 7-day-week approximations. For durations ≥ 12
 * months, clamps to all 12 months. Deduplicated + sorted ascending.
 *
 * Examples:
 *   { startMonth: 4, count: 13, unit: 'days' }  → [4]        (13 days in May)
 *   { startMonth: 4, count: 6,  unit: 'weeks' } → [3, 4]     (42 days, overflows into Apr? No: starts May 1, runs 42d → May + early Jun)
 *   wait - starting May 1 + 42 days = [May, Jun]. Let me think again.
 *
 * Semantics: start at day 1 of startMonth. Each month is 30 days. So:
 *   - days 1-30  → startMonth
 *   - days 31-60 → startMonth + 1
 *   - etc.
 * Returns the distinct months touched.
 */
export function spannedMonths(input: SpanInput): number[] {
  const days = durationToDays(input.durationCount, input.durationUnit);
  if (days <= 0) return [];
  if (days >= 360) {
    // wraps the whole year
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }
  const monthsSpanned = Math.ceil(days / 30);
  const result: number[] = [];
  for (let i = 0; i < monthsSpanned; i++) {
    result.push((((input.startMonth + i) % 12) + 12) % 12);
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

// ============================================================
//  Month labels + display name
// ============================================================

/**
 * Human-readable month label for a set of month indices.
 * Single: "May". Contiguous range: "April–May". Non-contiguous: "Apr, Aug".
 *
 * Contiguity handles wrap-around: [10, 11, 0, 1] → "November–February".
 */
export function formatMonthsLabel(months: number[]): string {
  const valid = months.filter(m => m >= 0 && m < 12);
  if (!valid.length) return '';
  const uniq = [...new Set(valid)].sort((a, b) => a - b);
  if (uniq.length === 1) return MONTHS[uniq[0]!] ?? '';
  // Check for wrap-around contiguous span (e.g. [0, 1, 10, 11] = Nov–Feb).
  // A wrap-around span has a single "gap" of > 1 in the sorted list.
  const wrapSpan = detectWrapSpan(uniq);
  if (wrapSpan) {
    return `${MONTHS[wrapSpan.start]!}–${MONTHS[wrapSpan.end]!}`;
  }
  const contiguous = uniq.every((v, i) => i === 0 || v === uniq[i - 1]! + 1);
  if (contiguous) {
    return `${MONTHS[uniq[0]!]}–${MONTHS[uniq[uniq.length - 1]!]}`;
  }
  return uniq.map(i => MONTHS[i]?.slice(0, 3) ?? '').join(', ');
}

/**
 * Detects a wrap-around contiguous span in a sorted month-index list.
 * Returns the real start/end indices in month-of-year terms (not list order).
 * e.g. [0, 1, 10, 11] → { start: 10 (Nov), end: 1 (Feb) }
 */
function detectWrapSpan(sorted: number[]): { start: number; end: number } | null {
  if (sorted.length < 2) return null;
  // Find the single gap > 1 between adjacent entries (and wrap from last→first).
  // If exactly one such gap exists and all other adjacencies are +1, it's a wrap span.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]! - sorted[i - 1]!);
  }
  // wrap-around gap from last back to first
  const wrapGap = 12 - sorted[sorted.length - 1]! + sorted[0]!;
  const allGaps = [...gaps, wrapGap];
  const bigGaps = allGaps.filter(g => g > 1);
  if (bigGaps.length !== 1) return null;
  // The wrap gap is the "cut" — find where
  const wrapIdx = allGaps.indexOf(bigGaps[0]!);
  if (wrapIdx === gaps.length) {
    // wrap gap is between last and first (normal contiguous, not wrap)
    return null;
  }
  // wrap: season starts at sorted[wrapIdx+1], ends at sorted[wrapIdx]
  return { start: sorted[wrapIdx + 1]!, end: sorted[wrapIdx]! };
}

export interface TripNameInput {
  destination: string;
  startMonth: number;
  startYear: number;
  durationCount: number;
  durationUnit: DurationUnit;
}

/**
 * Default display name for a trip. e.g. "Italy — May 2026" or
 * "Japan — Apr–May 2027". Uses derived months based on duration.
 */
export function tripDisplayName(input: TripNameInput): string {
  const dest = input.destination.trim() || 'Trip';
  const months = spannedMonths(input);
  const monthsLabel = formatMonthsLabel(months);
  if (!monthsLabel) return `${dest} — ${input.startYear}`;
  return `${dest} — ${monthsLabel} ${input.startYear}`;
}

// ============================================================
//  Timestamps + staleness
// ============================================================

/**
 * Extract milliseconds from a Firestore Timestamp or similar duck-typed
 * value. Returns null for anything without a `.toMillis()` method (e.g.
 * unresolved FieldValue sentinels from serverTimestamp()).
 */
export function timestampMillis(v: unknown): number | null {
  if (v && typeof v === 'object' && 'toMillis' in v) {
    const fn = (v as { toMillis: unknown }).toMillis;
    if (typeof fn === 'function') {
      return (fn as () => number).call(v);
    }
  }
  return null;
}

/**
 * True when the trip inputs have been edited since AI was last generated.
 * Null on either side (e.g. unresolved serverTimestamp sentinel) is
 * treated as "can't tell, don't warn" — avoids a false-positive banner
 * flashing after save + auto-regenerate.
 */
export function isAIOutdated(updatedAtMs: number | null, aiGeneratedAtMs: number | null): boolean {
  if (updatedAtMs == null || aiGeneratedAtMs == null) return false;
  return updatedAtMs > aiGeneratedAtMs;
}

/**
 * Which `itemId`s in the AI packing list no longer exist in the current
 * inventory. Returns empty when there's no aiResult or packingList.
 */
export function staleItemIds(
  packingList: { itemId: string }[] | null | undefined,
  knownIds: Set<string>,
): string[] {
  if (!packingList) return [];
  return packingList.map(p => p.itemId).filter(id => !knownIds.has(id));
}

// ============================================================
//  Weather icon + formatting
// ============================================================

/** Emoji for a weather summary. Heavy rain takes precedence over temp. */
export function weatherEmoji(
  avgHigh: number | null,
  totalPrecip: number | null,
  rainyDays: number | null,
): string {
  if ((totalPrecip ?? 0) > 40 || (rainyDays ?? 0) > 10) return '🌧';
  if ((avgHigh ?? 0) >= 28) return '☀️';
  if ((avgHigh ?? 0) >= 18) return '⛅';
  return '🌥';
}

export type TemperatureUnit = 'celsius' | 'fahrenheit';

/**
 * Format a Celsius temperature as "24°" or "75°" based on preference.
 * Rounds to nearest integer. Returns "—" for null.
 */
export function formatTemp(celsius: number | null, unit: TemperatureUnit): string {
  if (celsius == null || !Number.isFinite(celsius)) return '—';
  const n = unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(n)}°`;
}

/**
 * "3/14 rainy (~21%)" — rainy days as a fraction of total trip days,
 * with the percentage for quick scanning. Returns "—" if either input
 * is missing or totalDays is 0.
 */
export function formatRainyDays(rainyDays: number | null, totalDays: number): string {
  if (rainyDays == null || totalDays <= 0) return '—';
  const r = Math.max(0, Math.min(totalDays, Math.round(rainyDays)));
  const pct = Math.round((r / totalDays) * 100);
  return `${r}/${totalDays} rainy (~${pct}%)`;
}

// ============================================================
//  Static map URLs
// ============================================================

/**
 * Build an OpenStreetMap embed URL centered on the given coordinates.
 * bbox padding is 0.4° each side (~40km), which gives a city-level view
 * that's still wide enough for country-level geocoder results.
 * Rounds to 4 decimals (~11m precision) to avoid float-math noise.
 */
export function staticMapUrl(lat: number, lon: number): string {
  const pad = 0.4;
  const round = (n: number): number => Math.round(n * 10000) / 10000;
  const bbox = [round(lon - pad), round(lat - pad), round(lon + pad), round(lat + pad)].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${lat},${lon}`;
}

/**
 * Convert lat/lon to OSM slippy-map tile coordinates at a given zoom.
 * Standard Web Mercator projection. Returns integer x,y.
 */
export function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  // Clamp to valid tile range (near poles produces out-of-range y).
  const clamped = Math.max(0, Math.min(n - 1, y));
  return { x: Math.max(0, Math.min(n - 1, x)), y: clamped };
}

/**
 * OSM static tile PNG URL. Used for small thumbnails on the trip list.
 * Zoom 5 gives a country-level view in a 64px square.
 */
export function mapTileUrl(lat: number, lon: number, zoom = 5): string {
  const { x, y } = latLonToTile(lat, lon, zoom);
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

// ============================================================
//  Trip sort comparator
// ============================================================

export interface TripSortable {
  startYear: number;
  startMonth: number;
}

/** Descending order: newer years first, then later months within a year. */
export function compareTripsDesc(a: TripSortable, b: TripSortable): number {
  if (a.startYear !== b.startYear) return b.startYear - a.startYear;
  return b.startMonth - a.startMonth;
}

// ============================================================
//  Wizard validation
// ============================================================

export interface TripDraftValidation {
  location: unknown;
  durationCount: number;
}

export type StepResult = { ok: true } | { ok: false; error: string };

/**
 * Gate for Next/Save button on each wizard step. Step 3 has no
 * required fields (can save without activities or notes).
 */
export function validateStep(step: 1 | 2 | 3, draft: TripDraftValidation): StepResult {
  if (step === 1) {
    if (!draft.location) return { ok: false, error: 'Pick a destination first' };
    return { ok: true };
  }
  if (step === 2) {
    if (!draft.durationCount || draft.durationCount < 1) {
      return { ok: false, error: 'Enter a duration' };
    }
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Clickable step-dot gate. Backward is always allowed; forward only if
 * every step strictly before the target validates. Returns the error
 * from the first blocking step (for toast display) when blocked.
 */
export function canJumpToStep(
  target: 1 | 2 | 3,
  current: 1 | 2 | 3,
  draft: TripDraftValidation,
): StepResult {
  if (target <= current) return { ok: true };
  for (let s = 1; s < target; s++) {
    const result = validateStep(s as 1 | 2 | 3, draft);
    if (!result.ok) return result;
  }
  return { ok: true };
}

// ============================================================
//  Draft snapshot / dirty check
// ============================================================

export interface TripDraftSnapshot {
  destination: string;
  location: unknown;
  startMonth: number;
  startYear: number;
  durationCount: number;
  durationUnit: DurationUnit;
  activities: string[];
  notes: string;
  candidateItemIds: string[];
  name: string;
}

/**
 * Canonicalize a wizard draft into a JSON string for equality comparison.
 * Orders arrays + trims strings so incidental edits don't register as
 * dirty (e.g. reordering candidate selections or trailing whitespace).
 */
export function snapshotDraft(d: TripDraftSnapshot): string {
  return JSON.stringify({
    destination: d.destination.trim(),
    location: d.location,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
    activities: [...d.activities].sort(),
    notes: d.notes,
    candidateItemIds: [...d.candidateItemIds].sort(),
    name: d.name,
  });
}

// ============================================================
//  Legacy migration (v1 → v2 trips)
// ============================================================

/**
 * Parse a legacy free-text duration string into (count, unit).
 * "2 weeks" → {count: 2, unit: 'weeks'}. Unparseable → 7 days.
 */
export function parseDurationString(s: string): {
  durationCount: number;
  durationUnit: DurationUnit;
} {
  const m = s
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(day|week|month)s?$/);
  if (!m) return { durationCount: 7, durationUnit: 'days' };
  const count = parseInt(m[1]!, 10);
  const unit = (m[2]! + 's') as DurationUnit;
  return { durationCount: Math.max(1, count), durationUnit: unit };
}
