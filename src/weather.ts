import type { TripWeatherData } from './types';
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
}

export interface ClimateAggregate {
  avgHigh: number | null;
  avgLow: number | null;
  totalPrecip: number | null;
  rainyDays: number | null;
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
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.latitude}&longitude=${loc.longitude}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  const agg = aggregateClimate(data?.daily);
  return {
    place: loc.name,
    country: loc.country,
    monthName: MONTHS[monthIdx] ?? '',
    ...agg,
  };
}

/**
 * Geocode a destination string to a single best-match location via Open-Meteo.
 * Throws if no location is found.
 */
export async function geocode(destination: string): Promise<GeoLocation> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(destination)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  const loc = data?.results?.[0] as GeoLocation | undefined;
  if (!loc) throw new Error(`Could not find location: "${destination}"`);
  return loc;
}
