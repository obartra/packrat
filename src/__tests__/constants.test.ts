import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_ICONS,
  CONTAINER_TYPES,
  CONTAINER_ICONS,
  MONTHS,
  ACTIVITIES,
  AI_API_URL,
  AI_MODEL,
} from '../constants';

describe('CATEGORIES taxonomy', () => {
  it('has at least one value per group', () => {
    Object.entries(CATEGORIES).forEach(([group, values]) => {
      expect(values.length, `group "${group}" must have values`).toBeGreaterThan(0);
    });
  });

  it('contains no duplicate values within a group', () => {
    Object.entries(CATEGORIES).forEach(([group, values]) => {
      expect(new Set(values).size, `group "${group}" has duplicates`).toBe(values.length);
    });
  });

  it('is non-empty', () => {
    expect(Object.keys(CATEGORIES).length).toBeGreaterThan(0);
  });
});

describe('icon coverage', () => {
  it('CATEGORY_ICONS has an entry for every key in CATEGORIES', () => {
    Object.keys(CATEGORIES).forEach(group => {
      expect(CATEGORY_ICONS[group], `missing icon for category "${group}"`).toBeDefined();
    });
  });

  it('CONTAINER_ICONS has an entry for every CONTAINER_TYPE', () => {
    CONTAINER_TYPES.forEach(t => {
      expect(CONTAINER_ICONS[t], `missing icon for container type "${t}"`).toBeDefined();
    });
  });

  it('every icon value is a non-empty string', () => {
    Object.values(CATEGORY_ICONS).forEach(v => expect(v.length).toBeGreaterThan(0));
    Object.values(CONTAINER_ICONS).forEach(v => expect(v.length).toBeGreaterThan(0));
  });
});

describe('MONTHS / ACTIVITIES / AI constants', () => {
  it('MONTHS has exactly 12 entries', () => {
    expect(MONTHS).toHaveLength(12);
  });

  it('MONTHS is ordered January through December', () => {
    expect(MONTHS[0]).toBe('January');
    expect(MONTHS[11]).toBe('December');
  });

  it('ACTIVITIES has at least one entry', () => {
    expect(ACTIVITIES.length).toBeGreaterThan(0);
  });

  it('AI_API_URL points at Anthropic messages endpoint', () => {
    expect(AI_API_URL).toBe('https://api.anthropic.com/v1/messages');
  });

  it('AI_MODEL is a non-empty string', () => {
    expect(typeof AI_MODEL).toBe('string');
    expect(AI_MODEL.length).toBeGreaterThan(0);
  });
});

describe('CONTAINER_TYPES', () => {
  it('contains no duplicates', () => {
    expect(new Set(CONTAINER_TYPES).size).toBe(CONTAINER_TYPES.length);
  });

  it('is non-empty', () => {
    expect(CONTAINER_TYPES.length).toBeGreaterThan(0);
  });
});
