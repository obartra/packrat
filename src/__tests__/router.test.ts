import { describe, it, expect } from 'vitest';
import {
  PRIMARY_TABS,
  TOP_LEVEL_VIEWS,
  VIEW_TITLES,
  isTopLevel,
  resolveTitle,
  nextStack,
  popStack,
  urlToRoute,
  routeToUrl,
  type ViewName,
} from '../router';

describe('TOP_LEVEL_VIEWS / PRIMARY_TABS', () => {
  it('has every primary tab as a top-level view', () => {
    PRIMARY_TABS.forEach(tab => {
      expect(TOP_LEVEL_VIEWS).toContain(tab);
    });
  });

  it('includes login and settings in top-level views', () => {
    expect(TOP_LEVEL_VIEWS).toContain('login');
    expect(TOP_LEVEL_VIEWS).toContain('settings');
  });

  it('does not include detail views as top-level', () => {
    expect(TOP_LEVEL_VIEWS).not.toContain('container');
    expect(TOP_LEVEL_VIEWS).not.toContain('item');
    expect(TOP_LEVEL_VIEWS).not.toContain('list');
  });
});

describe('VIEW_TITLES', () => {
  it('has a title for every ViewName', () => {
    const names: ViewName[] = [
      'login',
      'containers',
      'container',
      'items',
      'item',
      'lists',
      'list',
      'trip',
      'settings',
    ];
    names.forEach(n => {
      expect(VIEW_TITLES[n]).toBeDefined();
    });
  });

  it('uses empty string for the login title (no header shown)', () => {
    expect(VIEW_TITLES.login).toBe('');
  });
});

describe('isTopLevel', () => {
  it('returns true for primary tabs', () => {
    expect(isTopLevel('containers')).toBe(true);
    expect(isTopLevel('items')).toBe(true);
    expect(isTopLevel('lists')).toBe(true);
    expect(isTopLevel('trips')).toBe(true);
  });

  it('returns true for login and settings', () => {
    expect(isTopLevel('login')).toBe(true);
    expect(isTopLevel('settings')).toBe(true);
  });

  it('returns false for detail views', () => {
    expect(isTopLevel('container')).toBe(false);
    expect(isTopLevel('item')).toBe(false);
    expect(isTopLevel('list')).toBe(false);
    expect(isTopLevel('trip')).toBe(false);
    expect(isTopLevel('trip-wizard')).toBe(false);
  });
});

describe('resolveTitle', () => {
  it('uses caller-provided title when present', () => {
    expect(resolveTitle('list', { title: 'Toiletries' })).toBe('Toiletries');
  });

  it('falls back to VIEW_TITLES when no title param', () => {
    expect(resolveTitle('containers')).toBe('Packrat');
    expect(resolveTitle('items')).toBe('Items');
    expect(resolveTitle('trips')).toBe('Trips');
  });

  it('falls back to "Packrat" when the view title is empty', () => {
    // login has an empty title — the shell should still show something
    expect(resolveTitle('login')).toBe('Packrat');
  });

  it('ignores empty title param and uses the default', () => {
    expect(resolveTitle('items', { title: '' })).toBe('Items');
  });
});

describe('nextStack', () => {
  it('clears the stack when navigating to a top-level view', () => {
    expect(nextStack(['container', 'item'], 'containers')).toEqual([]);
    expect(nextStack(['list'], 'settings')).toEqual([]);
    expect(nextStack(['item'], 'login')).toEqual([]);
  });

  it('pushes a detail view onto the stack', () => {
    expect(nextStack([], 'container')).toEqual(['container']);
    expect(nextStack(['container'], 'item')).toEqual(['container', 'item']);
  });

  it('does not duplicate a view already in the stack', () => {
    expect(nextStack(['container', 'item'], 'container')).toEqual(['container', 'item']);
  });

  it('returns a new array — does not mutate the input', () => {
    const input: ViewName[] = ['container'];
    const result = nextStack(input, 'item');
    expect(result).not.toBe(input);
    expect(input).toEqual(['container']);
  });

  it('returns a copy even when the target is already present', () => {
    const input: ViewName[] = ['container', 'item'];
    const result = nextStack(input, 'container');
    expect(result).not.toBe(input);
  });
});

describe('popStack', () => {
  it('pops the top view and returns the previous one', () => {
    const { next, stack } = popStack(['container', 'item']);
    expect(next).toBe('container');
    expect(stack).toEqual(['container']);
  });

  it('returns the default fallback when the stack is empty after pop', () => {
    const { next, stack } = popStack(['container']);
    expect(next).toBe('containers');
    expect(stack).toEqual([]);
  });

  it('returns the fallback when popping from an already-empty stack', () => {
    const { next, stack } = popStack([]);
    expect(next).toBe('containers');
    expect(stack).toEqual([]);
  });

  it('respects a custom fallback', () => {
    const { next } = popStack(['container'], 'items');
    expect(next).toBe('items');
  });

  it('does not mutate the input stack', () => {
    const input: ViewName[] = ['container', 'item'];
    popStack(input);
    expect(input).toEqual(['container', 'item']);
  });
});

