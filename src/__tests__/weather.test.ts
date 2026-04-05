import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aggregateClimate, monthDateRange, geocode, fetchTripWeather } from '../weather';

describe('aggregateClimate', () => {
  it('computes avg high/low, total precip, and rainy day count', () => {
    const daily = {
      temperature_2m_max: [30, 31, 32, 33],
      temperature_2m_min: [20, 21, 22, 23],
      precipitation_sum: [0, 2.5, 0.4, 5],
    };
    const agg = aggregateClimate(daily);
    expect(agg.avgHigh).toBe(32); // mean(30,31,32,33)=31.5 → rounds to 32
    expect(agg.avgLow).toBe(22); // mean(20,21,22,23)=21.5 → rounds to 22
    expect(agg.totalPrecip).toBe(8); // sum=7.9 → rounds to 8
    expect(agg.rainyDays).toBe(2); // days with >1mm: 2.5 and 5
  });

  it('returns nulls when daily is undefined', () => {
    expect(aggregateClimate(undefined)).toEqual({
      avgHigh: null,
      avgLow: null,
      totalPrecip: null,
      rainyDays: null,
    });
  });

  it('returns null for missing fields', () => {
    const agg = aggregateClimate({ temperature_2m_max: [25] });
    expect(agg.avgHigh).toBe(25);
    expect(agg.avgLow).toBeNull();
    expect(agg.totalPrecip).toBeNull();
    expect(agg.rainyDays).toBeNull();
  });

  it('returns null for empty arrays', () => {
    expect(
      aggregateClimate({
        temperature_2m_max: [],
        temperature_2m_min: [],
        precipitation_sum: [],
      }),
    ).toEqual({
      avgHigh: null,
      avgLow: null,
      totalPrecip: null,
      rainyDays: null,
    });
  });

  it('counts rainy days strictly above 1mm (not equal)', () => {
    const agg = aggregateClimate({ precipitation_sum: [1, 1.0, 1.1, 0.9] });
    expect(agg.rainyDays).toBe(1);
  });

  it('handles negative temperatures for cold climates', () => {
    const agg = aggregateClimate({
      temperature_2m_max: [-5, -3, -4],
      temperature_2m_min: [-15, -12, -14],
    });
    expect(agg.avgHigh).toBe(-4);
    expect(agg.avgLow).toBe(-14); // mean is -13.666, rounded = -14
  });
});

describe('monthDateRange', () => {
  it('returns ISO start/end dates for a month in a given year', () => {
    // January 2024 (monthIdx=0)
    expect(monthDateRange(0, 2024)).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });
  });

  it('handles February in a leap year', () => {
    expect(monthDateRange(1, 2024)).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('handles February in a non-leap year', () => {
    expect(monthDateRange(1, 2023)).toEqual({
      startDate: '2023-02-01',
      endDate: '2023-02-28',
    });
  });

  it('handles 30-day months', () => {
    expect(monthDateRange(3, 2024)).toEqual({
      startDate: '2024-04-01',
      endDate: '2024-04-30',
    });
  });

  it('handles December (month index 11)', () => {
    expect(monthDateRange(11, 2024)).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
    });
  });

  it('defaults to previous year when year not provided', () => {
    const thisYear = new Date().getFullYear();
    const { startDate } = monthDateRange(0);
    expect(startDate.startsWith(`${thisYear - 1}-`)).toBe(true);
  });
});

describe('geocode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the first result from Open-Meteo geocoding', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { name: 'Cozumel', country: 'Mexico', latitude: 20.5, longitude: -86.95 },
          { name: 'Cozumel (2nd match)', country: 'Mexico', latitude: 0, longitude: 0 },
        ],
      }),
    });
    const loc = await geocode('Cozumel');
    expect(loc).toEqual({ name: 'Cozumel', country: 'Mexico', latitude: 20.5, longitude: -86.95 });
  });

  it('URL-encodes the destination query', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ name: 'São Paulo', country: 'Brazil', latitude: -23, longitude: -46 }],
      }),
    });
    await geocode('São Paulo');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('name=S%C3%A3o%20Paulo');
    expect(url).toContain('count=1');
  });

  it('throws when no results are returned', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await expect(geocode('Atlantis')).rejects.toThrow(/Atlantis/);
  });

  it('throws when the results field is missing entirely', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await expect(geocode('Nowhere')).rejects.toThrow(/Nowhere/);
  });
});

describe('fetchTripWeather', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const loc = { name: 'Cozumel', country: 'Mexico', latitude: 20.5, longitude: -86.95 };

  it('hits the Open-Meteo archive URL with lat/lon and date range', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        daily: { temperature_2m_max: [30], temperature_2m_min: [25], precipitation_sum: [0] },
      }),
    });
    await fetchTripWeather(loc, 4); // May
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('archive-api.open-meteo.com');
    expect(url).toContain('latitude=20.5');
    expect(url).toContain('longitude=-86.95');
    expect(url).toContain('daily=temperature_2m_max,temperature_2m_min,precipitation_sum');
    expect(url).toContain('-05-01'); // May 1
    expect(url).toContain('-05-31'); // May 31
  });

  it('aggregates the API response into a TripWeatherData summary', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        daily: {
          temperature_2m_max: [30, 32, 34],
          temperature_2m_min: [22, 24, 26],
          precipitation_sum: [0, 5, 10],
        },
      }),
    });
    const w = await fetchTripWeather(loc, 4);
    expect(w.place).toBe('Cozumel');
    expect(w.country).toBe('Mexico');
    expect(w.monthName).toBe('May');
    expect(w.avgHigh).toBe(32);
    expect(w.avgLow).toBe(24);
    expect(w.totalPrecip).toBe(15);
    expect(w.rainyDays).toBe(2);
  });

  it('returns null climate fields when the API has no daily data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const w = await fetchTripWeather(loc, 0);
    expect(w.place).toBe('Cozumel');
    expect(w.avgHigh).toBeNull();
    expect(w.avgLow).toBeNull();
    expect(w.totalPrecip).toBeNull();
    expect(w.rainyDays).toBeNull();
  });
});
