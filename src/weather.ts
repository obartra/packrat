import type { TripWeatherData, MonthlyClimate } from './types';
import { MONTHS } from './constants';

// Open-Meteo geocoding response shape (subset).
export interface GeoLocation {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

// Open-Meteo archive API daily response (subset).
export interface DailyClimate {
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  cloud_cover_mean?: number[];
  relative_humidity_2m_mean?: number[];
}

export interface ClimateAggregate {
  avgHigh: number | null;
  avgLow: number | null;
  totalPrecip: number | null;
  rainyDays: number | null;
  cloudCoverPct: number | null;
  humidityPct: number | null;
}

/** Mean of an array rounded to nearest integer; null for empty arrays. */
function meanRounded(values: number[] | undefined): number | null {
  if (!values || !values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Sum of an array rounded to nearest integer; null for empty arrays. */
function sumRounded(values: number[] | undefined): number | null {
  if (!values || !values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0));
}

/** Count of days with precipitation above threshold (default 1mm). Null for empty/missing. */
function countRainyDays(values: number[] | undefined, threshold = 1): number | null {
  if (!values || !values.length) return null;
  return values.filter(d => d > threshold).length;
}

/**
 * Aggregate daily climate data into trip-planning summary stats.
 */
export function aggregateClimate(daily: DailyClimate | undefined): ClimateAggregate {
  return {
    avgHigh: meanRounded(daily?.temperature_2m_max),
    avgLow: meanRounded(daily?.temperature_2m_min),
    totalPrecip: sumRounded(daily?.precipitation_sum),
    rainyDays: countRainyDays(daily?.precipitation_sum),
    cloudCoverPct: meanRounded(daily?.cloud_cover_mean),
    humidityPct: meanRounded(daily?.relative_humidity_2m_mean),
  };
}

/**
 * Compute the date range for a given month of the previous year (used as
 * historical climate reference for the trip).
 */
export function monthDateRange(
  monthIdx: number,
  referenceYear = new Date().getFullYear() - 1,
): { startDate: string; endDate: string } {
  const startDate = `${referenceYear}-${String(monthIdx + 1).padStart(2, '0')}-01`;
  const endDate = new Date(referenceYear, monthIdx + 1, 0).toISOString().slice(0, 10);
  return { startDate, endDate };
}

/**
 * Fetch historical climate from Open-Meteo's archive API for a given
 * location + month, and return a TripWeatherData summary.
 */
export async function fetchTripWeather(
  loc: GeoLocation,
  monthIdx: number,
): Promise<TripWeatherData> {
  const { startDate, endDate } = monthDateRange(monthIdx);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,cloud_cover_mean,relative_humidity_2m_mean&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  const agg = aggregateClimate(data?.daily);
  // Count days in the month for totalDays.
  const totalDays =
    (data?.daily?.temperature_2m_max as unknown[] | undefined)?.length ??
    new Date(new Date().getFullYear() - 1, monthIdx + 1, 0).getDate();
  return {
    place: loc.name,
    country: loc.country,
    monthName: MONTHS[monthIdx] ?? '',
    ...agg,
    totalDays,
  };
}

/**
 * Geocode a destination string to a single best-match location via Open-Meteo.
 * Throws if no location is found.
 */
export async function geocode(destination: string, signal?: AbortSignal): Promise<GeoLocation> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(destination)}&count=1&language=en&format=json`;
  const res = await fetch(url, signal ? { signal } : undefined);
  const data = await res.json();
  const loc = data?.results?.[0] as GeoLocation | undefined;
  if (!loc) throw new Error(`Could not find location: "${destination}"`);
  return loc;
}

/**
 * Fetch a full year of daily climate for a location, returning per-month
 * aggregates. One archive API call for the whole year.
 */
export async function fetchYearClimate(
  loc: GeoLocation,
  referenceYear = new Date().getFullYear() - 1,
  signal?: AbortSignal,
): Promise<MonthlyClimate[]> {
  const start = `${referenceYear}-01-01`;
  const end = `${referenceYear}-12-31`;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,cloud_cover_mean,relative_humidity_2m_mean&timezone=auto`;
  const res = await fetch(url, signal ? { signal } : undefined);
  const data = await res.json();
  const daily = data?.daily as
    | {
        time?: string[];
        temperature_2m_max?: (number | null)[];
        temperature_2m_min?: (number | null)[];
        precipitation_sum?: (number | null)[];
        cloud_cover_mean?: (number | null)[];
        relative_humidity_2m_mean?: (number | null)[];
      }
    | undefined;

