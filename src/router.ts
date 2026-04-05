// Pure routing helpers — no DOM side effects, no module state.
// `main.ts` holds the live `viewStack`/`currentView` and does the DOM work;
// this module owns the types, titles, and stack-manipulation logic so they
// can be unit-tested in isolation.

export type ViewName =
  | 'login'
  | 'containers'
  | 'container'
  | 'items'
  | 'item'
  | 'lists'
  | 'list'
  | 'trips'
  | 'trip'
  | 'trip-wizard'
  | 'trip-edit'
  | 'settings';

export interface ViewParams {
  id?: string;
  title?: string;
}

/** Bottom-nav tabs — always accessible, reset the view stack when tapped. */
export const PRIMARY_TABS: readonly ViewName[] = ['containers', 'items', 'lists', 'trips'];

/** Views that live at the top of the navigation hierarchy (no back button). */
export const TOP_LEVEL_VIEWS: readonly ViewName[] = [...PRIMARY_TABS, 'login', 'settings'];

export const VIEW_TITLES: Record<ViewName, string> = {
  login: '',
  containers: 'Packrat',
  items: 'Items',
  lists: 'Lists',
  trips: 'Trips',
  settings: 'Settings',
  container: 'Container',
  item: 'Item',
  list: 'Packing List',
  trip: 'Trip',
  'trip-wizard': 'Plan a Trip',
  'trip-edit': 'Edit Trip',
};

/** True when a view has no back-button parent. */
export function isTopLevel(name: ViewName): boolean {
  return TOP_LEVEL_VIEWS.includes(name);
}

/** Header title for a view, preferring a caller-provided override. */
export function resolveTitle(name: ViewName, params: ViewParams = {}): string {
  return params.title || VIEW_TITLES[name] || 'Packrat';
}

/**
 * Given the current stack and a navigation target, return the next stack.
 * Top-level views clear the stack entirely; detail views push onto it,
 * but never duplicate an already-present entry.
 */
export function nextStack(current: readonly ViewName[], target: ViewName): ViewName[] {
  if (isTopLevel(target)) return [];
  if (current.includes(target)) return [...current];
  return [...current, target];
}

/**
 * Pop the top of the stack and return the view we should navigate to.
 * When the stack becomes empty, fall back to the given primary tab.
 */
export function popStack(
  current: readonly ViewName[],
  fallback: ViewName = 'containers',
): { next: ViewName; stack: ViewName[] } {
  const stack = current.slice(0, -1);
  const next = stack[stack.length - 1] ?? fallback;
  return { next, stack };
}

export interface RouteMatch {
  name: ViewName;
  id?: string;
}

/**
 * Parse a pathname into a view + optional id. Unknown paths fall back to
 * the containers view (the primary landing surface).
 */
export function urlToRoute(pathname: string): RouteMatch {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return { name: 'containers' };
  const [first, second, third] = trimmed.split('/');
  switch (first) {
    case 'login':
      return { name: 'login' };
    case 'settings':
      return { name: 'settings' };
    case 'containers':
      return second ? { name: 'container', id: second } : { name: 'containers' };
    case 'items':
      return second ? { name: 'item', id: second } : { name: 'items' };
    case 'lists':
      return second ? { name: 'list', id: second } : { name: 'lists' };
    case 'trips':
      if (!second) return { name: 'trips' };
      if (second === 'new') return { name: 'trip-wizard' };
      if (third === 'edit') return { name: 'trip-edit', id: second };
      return { name: 'trip', id: second };
    default:
      return { name: 'containers' };
  }
}

/**
 * Build a pathname for a view + params. Round-trips with urlToRoute.
 */
export function routeToUrl(name: ViewName, params: ViewParams = {}): string {
  switch (name) {
    case 'login':
      return '/login';
    case 'containers':
      return '/';
    case 'container':
      return params.id ? `/containers/${params.id}` : '/containers';
    case 'items':
      return '/items';
    case 'item':
      return params.id ? `/items/${params.id}` : '/items';
    case 'lists':
      return '/lists';
    case 'list':
      return params.id ? `/lists/${params.id}` : '/lists';
    case 'trips':
      return '/trips';
    case 'trip':
      return params.id ? `/trips/${params.id}` : '/trips';
    case 'trip-wizard':
      return '/trips/new';
    case 'trip-edit':
      return params.id ? `/trips/${params.id}/edit` : '/trips';
    case 'settings':
      return '/settings';
  }
}
