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
