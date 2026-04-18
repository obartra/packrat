// Union type covering form-element properties we access freely throughout the app.
// Properties become optional, matching the defensive `?.value ?? ''` style in this codebase.
export type FormEl = HTMLElement &
  Partial<HTMLInputElement> &
  Partial<HTMLSelectElement> &
  Partial<HTMLTextAreaElement> &
  Partial<HTMLButtonElement>;

export function $<T extends HTMLElement = FormEl>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as unknown as T;
}

export function $maybe<T extends HTMLElement = FormEl>(id: string): T | null {
  return document.getElementById(id) as unknown as T | null;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Color bucket definitions: [name, swatch hex, label]. */
export const COLOR_BUCKETS: [string, string, string][] = [
  ['red', '#DC2626', 'Red'],
  ['orange', '#EA580C', 'Orange'],
  ['yellow', '#CA8A04', 'Yellow'],
  ['green', '#16A34A', 'Green'],
  ['blue', '#2563EB', 'Blue'],
  ['purple', '#7C3AED', 'Purple'],
  ['pink', '#DB2777', 'Pink'],
  ['brown', '#78350F', 'Brown'],
  ['gray', '#6B7280', 'Gray'],
  ['black', '#1F2937', 'Black'],
  ['white', '#F3F4F6', 'White'],
];

/** Map a hex color string to a named color bucket, or null for invalid input. */
export function hexToBucket(hex: string): string | null {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) / 255;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  if (l < 0.18) return 'black';
  if (l > 0.88 && s < 0.15) return 'white';
  if (s < 0.12) return 'gray';
  // Brown: warm hue, dark — high saturation browns are still brown
  if (h >= 15 && h < 45 && l < 0.35) return 'brown';
  if (h < 15 || h >= 345) return 'red';
  if (h < 38) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

/**
 * Midpoint sortOrder between two neighbors for drag-to-reorder.
 * If inserting at the top, pass prev=null. If at the bottom, pass next=null.
 */
export function sortOrderMidpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1000;
  if (next === null) return prev + 1000;
  return (prev + next) / 2;
}