describe('back-navigation integration', () => {
  // Simulates the main.ts flow: showView pushes via nextStack, back button calls popStack.
  it('navigates containers → container → item → back → back', () => {
    let stack: ViewName[] = [];
    stack = nextStack(stack, 'containers'); // clears (top-level)
    expect(stack).toEqual([]);
    stack = nextStack(stack, 'container'); // push detail
    expect(stack).toEqual(['container']);
    stack = nextStack(stack, 'item'); // push detail
    expect(stack).toEqual(['container', 'item']);

    let result = popStack(stack); // back once
    stack = result.stack;
    expect(result.next).toBe('container');

    result = popStack(stack); // back again — empty, fallback
    expect(result.next).toBe('containers');
    expect(result.stack).toEqual([]);
  });

  it('a primary-tab navigation resets mid-flow', () => {
    let stack: ViewName[] = ['container', 'item'];
    stack = nextStack(stack, 'lists'); // primary tab
    expect(stack).toEqual([]);
  });
});

describe('urlToRoute', () => {
  it('maps / to containers', () => {
    expect(urlToRoute('/')).toEqual({ name: 'containers' });
  });

  it('maps empty path to containers', () => {
    expect(urlToRoute('')).toEqual({ name: 'containers' });
  });

  it('maps primary tabs', () => {
    expect(urlToRoute('/items')).toEqual({ name: 'items' });
    expect(urlToRoute('/lists')).toEqual({ name: 'lists' });
    expect(urlToRoute('/trips')).toEqual({ name: 'trips' });
    expect(urlToRoute('/settings')).toEqual({ name: 'settings' });
    expect(urlToRoute('/login')).toEqual({ name: 'login' });
  });

  it('maps /containers to the containers view', () => {
    expect(urlToRoute('/containers')).toEqual({ name: 'containers' });
  });

  it('maps detail routes with an id', () => {
    expect(urlToRoute('/containers/abc')).toEqual({ name: 'container', id: 'abc' });
    expect(urlToRoute('/items/xyz')).toEqual({ name: 'item', id: 'xyz' });
    expect(urlToRoute('/lists/list123')).toEqual({ name: 'list', id: 'list123' });
  });

  it('maps trip routes', () => {
    expect(urlToRoute('/trips/new')).toEqual({ name: 'trip-wizard' });
    expect(urlToRoute('/trips/italy-may-2026')).toEqual({ name: 'trip', id: 'italy-may-2026' });
    expect(urlToRoute('/trips/italy-may-2026/edit')).toEqual({
      name: 'trip-edit',
      id: 'italy-may-2026',
    });
  });

  it('tolerates trailing slashes', () => {
    expect(urlToRoute('/items/')).toEqual({ name: 'items' });
    expect(urlToRoute('/containers/abc/')).toEqual({ name: 'container', id: 'abc' });
  });

  it('tolerates leading double slashes', () => {
    expect(urlToRoute('//items')).toEqual({ name: 'items' });
  });

  it('falls back to containers for unknown paths', () => {
    expect(urlToRoute('/nope')).toEqual({ name: 'containers' });
    expect(urlToRoute('/some/random/path')).toEqual({ name: 'containers' });
  });
});

describe('routeToUrl', () => {
  it('maps containers to /', () => {
    expect(routeToUrl('containers')).toBe('/');
  });

  it('maps primary tabs', () => {
    expect(routeToUrl('items')).toBe('/items');
    expect(routeToUrl('lists')).toBe('/lists');
    expect(routeToUrl('trips')).toBe('/trips');
    expect(routeToUrl('settings')).toBe('/settings');
    expect(routeToUrl('login')).toBe('/login');
  });

  it('maps detail views with id params', () => {
    expect(routeToUrl('container', { id: 'abc' })).toBe('/containers/abc');
    expect(routeToUrl('item', { id: 'xyz' })).toBe('/items/xyz');
    expect(routeToUrl('list', { id: 'list123' })).toBe('/lists/list123');
    expect(routeToUrl('trip', { id: 'italy-may-2026' })).toBe('/trips/italy-may-2026');
  });

  it('maps wizard to new path', () => {
    expect(routeToUrl('trip-wizard')).toBe('/trips/new');
  });

  it('maps trip-edit to /trips/:id/edit', () => {
    expect(routeToUrl('trip-edit', { id: 'italy-may-2026' })).toBe('/trips/italy-may-2026/edit');
    expect(routeToUrl('trip-edit')).toBe('/trips');
  });

  it('falls back to the index path when id is missing on a detail view', () => {
    expect(routeToUrl('container')).toBe('/containers');
    expect(routeToUrl('item')).toBe('/items');
    expect(routeToUrl('list')).toBe('/lists');
    expect(routeToUrl('trip')).toBe('/trips');
  });

  it('ignores the title param', () => {
    expect(routeToUrl('item', { id: 'x', title: 'Custom' })).toBe('/items/x');
  });
});

describe('urlToRoute ↔ routeToUrl round-trip', () => {
  const cases: Array<{ name: ViewName; id?: string }> = [
    { name: 'containers' },
    { name: 'items' },
    { name: 'lists' },
    { name: 'trips' },
    { name: 'settings' },
    { name: 'login' },
    { name: 'container', id: 'abc123' },
    { name: 'item', id: 'xyz' },
    { name: 'list', id: 'listABC' },
    { name: 'trip', id: 'italy-may-2026' },
  ];

  it.each(cases)('round-trips $name${id}', ({ name, id }) => {
    const url = routeToUrl(name, id ? { id } : {});
    const back = urlToRoute(url);
    expect(back.name).toBe(name);
    expect(back.id).toBe(id);
  });
});