  // Bucket each day into its month index (0-11).
  const bucketsMax: number[][] = Array.from({ length: 12 }, () => []);
  const bucketsMin: number[][] = Array.from({ length: 12 }, () => []);
  const bucketsPrecip: number[][] = Array.from({ length: 12 }, () => []);
  const bucketsCloud: number[][] = Array.from({ length: 12 }, () => []);
  const bucketsHumidity: number[][] = Array.from({ length: 12 }, () => []);
  (daily?.time ?? []).forEach((dateStr, i) => {
    const mo = new Date(dateStr).getMonth();
    const max = daily?.temperature_2m_max?.[i];
    const min = daily?.temperature_2m_min?.[i];
    const precip = daily?.precipitation_sum?.[i];
    const cloud = daily?.cloud_cover_mean?.[i];
    const hum = daily?.relative_humidity_2m_mean?.[i];
    if (max != null) bucketsMax[mo]!.push(max);
    if (min != null) bucketsMin[mo]!.push(min);
    if (precip != null) bucketsPrecip[mo]!.push(precip);
    if (cloud != null) bucketsCloud[mo]!.push(cloud);
    if (hum != null) bucketsHumidity[mo]!.push(hum);
  });

  const mean = (arr: number[]): number | null =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const sum = (arr: number[]): number | null =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0)) : null;
  const rainy = (arr: number[]): number | null =>
    arr.length ? arr.filter(d => d > 1).length : null;

  return Array.from({ length: 12 }, (_, i) => ({
    monthIdx: i,
    monthName: MONTHS[i] ?? '',
    avgHigh: mean(bucketsMax[i]!),
    avgLow: mean(bucketsMin[i]!),
    totalPrecip: sum(bucketsPrecip[i]!),
    rainyDays: rainy(bucketsPrecip[i]!),
    cloudCoverPct: mean(bucketsCloud[i]!),
    humidityPct: mean(bucketsHumidity[i]!),
  }));
}

/**
 * Aggregate selected months from a year-round climate into one summary.
 * Means are averaged across months; precip/rainyDays are summed.
 * Caller adds place/country to form a full TripWeatherData.
 */
export function aggregateMonths(
  climates: MonthlyClimate[],
  monthIndices: number[],
  totalDays = 0,
): Omit<TripWeatherData, 'place' | 'country'> {
  const selected = climates.filter(c => monthIndices.includes(c.monthIdx));
  if (!selected.length) {
    return {
      monthName: '',
      avgHigh: null,
      avgLow: null,
      totalPrecip: null,
      rainyDays: null,
      cloudCoverPct: null,
      humidityPct: null,
      totalDays,
    };
  }
  const highs = selected.map(c => c.avgHigh).filter((x): x is number => x != null);
  const lows = selected.map(c => c.avgLow).filter((x): x is number => x != null);
  const precips = selected.map(c => c.totalPrecip).filter((x): x is number => x != null);
  const rainies = selected.map(c => c.rainyDays).filter((x): x is number => x != null);
  const clouds = selected.map(c => c.cloudCoverPct).filter((x): x is number => x != null);
  const hums = selected.map(c => c.humidityPct).filter((x): x is number => x != null);
  const mean = (a: number[]): number | null =>
    a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const sum = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) : null);

  // Human-readable label: contiguous ranges use a dash, else list.
  const sortedIdx = [...monthIndices].sort((a, b) => a - b);
  const contiguous = sortedIdx.every((v, i) => i === 0 || v === sortedIdx[i - 1]! + 1);
  const label =
    sortedIdx.length === 1
      ? (MONTHS[sortedIdx[0]!] ?? '')
      : contiguous
        ? `${MONTHS[sortedIdx[0]!]}–${MONTHS[sortedIdx[sortedIdx.length - 1]!]}`
        : sortedIdx.map(i => MONTHS[i]?.slice(0, 3) ?? '').join(', ');

  return {
    monthName: label,
    avgHigh: mean(highs),
    avgLow: mean(lows),
    totalPrecip: sum(precips),
    rainyDays: sum(rainies),
    cloudCoverPct: mean(clouds),
    humidityPct: mean(hums),
    totalDays,
  };
}
