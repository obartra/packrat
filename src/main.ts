// ============================================================
//  PACKRAT — main.js
// ============================================================

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

import type {
  Container,
  Item,
  List,
  ListEntry,
  Category,
  CategoriesMap,
  TripWeatherData,
  TripAIResult,
  PackingItem,
} from './types';
import { auth, db } from './firebase';
import { $, $maybe, esc } from './utils';
import {
  store,
  uid,
  userPath,
  itemsCol,
  contsCol,
  listsCol,
  entriesCol,
  loadAllData,
  setupListeners,
  teardownListeners,
  clearStore,
} from './store';
import {
  pendingPhoto,
  resizeAndUpload,
  lazyLoadPhoto,
  deletePhotoIfExists,
  triggerPhotoPicker,
  setupSheetPhotoButtons,
} from './photos';
import { showToast } from './ui/toast';
import { showConfirm } from './ui/confirm';
import { openSheet, closeSheet } from './ui/sheet';
import {
  CATEGORIES,
  CONTAINER_TYPES,
  MONTHS,
  ACTIVITIES,
  CONTAINER_ICONS,
  CATEGORY_ICONS,
  AI_MODEL,
} from './constants';
import { parseCSV, type CSVRow } from './csv';
import {
  PRIMARY_TABS,
  isTopLevel,
  resolveTitle,
  nextStack,
  popStack,
  urlToRoute,
  routeToUrl,
  type ViewName,
  type ViewParams,
} from './router';
import { geocode, fetchTripWeather } from './weather';
import { callAI, SYSTEM_PROMPT, buildUserMessage, inventoryFromItems, parseAIResponse } from './ai';

// ============================================================
//  FORM STATE (local to this module)
// ============================================================
let currentItemFilter = '';
const tripActivities = new Set<string>();
const tripCandidates = new Map<string, boolean>();

// ============================================================
//  UTILITY
// ============================================================
const formatCat = (cat: Category | null | undefined): string =>
  cat ? `${cat.group} / ${cat.value}` : '—';
const itemCount = (cid: string | null): number =>
  [...store.items.values()].filter(it => it.containerId === cid).length;
const containerName = (cid: string | null): string =>
  cid ? (store.containers.get(cid)?.name ?? 'Unknown') : 'Unassigned';

function getApiKey(): string {
  return localStorage.getItem('packrat_anthropic_key') || '';
}
function setApiKey(k: string): void {
  localStorage.setItem('packrat_anthropic_key', k);
}

// ============================================================
//  AUTH
// ============================================================
const loginEmailEl = () => $<HTMLInputElement>('login-email');
const loginPassEl = () => $<HTMLInputElement>('login-password');
const loginErrorEl = () => $('login-error');

let loginMode: 'signin' | 'register' = 'signin';
$('tab-signin').addEventListener('click', () => setLoginMode('signin'));
$('tab-register').addEventListener('click', () => setLoginMode('register'));

function setLoginMode(mode: 'signin' | 'register'): void {
  loginMode = mode;
  $('tab-signin').classList.toggle('active', mode === 'signin');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('login-register-extra').classList.toggle('hidden', mode === 'signin');
  $('btn-login-submit').textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
  loginPassEl().setAttribute(
    'autocomplete',
    mode === 'signin' ? 'current-password' : 'new-password',
  );
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = loginEmailEl().value.trim();
  const pass = loginPassEl().value;
  loginErrorEl().textContent = '';
  if (!email || !pass) {
    loginErrorEl().textContent = 'Email and password required.';
    return;
  }

  const btn = $<HTMLButtonElement>('btn-login-submit');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    if (loginMode === 'signin') {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const pass2 = $<HTMLInputElement>('login-password2').value;
      if (pass !== pass2) throw new Error("Passwords don't match.");
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await setDoc(doc(db, `users/${cred.user.uid}`), { email, createdAt: serverTimestamp() });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loginErrorEl().textContent = msg.replace('Firebase: ', '').replace(/ \(auth\/.*\)/, '');
    btn.disabled = false;
    btn.textContent = loginMode === 'signin' ? 'Sign In' : 'Create Account';
  }
});

// ============================================================
//  AUTH STATE
// ============================================================
// Capture the pathname the page loaded with, before any internal navigation
// replaces it (deep-link support on reload).
const initialPath = window.location.pathname;

onAuthStateChanged(auth, async (user: User | null) => {
  if (user) {
    store.user = user;
    $('app-header').classList.remove('hidden');
    $('bottom-nav').classList.remove('hidden');
    await loadAllData();
    setupListeners();
    // Navigate to the route the user arrived at (deep-link support),
    // defaulting to containers for unknown paths.
    const match = urlToRoute(initialPath);
    showView(match.name, match.id ? { id: match.id } : {}, { replace: true });
  } else {
    teardownListeners();
    clearStore();
    showView('login');
    $('app-header').classList.add('hidden');
    $('bottom-nav').classList.add('hidden');
  }
});

// ============================================================
//  ROUTER — DOM glue. Pure logic lives in ./router.
// ============================================================
interface ShowViewOpts {
  /** True when called in response to a popstate event — don't push history. */
  fromHistory?: boolean;
  /** Replace the current history entry rather than push a new one. */
  replace?: boolean;
}

let currentView: ViewName = 'login';
let viewStack: ViewName[] = [];

function showView(name: ViewName, params: ViewParams = {}, opts: ShowViewOpts = {}): void {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $maybe(`view-${name}`);
  if (el) el.classList.add('active');
  currentView = name;

  // Sync URL with view (unless this call was triggered by a history event)
  if (!opts.fromHistory) {
    const url = routeToUrl(name, params);
    if (opts.replace || url === window.location.pathname) {
      window.history.replaceState({ name, params }, '', url);
    } else {
      window.history.pushState({ name, params }, '', url);
    }
  }

  // Update back button + stack
  const backBtn = $('btn-back');
  const isTop = isTopLevel(name);
  backBtn.classList.toggle('hidden', isTop);
  viewStack = nextStack(viewStack, name);

  // Update settings button
  const actionBtn = $('btn-header-action');
  if (name === 'login') {
    actionBtn.classList.add('hidden');
  } else if (PRIMARY_TABS.includes(name)) {
    actionBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    actionBtn.classList.remove('hidden');
    actionBtn.onclick = () => {
      viewStack = [];
      showView('settings');
      updateNav('');
    };
  } else {
    actionBtn.classList.add('hidden');
  }

  // Update nav active state
  updateNav(PRIMARY_TABS.includes(name) ? name : '');

  // Update header title
  $('header-title').textContent = resolveTitle(name, params);

  // Render view
  switch (name) {
    case 'containers':
      renderContainersView();
      break;
    case 'container':
      if (params.id) renderContainerView(params.id);
      break;
    case 'items':
      renderItemsView();
      break;
    case 'item':
      if (params.id) renderItemView(params.id);
      break;
    case 'lists':
      renderListsView();
      break;
    case 'list':
      if (params.id) renderListView(params.id);
      break;
    case 'trip':
      renderTripView();
      break;
    case 'settings':
      renderSettingsView();
      break;
    case 'login':
      break;
  }
}

$('btn-back').addEventListener('click', () => {
  // If the browser can go back within this app, delegate to native history —
  // the popstate handler below will re-render. Otherwise pop our internal
  // stack (covers edge cases like direct deep-links with no back history).
  if (window.history.length > 1) {
    window.history.back();
  } else {
    const { next, stack } = popStack(viewStack);
    viewStack = stack;
    showView(next, {}, { replace: true });
  }
});

// Browser back/forward → re-navigate without pushing a new history entry.
window.addEventListener('popstate', event => {
  const state = event.state as { name?: ViewName; params?: ViewParams } | null;
  if (state?.name) {
    showView(state.name, state.params ?? {}, { fromHistory: true });
  } else {
    // Fallback: parse the URL (e.g., initial load or manual URL edit).
    const match = urlToRoute(window.location.pathname);
    showView(match.name, match.id ? { id: match.id } : {}, { fromHistory: true });
  }
});

function updateNav(tab: string): void {
  document.querySelectorAll<HTMLElement>('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset['tab'] === tab);
  });
}

document.querySelectorAll<HTMLElement>('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    viewStack = [];
    const tab = btn.dataset['tab'];
    if (tab) showView(tab as ViewName);
  });
});

// ============================================================
//  CONTAINERS — render list
// ============================================================
function renderContainersView() {
  if (!uid()) return;
  const grid = $('containers-grid');
  const empty = $('containers-empty');
  const conts = [...store.containers.values()].filter(c => !c.parentContainerId);

  if (!conts.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = conts
    .map(c => {
      const count = itemCount(c.id);
      const icon = CONTAINER_ICONS[c.type] || '📫';
      return `
      <div class="card container-card" data-id="${c.id}" data-action="open-container">
        <div class="card-photo">
          ${
            c.photoPath
              ? `<img data-photo="${esc(c.photoPath)}" alt="${esc(c.name)}">`
              : `<div class="no-photo-icon">${icon}</div>`
          }
        </div>
        <div class="card-body">
          <div class="card-name">${esc(c.name)}</div>
          <div class="card-meta">
            <span class="item-count">${count} item${count !== 1 ? 's' : ''}</span>
            ${c.location ? `<span>${esc(c.location)}</span>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');

  grid
    .querySelectorAll<HTMLImageElement>('img[data-photo]')
    .forEach(img => lazyLoadPhoto(img, img.dataset['photo']));
}

$('btn-add-container').addEventListener('click', () => openContainerForm());

// ============================================================
//  CONTAINERS — open/save form
// ============================================================
function containerFormBody(c: Partial<Container> = {}): string {
  const typeOpts = CONTAINER_TYPES.map(
    t =>
      `<option value="${t}" ${c.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`,
  ).join('');
  const parentOpts =
    `<option value="">None (top-level)</option>` +
    [...store.containers.values()]
      .filter(p => p.id !== c.id)
      .map(
        p =>
          `<option value="${p.id}" ${c.parentContainerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`,
      )
      .join('');

  return `
    <div class="form-group"><label>Name *</label>
      <input type="text" id="f-name" value="${esc(c.name || '')}" placeholder="e.g. Osprey carry-on" autocomplete="off"></div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="f-type">${typeOpts}</select></div>
      <div class="form-group"><label>Parent</label><select id="f-parent">${parentOpts}</select></div>
    </div>
    <div class="form-group"><label>Location</label>
      <input type="text" id="f-location" value="${esc(c.location || '')}" placeholder="e.g. closet, storage unit"></div>
    <div class="form-group"><label>Color</label>
      <input type="text" id="f-color" value="${esc(c.color || '')}" placeholder="e.g. olive green"></div>
    <div class="form-group"><label>Notes</label>
      <textarea id="f-notes" rows="2">${esc(c.notes || '')}</textarea></div>
    <div class="form-group"><label>Photo</label>
      <div class="photo-input-area">
        <div class="photo-preview" id="f-photo-preview">
          ${c.photoPath ? '<img id="f-photo-img">' : CONTAINER_ICONS[c.type || 'other'] || '📦'}
        </div>
        <div class="photo-btns">
          <button type="button" class="btn-sm" id="btn-photo-camera">📷 Camera</button>
          <button type="button" class="btn-sm" id="btn-photo-library">🖼 Library</button>
          ${c.photoPath ? '<button type="button" class="btn-sm danger" id="btn-photo-remove">Remove</button>' : ''}
        </div>
      </div>
    </div>`;
}

function openContainerForm(containerId: string | null = null): void {
  const c: Partial<Container> = containerId ? (store.containers.get(containerId) ?? {}) : {};
  openSheet(containerId ? 'Edit Container' : 'New Container', containerFormBody(c), () =>
    saveContainerForm(containerId),
  );

  if (c.photoPath) {
    const img = $maybe('f-photo-img');
    if (img) lazyLoadPhoto(img, c.photoPath);
    pendingPhoto.oldPath = null;
  }
  setupSheetPhotoButtons(() => $('f-photo-preview'));
  $maybe('btn-photo-camera')?.addEventListener('click', () => triggerPhotoPicker('camera'));
  $maybe('btn-photo-library')?.addEventListener('click', () => triggerPhotoPicker('library'));
  $maybe('btn-photo-remove')?.addEventListener('click', () => {
    pendingPhoto.oldPath = c.photoPath ?? null;
    pendingPhoto.file = 'REMOVE';
    $('f-photo-preview').innerHTML = '📦';
  });
}

async function saveContainerForm(existingId: string | null): Promise<void> {
  const name = $('f-name').value?.trim();
  if (!name) {
    showToast('Name is required', 'error');
    return;
  }

  const btn = $('btn-sheet-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const data: Record<string, unknown> = {
      name,
      type: $('f-type').value || 'other',
      parentContainerId: $('f-parent').value || null,
      location: $('f-location').value?.trim() || '',
      color: $('f-color').value?.trim() || '',
      notes: $('f-notes').value?.trim() || '',
      updatedAt: serverTimestamp(),
    };

    // Determine photo path
    const docRef = existingId ? doc(db, `${userPath()}/containers/${existingId}`) : doc(contsCol());
    const docId = docRef.id;

    if (pendingPhoto.file === 'REMOVE') {
      await deletePhotoIfExists(pendingPhoto.oldPath);
      data['photoPath'] = null;
    } else if (pendingPhoto.file) {
      await deletePhotoIfExists(existingId ? store.containers.get(existingId)?.photoPath : null);
      const path = `${userPath()}/containers/${docId}.jpg`;
      await resizeAndUpload(pendingPhoto.file, path);
      data['photoPath'] = path;
    } else {
      data['photoPath'] = existingId ? (store.containers.get(existingId)?.photoPath ?? null) : null;
    }

    if (existingId) {
      await updateDoc(docRef, data);
      const existing = store.containers.get(existingId);
      if (existing)
        store.containers.set(existingId, {
          ...existing,
          ...data,
          updatedAt: serverTimestamp(),
        } as Container);
    } else {
      data['createdAt'] = serverTimestamp();
      await setDoc(docRef, data);
      store.containers.set(docId, {
        id: docId,
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as Container);
    }

    closeSheet();
    showToast(existingId ? 'Container updated' : 'Container added', 'success');
    renderContainersView();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error: ' + msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function deleteContainer(cid: string): Promise<void> {
  const c = store.containers.get(cid);
  if (!c) return;
  // Move items to unassigned
  const batch = writeBatch(db);
  store.items.forEach((item, iid) => {
    if (item.containerId === cid) {
      batch.update(doc(db, `${userPath()}/items/${iid}`), {
        containerId: null,
        updatedAt: serverTimestamp(),
      });
      store.items.set(iid, { ...item, containerId: null });
    }
  });
  batch.delete(doc(db, `${userPath()}/containers/${cid}`));
  await batch.commit();
  await deletePhotoIfExists(c.photoPath);
  store.containers.delete(cid);
  showToast('Container deleted', 'success');
}

// ============================================================
//  CONTAINERS — detail view
// ============================================================
function renderContainerView(cid: string): void {
  if (!cid) return;
  const c = store.containers.get(cid);
  if (!c) {
    showView('containers');
    return;
  }
  $('header-title').textContent = c.name;

  const items = [...store.items.values()].filter(it => it.containerId === cid);
  const compartments = [...store.containers.values()].filter(cc => cc.parentContainerId === cid);

  $('container-detail-content').innerHTML = `
    <div class="photo-full">
      ${
        c.photoPath
          ? `<img id="cont-photo" alt="${esc(c.name)}">`
          : `<div class="no-photo"><div class="no-photo-icon-lg">${CONTAINER_ICONS[c.type] || '📦'}</div><span>No photo</span></div>`
      }
    </div>
    <div class="detail-section">
      <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${esc(c.type || '—')}</span></div>
      ${c.location ? `<div class="detail-row"><span class="detail-label">Location</span><span class="detail-value">${esc(c.location)}</span></div>` : ''}
      ${c.color ? `<div class="detail-row"><span class="detail-label">Color</span><span class="detail-value">${esc(c.color)}</span></div>` : ''}
      ${c.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${esc(c.notes)}</span></div>` : ''}
      <div class="detail-actions">
        <button class="btn-sm accent" data-action="edit-container" data-id="${cid}">Edit</button>
        <button class="btn-sm danger" data-action="delete-container" data-id="${cid}">Delete</button>
      </div>
    </div>
    ${
      compartments.length
        ? `
    <div class="group-header">Compartments</div>
    <div class="stack" style="margin-bottom:12px">
      ${compartments
        .map(
          cc => `
        <div class="stack-card" data-action="open-container" data-id="${cc.id}">
          <div class="stack-main"><div class="stack-name">${esc(cc.name)}</div></div>
          <span style="color:var(--text-tertiary)">›</span>
        </div>`,
        )
        .join('')}
    </div>`
        : ''
    }
    <div class="group-header">Items (${items.length})</div>
    <div class="stack">
      ${items.map(it => renderItemRow(it)).join('') || '<div class="empty-state" style="padding:24px"><p>No items in this container</p></div>'}
    </div>`;

  if (c.photoPath) {
    const img = $maybe('cont-photo');
    if (img) lazyLoadPhoto(img, c.photoPath);
  }
  // Lazy load item thumbs
  $('container-detail-content')
    .querySelectorAll<HTMLImageElement>('img[data-photo]')
    .forEach(img => lazyLoadPhoto(img, img.dataset['photo']));
}

// ============================================================
//  ITEMS — render list
// ============================================================
function renderItemsView() {
  // Populate container filter
  const filterSel = $('items-filter-container');
  if (filterSel) {
    const saved = filterSel.value;
    filterSel.innerHTML =
      '<option value="">All containers</option>' +
      [...store.containers.values()]
        .map(
          c =>
            `<option value="${c.id}" ${saved === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
        )
        .join('');
  }
  // Category chips
  const chips = $('items-category-chips');
  if (chips) {
    chips.innerHTML =
      `<span class="chip${!currentItemFilter ? ' active' : ''}" data-cat="">All</span>` +
      Object.keys(CATEGORIES)
        .map(
          g =>
            `<span class="chip${currentItemFilter === g ? ' active' : ''}" data-cat="${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</span>`,
        )
        .join('');
  }
  applyItemFilters();
}

function applyItemFilters(): void {
  const search = ($('items-search').value || '').toLowerCase();
  const cFilter = $('items-filter-container').value || '';
  const catFilter = currentItemFilter;

  let items = [...store.items.values()];
  if (search)
    items = items.filter(
      it =>
        it.name.toLowerCase().includes(search) ||
        (it.tags || []).some(t => t.toLowerCase().includes(search)),
    );
  if (cFilter) items = items.filter(it => it.containerId === cFilter);
  if (catFilter) items = items.filter(it => it.category?.group === catFilter);

  const content = $('items-list-content');
  const emptyEl = $('items-empty');

  if (!items.length) {
    content.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  // Group by category.group
  const groups: Record<string, Item[]> = {};
  items.forEach(it => {
    const g = it.category?.group || 'misc';
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(it);
  });

  content.innerHTML = Object.entries(groups)
    .map(
      ([g, its]) => `
    <div class="group-header">${g.charAt(0).toUpperCase() + g.slice(1)} <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0">(${its.length})</span></div>
    <div class="stack" style="margin-bottom:4px">
      ${its.map(it => renderItemRow(it)).join('')}
    </div>
  `,
    )
    .join('');

  content
    .querySelectorAll<HTMLImageElement>('img[data-photo]')
    .forEach(img => lazyLoadPhoto(img, img.dataset['photo']));
}

function renderItemRow(it: Item): string {
  const icon = CATEGORY_ICONS[it.category?.group ?? 'misc'] || '•';
  return `
    <div class="item-row" data-action="open-item" data-id="${it.id}">
      <div class="item-thumb">
        ${it.photoPath ? `<img data-photo="${esc(it.photoPath)}" alt="${esc(it.name)}">` : `<span>${icon}</span>`}
      </div>
      <div class="item-info">
        <div class="item-name">${esc(it.name)}</div>
        <div class="item-meta">
          <span class="tag">${esc(it.category?.value || '—')}</span>
          ${it.containerId ? `<span>${esc(containerName(it.containerId))}</span>` : '<span style="color:var(--text-tertiary)">Unassigned</span>'}
        </div>
      </div>
      <span class="item-qty">${it.quantityOwned || 1}</span>
    </div>`;
}

$('btn-add-item').addEventListener('click', () => openItemForm());

$('items-search').addEventListener('input', applyItemFilters);
$('items-filter-container').addEventListener('change', applyItemFilters);

document.addEventListener('click', e => {
  const target = e.target as HTMLElement | null;
  const chip = target?.closest<HTMLElement>('.chip[data-cat]');
  if (chip && chip.closest('#items-category-chips')) {
    currentItemFilter = chip.dataset['cat'] ?? '';
    document
      .querySelectorAll('#items-category-chips .chip')
      .forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    applyItemFilters();
  }
});

// ============================================================
//  ITEMS — detail view
// ============================================================
function renderItemView(itemId: string): void {
  if (!itemId) return;
  const it = store.items.get(itemId);
  if (!it) {
    showView('items');
    return;
  }
  $('header-title').textContent = it.name;

  // "Appears in" lists
  const appearsIn = [...store.lists.values()].filter(l => {
    const entries = store.listEntries.get(l.id);
    return entries && [...entries.values()].some(e => e.itemId === itemId);
  });

  $('item-detail-content').innerHTML = `
    <div class="photo-full">
      ${
        it.photoPath
          ? `<img id="item-photo" alt="${esc(it.name)}">`
          : `<div class="no-photo"><div class="no-photo-icon-lg">📋</div><span>No photo</span></div>`
      }
    </div>
    <div class="detail-section">
      <div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${esc(formatCat(it.category))}</span></div>
      <div class="detail-row"><span class="detail-label">Own</span><span class="detail-value">${it.quantityOwned || 1}</span></div>
      <div class="detail-row"><span class="detail-label">Pack default</span><span class="detail-value">${it.quantityPackDefault || 1}</span></div>
      <div class="detail-row"><span class="detail-label">Container</span><span class="detail-value">${esc(containerName(it.containerId))}</span></div>
      ${it.tags?.length ? `<div class="detail-row"><span class="detail-label">Tags</span><span class="detail-value">${it.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</span></div>` : ''}
      ${it.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-value">${esc(it.notes)}</span></div>` : ''}
      <div class="detail-actions">
        <button class="btn-sm accent" data-action="edit-item" data-id="${itemId}">Edit</button>
        <button class="btn-sm danger" data-action="delete-item" data-id="${itemId}">Delete</button>
      </div>
    </div>
    ${
      appearsIn.length
        ? `
    <div class="detail-section">
      <h3>Appears in lists</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${appearsIn.map(l => `<span class="appears-chip" data-action="open-list" data-id="${l.id}">${esc(l.name)}</span>`).join('')}
      </div>
    </div>`
        : ''
    }`;

  if (it.photoPath) {
    const img = $maybe('item-photo');
    if (img) lazyLoadPhoto(img, it.photoPath);
  }
}

// ============================================================
//  ITEMS — form
// ============================================================
function itemFormBody(it: Partial<Item> = {}): string {
  const groupOpts = Object.keys(CATEGORIES)
    .map(
      g =>
        `<option value="${g}" ${it.category?.group === g ? 'selected' : ''}>${g.charAt(0).toUpperCase() + g.slice(1)}</option>`,
    )
    .join('');

  const valOpts = (g: string | undefined): string =>
    (CATEGORIES[(g || 'misc') as keyof CategoriesMap] || CATEGORIES.misc)
      .map(v => `<option value="${v}" ${it.category?.value === v ? 'selected' : ''}>${v}</option>`)
      .join('');

  const contOpts =
    '<option value="">Unassigned</option>' +
    [...store.containers.values()]
      .map(
        c =>
          `<option value="${c.id}" ${it.containerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
      )
      .join('');

  return `
    <div class="form-group"><label>Name *</label>
      <input type="text" id="f-name" value="${esc(it.name || '')}" placeholder="e.g. Black merino t-shirt" autocomplete="off"></div>
    <div class="form-row">
      <div class="form-group"><label>Group</label>
        <select id="f-cat-group">${groupOpts}</select></div>
      <div class="form-group"><label>Category</label>
        <select id="f-cat-value">${valOpts(it.category?.group)}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Own</label>
        <input type="number" id="f-qty-own" value="${it.quantityOwned || 1}" min="0" inputmode="numeric" style="text-align:center"></div>
      <div class="form-group"><label>Pack default</label>
        <input type="number" id="f-qty-pack" value="${it.quantityPackDefault || 1}" min="0" inputmode="numeric" style="text-align:center"></div>
    </div>
    <div class="form-group"><label>Container</label><select id="f-container">${contOpts}</select></div>
    <div class="form-group"><label>Tags</label>
      <input type="text" id="f-tags" value="${esc((it.tags || []).join(', '))}" placeholder="merino, warm weather"></div>
    <div class="form-group"><label>Notes</label>
      <textarea id="f-notes" rows="2">${esc(it.notes || '')}</textarea></div>
    <div class="form-group"><label>Photo</label>
      <div class="photo-input-area">
        <div class="photo-preview" id="f-photo-preview">
          ${it.photoPath ? '<img id="f-photo-img">' : '📋'}
        </div>
        <div class="photo-btns">
          <button type="button" class="btn-sm" id="btn-photo-camera">📷 Camera</button>
          <button type="button" class="btn-sm" id="btn-photo-library">🖼 Library</button>
          ${it.photoPath ? '<button type="button" class="btn-sm danger" id="btn-photo-remove">Remove</button>' : ''}
        </div>
      </div>
    </div>`;
}

function openItemForm(itemId: string | null = null): void {
  const it: Partial<Item> = itemId ? (store.items.get(itemId) ?? {}) : {};
  openSheet(itemId ? 'Edit Item' : 'New Item', itemFormBody(it), () => saveItemForm(itemId));

  if (it.photoPath) {
    const img = $maybe('f-photo-img');
    if (img) lazyLoadPhoto(img, it.photoPath);
  }

  // Dynamic category value update
  $maybe('f-cat-group')?.addEventListener('change', e => {
    const sel = e.target as HTMLSelectElement;
    const valSel = $maybe('f-cat-value');
    if (valSel)
      valSel.innerHTML = (CATEGORIES[sel.value as keyof CategoriesMap] || CATEGORIES.misc)
        .map(v => `<option value="${v}">${v}</option>`)
        .join('');
  });

  setupSheetPhotoButtons(() => $('f-photo-preview'));
  $maybe('btn-photo-camera')?.addEventListener('click', () => triggerPhotoPicker('camera'));
  $maybe('btn-photo-library')?.addEventListener('click', () => triggerPhotoPicker('library'));
  $maybe('btn-photo-remove')?.addEventListener('click', () => {
    pendingPhoto.file = 'REMOVE';
    pendingPhoto.oldPath = it.photoPath ?? null;
    $('f-photo-preview').innerHTML = '📋';
  });
}

async function saveItemForm(existingId: string | null): Promise<void> {
  const name = $('f-name').value?.trim();
  if (!name) {
    showToast('Name is required', 'error');
    return;
  }

  const btn = $('btn-sheet-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const tagsRaw = $('f-tags').value || '';
    const tags = tagsRaw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const data: Record<string, unknown> = {
      name,
      category: {
        group: $('f-cat-group').value || 'misc',
        value: $('f-cat-value').value || 'other',
      },
      quantityOwned: parseInt($('f-qty-own').value ?? '1') || 1,
      quantityPackDefault: parseInt($('f-qty-pack').value ?? '1') || 1,
      containerId: $('f-container').value || null,
      tags,
      notes: $('f-notes').value?.trim() || '',
      updatedAt: serverTimestamp(),
    };

    const docRef = existingId ? doc(db, `${userPath()}/items/${existingId}`) : doc(itemsCol());
    const docId = docRef.id;

    if (pendingPhoto.file === 'REMOVE') {
      await deletePhotoIfExists(
        pendingPhoto.oldPath || (existingId ? store.items.get(existingId)?.photoPath : null),
      );
      data['photoPath'] = null;
    } else if (pendingPhoto.file) {
      await deletePhotoIfExists(existingId ? store.items.get(existingId)?.photoPath : null);
      const path = `${userPath()}/items/${docId}.jpg`;
      await resizeAndUpload(pendingPhoto.file, path);
      data['photoPath'] = path;
    } else {
      data['photoPath'] = existingId ? (store.items.get(existingId)?.photoPath ?? null) : null;
    }

    if (existingId) {
      await updateDoc(docRef, data);
      const existing = store.items.get(existingId);
      if (existing)
        store.items.set(existingId, { ...existing, ...data, updatedAt: serverTimestamp() } as Item);
    } else {
      data['createdAt'] = serverTimestamp();
      await setDoc(docRef, data);
      store.items.set(docId, {
        id: docId,
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as Item);
    }

    closeSheet();
    showToast(existingId ? 'Item updated' : 'Item added', 'success');
    if (currentView === 'items') applyItemFilters();
    else if (currentView === 'item') renderItemView(existingId || docId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error: ' + msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function deleteItem(itemId: string): Promise<void> {
  const it = store.items.get(itemId);
  if (!it) return;

  const batch = writeBatch(db);

  // 1. Delete item doc
  batch.delete(doc(db, `${userPath()}/items/${itemId}`));

  // 2. Cascade: remove from all lists
  store.listEntries.forEach((entries, listId) => {
    entries.forEach((entry, entryId) => {
      if (entry.itemId === itemId) {
        batch.delete(doc(db, `${userPath()}/lists/${listId}/entries/${entryId}`));
      }
    });
  });

  await batch.commit();

  // 3. Delete photo
  await deletePhotoIfExists(it.photoPath);

  // 4. Update local store
  store.items.delete(itemId);
  store.listEntries.forEach(entries => {
    [...entries.entries()].forEach(([eid, e]) => {
      if (e.itemId === itemId) entries.delete(eid);
    });
  });

  showToast('Item deleted', 'success');
  showView('items');
}

// ============================================================
//  LISTS — render list
// ============================================================
function renderListsView() {
  const stack = $('lists-stack');
  const empty = $('lists-empty');
  const lists = [...store.lists.values()];

  if (!lists.length) {
    stack.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  stack.innerHTML = lists
    .map(l => {
      const count = store.listEntries.get(l.id)?.size || 0;
      return `
      <div class="stack-card" data-action="open-list" data-id="${l.id}">
        <div class="stack-main">
          <div class="stack-name">${esc(l.name)} ${l.isEssential ? '<span class="essential-badge">Essential</span>' : ''}</div>
          <div class="stack-meta">${count} item${count !== 1 ? 's' : ''}</div>
        </div>
        <span style="color:var(--text-tertiary);font-size:20px">›</span>
      </div>`;
    })
    .join('');
}

$('btn-add-list').addEventListener('click', () => openListForm());

function openListForm(listId: string | null = null): void {
  const l: Partial<List> = listId ? (store.lists.get(listId) ?? {}) : {};
  const body = `
    <div class="form-group"><label>Name *</label>
      <input type="text" id="f-name" value="${esc(l.name || '')}" placeholder="e.g. Toiletry essentials" autocomplete="off"></div>
    <div class="toggle-row">
      <div><div class="toggle-label">Mark as Essential</div>
        <div style="font-size:12px;color:var(--text-secondary)">Pre-selected in Trip Planner</div></div>
      <button type="button" class="toggle${l.isEssential ? ' on' : ''}" id="f-essential"></button>
    </div>`;

  openSheet(listId ? 'Edit List' : 'New List', body, () => saveListForm(listId));

  $maybe('f-essential')?.addEventListener('click', e => {
    (e.currentTarget as HTMLElement).classList.toggle('on');
  });
}

async function saveListForm(existingId: string | null): Promise<void> {
  const name = $('f-name').value?.trim();
  if (!name) {
    showToast('Name is required', 'error');
    return;
  }
  const isEssential = $('f-essential').classList.contains('on') || false;

  const btn = $('btn-sheet-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const data: Record<string, unknown> = { name, isEssential, updatedAt: serverTimestamp() };
    if (existingId) {
      await updateDoc(doc(db, `${userPath()}/lists/${existingId}`), data);
      const existing = store.lists.get(existingId);
      if (existing)
        store.lists.set(existingId, { ...existing, ...data, updatedAt: serverTimestamp() } as List);
    } else {
      data['createdAt'] = serverTimestamp();
      const ref = await addDoc(listsCol(), data);
      store.lists.set(ref.id, {
        id: ref.id,
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as List);
      store.listEntries.set(ref.id, new Map());
    }
    closeSheet();
    showToast(existingId ? 'List updated' : 'List created', 'success');
    renderListsView();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error: ' + msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ============================================================
//  LIST DETAIL
// ============================================================
function renderListView(listId: string): void {
  if (!listId) return;
  const l = store.lists.get(listId);
  if (!l) {
    showView('lists');
    return;
  }
  $('header-title').textContent = l.name;

  const entries = store.listEntries.get(listId) ?? new Map<string, ListEntry>();
  const sorted = [...entries.values()].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  $('list-detail-content').innerHTML = `
    <div class="detail-section">
      <div class="detail-row">
        <span class="detail-label">Essential</span>
        <span class="detail-value">${l.isEssential ? '✅ Yes' : 'No'}</span>
      </div>
      <div class="detail-actions">
        <button class="btn-sm accent" data-action="edit-list" data-id="${listId}">Edit</button>
        <button class="btn-sm danger" data-action="delete-list" data-id="${listId}">Delete List</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>Items (${sorted.length})</h3>
      <div id="list-entries">
        ${sorted.map(e => renderListEntry(listId, e)).join('')}
        ${!sorted.length ? '<div style="color:var(--text-tertiary);font-size:14px;padding:8px 0">No items yet — tap Add Item below</div>' : ''}
      </div>
      <div style="margin-top:14px">
        <button class="btn-sm accent full-width" data-action="add-entry" data-id="${listId}">+ Add Item</button>
      </div>
    </div>`;
}

function renderListEntry(listId: string, entry: ListEntry): string {
  const it = store.items.get(entry.itemId);
  const name = it ? it.name : '(deleted item)';
  const cont = it ? containerName(it.containerId) : '';
  const qty = entry.quantityOverride ?? it?.quantityPackDefault ?? 1;
  return `
    <div class="entry-row" data-entry="${entry.id}" data-list="${listId}">
      <div class="entry-reorder">
        <button data-action="entry-up" data-list="${listId}" data-entry="${entry.id}" title="Move up">▲</button>
        <button data-action="entry-down" data-list="${listId}" data-entry="${entry.id}" title="Move down">▼</button>
      </div>
      <div style="flex:1;min-width:0">
        <div class="entry-name">${esc(name)}</div>
        ${cont ? `<div class="entry-container">${esc(cont)}</div>` : ''}
      </div>
      <input type="number" class="entry-qty-input" value="${qty}" min="0" inputmode="numeric"
        data-action="entry-qty" data-list="${listId}" data-entry="${entry.id}"
        style="width:52px;text-align:center;font-weight:700;color:var(--accent)">
      <button class="entry-del" data-action="delete-entry" data-list="${listId}" data-entry="${entry.id}" aria-label="Remove">×</button>
    </div>`;
}

function openAddEntrySheet(listId: string): void {
  const existingEntries = store.listEntries.get(listId) ?? new Map<string, ListEntry>();
  const existingIds = new Set([...existingEntries.values()].map(e => e.itemId));
  const available = [...store.items.values()].filter(it => !existingIds.has(it.id));

  if (!available.length) {
    showToast('All items already in this list', '');
    return;
  }

  const body = `
    <div class="form-group"><label>Search items</label>
      <input type="search" id="f-entry-search" placeholder="Type to filter…" autocomplete="off"></div>
    <div id="f-entry-list" class="stack" style="max-height:300px;overflow-y:auto">
      ${available
        .map(
          it => `
        <div class="item-row" data-action="pick-entry-item" data-item="${it.id}" data-list="${listId}" style="cursor:pointer">
          <div class="item-info">
            <div class="item-name">${esc(it.name)}</div>
            <div class="item-meta"><span class="tag">${esc(it.category?.value || '—')}</span><span>${esc(containerName(it.containerId))}</span></div>
          </div>
        </div>`,
        )
        .join('')}
    </div>`;

  openSheet('Add Item to List', body, () => {});
  ($('btn-sheet-save') as HTMLElement).style.display = 'none';

  $maybe('f-entry-search')?.addEventListener('input', e => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    document
      .querySelectorAll<HTMLElement>('#f-entry-list [data-action="pick-entry-item"]')
      .forEach(row => {
        const name = row.querySelector('.item-name')?.textContent?.toLowerCase() ?? '';
        row.style.display = name.includes(q) ? '' : 'none';
      });
  });
}

async function addEntryToList(listId: string, itemId: string): Promise<void> {
  const entries = store.listEntries.get(listId) ?? new Map<string, ListEntry>();
  const maxOrder = [...entries.values()].reduce((m, e) => Math.max(m, e.sortOrder || 0), 0);
  const data: Record<string, unknown> = {
    itemId,
    quantityOverride: null,
    sortOrder: maxOrder + 1000,
    addedAt: serverTimestamp(),
  };
  const ref = await addDoc(entriesCol(listId), data);
  entries.set(ref.id, { id: ref.id, ...data, addedAt: serverTimestamp() } as ListEntry);
  store.listEntries.set(listId, entries);
  closeSheet();
  renderListView(listId);
  showToast('Item added to list', 'success');
}

async function removeEntryFromList(listId: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, `${userPath()}/lists/${listId}/entries/${entryId}`));
  store.listEntries.get(listId)?.delete(entryId);
  renderListView(listId);
}

async function reorderListEntry(
  listId: string,
  entryId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const entries = store.listEntries.get(listId);
  if (!entries) return;
  const sorted = [...entries.values()].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const idx = sorted.findIndex(e => e.id === entryId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;

  const a = sorted[idx]!;
  const b = sorted[swapIdx]!;
  const newAOrder = b.sortOrder;
  const newBOrder = a.sortOrder;

  const batch = writeBatch(db);
  batch.update(doc(db, `${userPath()}/lists/${listId}/entries/${a.id}`), { sortOrder: newAOrder });
  batch.update(doc(db, `${userPath()}/lists/${listId}/entries/${b.id}`), { sortOrder: newBOrder });
  await batch.commit();
  a.sortOrder = newAOrder;
  b.sortOrder = newBOrder;
  renderListView(listId);
}

async function updateEntryQty(
  listId: string,
  entryId: string,
  qty: string | number,
): Promise<void> {
  const entry = store.listEntries.get(listId)?.get(entryId);
  if (!entry) return;
  const val = parseInt(String(qty)) || 1;
  await updateDoc(doc(db, `${userPath()}/lists/${listId}/entries/${entryId}`), {
    quantityOverride: val,
  });
  entry.quantityOverride = val;
}

async function deleteList(listId: string): Promise<void> {
  const entries = store.listEntries.get(listId) ?? new Map<string, ListEntry>();
  const batch = writeBatch(db);
  entries.forEach((_, eid) =>
    batch.delete(doc(db, `${userPath()}/lists/${listId}/entries/${eid}`)),
  );
  batch.delete(doc(db, `${userPath()}/lists/${listId}`));
  await batch.commit();
  store.lists.delete(listId);
  store.listEntries.delete(listId);
  showToast('List deleted', 'success');
  showView('lists');
}

// ============================================================
//  TRIP PLANNER
// ============================================================
let tripWeatherData: TripWeatherData | null = null;
let tripAIResult: TripAIResult | null = null;

function renderTripView() {
  tripActivities.clear();
  $('trip-content').innerHTML = `
    <div class="trip-form">
      <h3>Plan a Trip</h3>
      <div class="form-group"><label>Destination</label>
        <input type="text" id="trip-dest" placeholder="e.g. Cozumel, Mexico" autocomplete="off"></div>
      <div class="form-row">
        <div class="form-group"><label>Month</label>
          <select id="trip-month">
            ${MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Duration</label>
          <input type="text" id="trip-duration" placeholder="e.g. 2 weeks"></div>
      </div>
      <div class="form-group"><label>Activities</label>
        <div class="activity-grid">
          ${ACTIVITIES.map(a => `<button type="button" class="activity-btn" data-activity="${a}">${a}</button>`).join('')}
        </div>
      </div>
      <div class="form-group"><label>Extra notes</label>
        <textarea id="trip-notes" rows="2" placeholder="e.g. formal dinner on day 3, kids coming"></textarea></div>
    </div>

    <!-- Essential lists toggle -->
    <div class="trip-form" style="margin-bottom:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">Include packing lists</div>
      <div id="trip-list-toggles" style="display:flex;flex-wrap:wrap;gap:8px">
        ${[...store.lists.values()]
          .map(
            l => `
          <button type="button" class="chip${l.isEssential ? ' active' : ''}" data-action="toggle-list" data-id="${l.id}">${esc(l.name)}</button>
        `,
          )
          .join('')}
        ${!store.lists.size ? '<span style="color:var(--text-tertiary);font-size:13px">No lists yet</span>' : ''}
      </div>
    </div>

    <!-- Candidate items -->
    <div class="candidates-panel">
      <button class="candidates-toggle" id="btn-candidates-toggle">
        <span>Items to consider (${store.items.size} selected)</span>
        <span id="candidates-arrow">▼</span>
      </button>
      <div id="candidates-body" class="candidates-body hidden"></div>
    </div>

    <button id="btn-generate" class="btn-primary" style="margin-top:16px">Get Packing List</button>
    <div id="trip-results"></div>`;

  // Preset month to next month
  const nextMonth = (new Date().getMonth() + 1) % 12;
  $('trip-month').value = String(nextMonth);

  // Init all items as candidates
  tripCandidates.clear();
  store.items.forEach((_, id) => tripCandidates.set(id, true));

  buildCandidatesPanel();

  $('btn-candidates-toggle').addEventListener('click', () => {
    const body = $('candidates-body');
    const arrow = $('candidates-arrow');
    const open = !body.classList.contains('hidden');
    body.classList.toggle('hidden', open);
    arrow.textContent = open ? '▼' : '▲';
  });

  $('btn-generate').addEventListener('click', runTripPlanner);
}

function buildCandidatesPanel(): void {
  const body = $('candidates-body');
  const groups: Record<string, Item[]> = {};
  store.items.forEach(it => {
    const g = it.category?.group || 'misc';
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(it);
  });
  body.innerHTML = Object.entries(groups)
    .map(
      ([g, its]) => `
    <div class="candidate-group-title">${g}</div>
    ${its
      .map(
        it => `
      <div class="candidate-item">
        <input type="checkbox" id="cand-${it.id}" ${tripCandidates.get(it.id) ? 'checked' : ''}>
        <label for="cand-${it.id}">${esc(it.name)}</label>
        <span style="font-size:12px;color:var(--text-tertiary)">${esc(containerName(it.containerId))}</span>
      </div>`,
      )
      .join('')}
  `,
    )
    .join('');

  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      const inp = e.currentTarget as HTMLInputElement;
      const id = inp.id.replace('cand-', '');
      tripCandidates.set(id, inp.checked);
      updateCandidateCount();
    });
  });
}

function updateCandidateCount(): void {
  const count = [...tripCandidates.values()].filter(Boolean).length;
  const toggle = $('btn-candidates-toggle');
  const span = toggle.querySelector('span');
  if (span) span.textContent = `Items to consider (${count} selected)`;
}

async function runTripPlanner(): Promise<void> {
  const dest = $('trip-dest').value?.trim();
  if (!dest) {
    showToast('Please enter a destination', 'error');
    return;
  }
  if (!getApiKey()) {
    showToast('Add your Anthropic API key in Settings first', 'error');
    return;
  }

  const btn = $('btn-generate');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching weather…';
  $('trip-results').innerHTML = '';
  tripWeatherData = null;
  tripAIResult = null;

  try {
    // Step 1: Geocode
    const loc = await geocode(dest);

    // Step 2: Historical weather for selected month
    const monthIdx = parseInt($('trip-month').value ?? '0');
    tripWeatherData = await fetchTripWeather(loc, monthIdx);
    const { avgHigh, avgLow, totalPrecip, rainyDays } = tripWeatherData;

    // Step 3: Render weather card immediately
    renderWeatherCard(tripWeatherData);

    btn.textContent = '🤖 Generating recommendations…';

    // Step 4: Build inventory for prompt
    const selectedItems = [...store.items.values()].filter(it => tripCandidates.get(it.id));
    const inventory = inventoryFromItems(selectedItems, containerName, formatCat);

    const weatherSummary =
      avgHigh !== null
        ? `Avg high ${avgHigh}°C, avg low ${avgLow}°C, ~${totalPrecip}mm rain, ${rainyDays} rainy days in ${MONTHS[monthIdx]}`
        : 'Weather data unavailable';

    const userMsg = buildUserMessage({
      destination: loc.name,
      country: loc.country,
      duration: $('trip-duration')?.value?.trim() || 'unspecified duration',
      monthName: MONTHS[monthIdx] ?? '',
      weatherSummary,
      activities: [...tripActivities].join(', ') || 'General travel',
      extraNotes: $('trip-notes')?.value?.trim() || '',
      inventory,
    });

    const rawAI = await callAI(userMsg, SYSTEM_PROMPT, getApiKey());

    // Step 5: Parse
    const knownIds = new Set(store.items.keys());
    let parsed: TripAIResult;
    try {
      parsed = parseAIResponse(rawAI, knownIds);
    } catch (cause) {
      throw new Error('AI returned unexpected format. Try again.', { cause });
    }
    tripAIResult = parsed;

    // Step 6: Render results
    renderTripResults(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(msg, 'error', 5000);
    $('trip-results').innerHTML =
      `<div class="detail-section" style="color:var(--danger)">${esc(msg)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Packing List';
  }
}

function renderWeatherCard(w: TripWeatherData): void {
  const icon =
    (w.totalPrecip ?? 0) > 40 || (w.rainyDays ?? 0) > 10
      ? '🌧'
      : (w.avgHigh ?? 0) >= 28
        ? '☀️'
        : (w.avgHigh ?? 0) >= 18
          ? '⛅'
          : '🌥';
  const results = $('trip-results');
  results.innerHTML = `
    <div class="weather-card">
      <div class="weather-icon">${icon}</div>
      <div class="weather-info">
        <div class="weather-place">${esc(w.place)}, ${esc(w.country)}</div>
        <div class="weather-month">${w.monthName} (historical avg)</div>
        <div class="weather-stats">
          ${w.avgHigh !== null ? `<span class="weather-stat"><strong>${w.avgHigh}°C</strong> high</span>` : ''}
          ${w.avgLow !== null ? `<span class="weather-stat"><strong>${w.avgLow}°C</strong> low</span>` : ''}
          ${w.rainyDays !== null ? `<span class="weather-stat"><strong>${w.rainyDays}</strong> rainy days</span>` : ''}
        </div>
      </div>
    </div>
    <div style="text-align:center;color:var(--text-tertiary);font-size:14px;padding:12px">Generating packing list…</div>`;
}

function renderTripResults(parsed: TripAIResult): void {
  const results = $('trip-results');
  const weatherHTML = results.querySelector('.weather-card')?.outerHTML || '';

  // Group by container
  const byContainer: Record<string, PackingItem[]> = {};
  (parsed.packingList || []).forEach(r => {
    const key = r.container || 'Unassigned';
    if (!byContainer[key]) byContainer[key] = [];
    byContainer[key]!.push(r);
  });

  const packHTML = Object.entries(byContainer)
    .map(
      ([cont, items]) => `
    <div class="results-section">
      <div class="results-section-header">📦 ${esc(cont)}</div>
      ${items
        .map(
          r => `
        <div class="result-row">
          <span class="result-qty">×${r.quantity}</span>
          <div class="result-main">
            <div class="result-name">${esc(r.itemName)}</div>
            ${r.reason ? `<div class="result-reason">${esc(r.reason)}</div>` : ''}
          </div>
        </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('');

  const missingHTML = parsed.missingEssentials?.length
    ? `
    <div class="results-section">
      <div class="results-section-header" style="color:#856404;background:#FFF9E6">🛒 Consider buying</div>
      ${parsed.missingEssentials
        .map(
          m => `
        <div class="result-row">
          <div class="result-main">
            <div class="result-name">${esc(m.name)}</div>
            <div class="result-sub">${esc(m.suggestion)}</div>
          </div>
        </div>`,
        )
        .join('')}
    </div>`
    : '';

  const weatherNoteHTML = parsed.weatherNotes
    ? `
    <div class="detail-section" style="background:var(--accent-faint);border:1px solid var(--accent-light)">
      <p style="font-size:14px;color:var(--accent)">${esc(parsed.weatherNotes)}</p>
    </div>`
    : '';

  results.innerHTML = `
    ${weatherHTML}
    ${weatherNoteHTML}
    <div class="trip-results">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn-sm accent" id="btn-save-trip-list">💾 Save as List</button>
      </div>
      ${packHTML}
      ${missingHTML}
    </div>`;

  $maybe('btn-save-trip-list')?.addEventListener('click', () => saveTripAsList());
}

async function saveTripAsList(): Promise<void> {
  if (!tripAIResult) return;
  const dest = $('trip-dest').value?.trim() || 'Trip';
  const month = MONTHS[parseInt($('trip-month').value ?? '0')] ?? '';
  const name = `${dest} — ${month}`;

  try {
    const listRef = await addDoc(listsCol(), {
      name,
      isEssential: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const listId = listRef.id;
    store.lists.set(listId, {
      id: listId,
      name,
      isEssential: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const entriesMap = new Map<string, ListEntry>();
    store.listEntries.set(listId, entriesMap);

    const batch = writeBatch(db);
    let order = 1000;
    (tripAIResult.packingList || []).forEach(r => {
      const eRef = doc(entriesCol(listId));
      const entry: Record<string, unknown> = {
        itemId: r.itemId,
        quantityOverride: r.quantity || null,
        sortOrder: order,
        addedAt: serverTimestamp(),
      };
      batch.set(eRef, entry);
      entriesMap.set(eRef.id, { id: eRef.id, ...entry, addedAt: serverTimestamp() } as ListEntry);
      order += 1000;
    });
    await batch.commit();

    showToast(`Saved as "${name}"`, 'success');
    viewStack = [];
    showView('list', { id: listId, title: name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error saving list: ' + msg, 'error');
  }
}

// ============================================================
//  SETTINGS
// ============================================================
function renderSettingsView() {
  const key = getApiKey();
  $('settings-content').innerHTML = `
    <div class="settings-group">
      <div class="settings-group-title">AI</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="settings-row-label">Anthropic API Key</div>
        <div class="settings-row-sub">Stored only on this device. Never synced.</div>
        <input type="password" id="settings-api-key" value="${esc(key)}" placeholder="sk-ant-…" autocomplete="off">
        <button class="btn-sm accent" id="btn-save-key">Save Key</button>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">AI Model</div>
          <div class="settings-row-sub" style="font-family:monospace;font-size:12px">${AI_MODEL}</div>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Data</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="settings-row-label">Import from CSV</div>
        <div class="settings-row-sub">Bulk add items from a spreadsheet export</div>
        <div class="btn-row">
          <button class="btn-sm" id="btn-import-csv">📂 Choose CSV File</button>
          <button class="btn-sm" id="btn-csv-template">⬇ Download Template</button>
        </div>
        <div id="csv-import-area" style="width:100%"></div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Account</div>
      <div class="settings-row">
        <div class="settings-row-label">${esc(store.user?.email || '')}</div>
      </div>
      <div class="settings-row">
        <button class="btn-danger full-width" id="btn-logout">Sign Out</button>
      </div>
    </div>

    <div style="text-align:center;color:var(--text-tertiary);font-size:12px;padding:24px 0">
      Packrat v0.3 · <a href="https://github.com" target="_blank">Source</a>
    </div>`;

  $maybe('btn-save-key')?.addEventListener('click', () => {
    const val = $('settings-api-key').value?.trim() ?? '';
    setApiKey(val);
    showToast(val ? 'API key saved' : 'API key cleared', 'success');
  });

  $('btn-logout')?.addEventListener('click', () => {
    showConfirm('Sign out of Packrat?', () => signOut(auth), 'Sign Out');
    $('btn-confirm-ok').textContent = 'Sign Out';
    $('btn-confirm-ok').className = 'btn-ghost';
  });

  $('btn-import-csv')?.addEventListener('click', () => {
    $('file-csv').click();
  });

  $('btn-csv-template')?.addEventListener('click', downloadCSVTemplate);
}

function downloadCSVTemplate() {
  const headers =
    'name,category_group,category_value,quantity_owned,quantity_pack_default,container_name,tags,notes';
  const example =
    '"Black merino t-shirt",clothing,tops,3,2,"Osprey carry-on","merino,warm weather",""';
  const blob = new Blob([headers + '\n' + example], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'packrat-template.csv';
  a.click();
}

// ============================================================
//  CSV IMPORT
// ============================================================
$('file-csv').addEventListener('change', async e => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text);
  renderCSVPreview(rows);
});

function renderCSVPreview(rows: CSVRow[]): void {
  const area = $('csv-import-area');
  if (!area) return;
  if (!rows.length) {
    area.innerHTML =
      '<p style="color:var(--danger);font-size:13px">No valid rows found. Check CSV format.</p>';
    return;
  }

  const preview = rows.slice(0, 5);
  area.innerHTML = `
    <div style="font-size:13px;color:var(--text-secondary);margin:8px 0">${rows.length} item${rows.length !== 1 ? 's' : ''} found · showing first ${preview.length}</div>
    <div style="overflow-x:auto;margin-bottom:10px">
      <table class="csv-preview-table">
        <tr><th>Name</th><th>Category</th><th>Qty</th><th>Container</th><th>Tags</th></tr>
        ${preview
          .map(
            r => `
          <tr>
            <td>${esc(r['name'])}</td>
            <td>${esc((r['category_group'] || '') + '/' + (r['category_value'] || ''))}</td>
            <td>${esc(r['quantity_owned'] || '1')}</td>
            <td>${esc(r['container_name'] || '—')}</td>
            <td>${esc(r['tags'] || '')}</td>
          </tr>`,
          )
          .join('')}
      </table>
    </div>
    <button class="btn-sm accent" id="btn-confirm-import">Import ${rows.length} Items</button>
    <button class="btn-sm" id="btn-cancel-import" style="margin-left:8px">Cancel</button>`;

  $maybe('btn-cancel-import')?.addEventListener('click', () => {
    area.innerHTML = '';
  });
  $maybe('btn-confirm-import')?.addEventListener('click', () => runCSVImport(rows));
}

async function runCSVImport(rows: CSVRow[]): Promise<void> {
  const btn = $maybe('btn-confirm-import');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing…';
  }

  let added = 0,
    skipped = 0,
    unmatched = 0;
  // Build container name → id map (case-insensitive)
  const contNameMap = new Map(
    [...store.containers.values()].map(c => [c.name.toLowerCase(), c.id]),
  );

  // Chunk into batches of 400 (leave headroom)
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const group = (r['category_group']?.toLowerCase() || 'misc') as keyof CategoriesMap;
      const value = r['category_value']?.toLowerCase() || 'other';
      if (!CATEGORIES[group]) {
        skipped++;
        return;
      }
      const tags = r['tags']
        ? r['tags']
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        : [];
      let containerId: string | null = null;
      if (r['container_name']) {
        containerId = contNameMap.get(r['container_name'].toLowerCase()) || null;
        if (!containerId) unmatched++;
      }
      const newRef = doc(itemsCol());
      const data: Record<string, unknown> = {
        name: r['name'],
        category: { group, value },
        quantityOwned: parseInt(r['quantity_owned'] ?? '1') || 1,
        quantityPackDefault:
          parseInt(r['quantity_pack_default'] ?? '') || parseInt(r['quantity_owned'] ?? '1') || 1,
        containerId,
        photoPath: null,
        tags,
        notes: r['notes'] || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(newRef, data);
      store.items.set(newRef.id, {
        id: newRef.id,
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as Item);
      added++;
    });
    await batch.commit();
  }

  const area = $('csv-import-area');
  if (area)
    area.innerHTML = `<div style="padding:12px;background:var(--accent-faint);border-radius:8px;font-size:13px;color:var(--accent)">
    ✅ Imported ${added} items${skipped ? `, ${skipped} skipped (invalid category)` : ''}${unmatched ? `, ${unmatched} container names not matched (set to Unassigned)` : ''}
  </div>`;

  showToast(`${added} items imported`, 'success');
}

// ============================================================
//  EVENT DELEGATION (dynamic content)
// ============================================================
document.addEventListener('click', async e => {
  const src = e.target as HTMLElement | null;
  const target = src?.closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset['action'];
  const id = target.dataset['id'] ?? '';

  switch (action) {
    case 'open-container':
      showView('container', { id });
      break;
    case 'open-item':
      showView('item', { id });
      break;
    case 'open-list':
      showView('list', { id });
      break;
    case 'edit-container':
      openContainerForm(id);
      break;
    case 'edit-item':
      openItemForm(id);
      break;
    case 'edit-list':
      openListForm(id);
      break;
    case 'delete-container':
      showConfirm(
        `Delete "${store.containers.get(id)?.name}"? Items inside will be unassigned.`,
        async () => {
          await deleteContainer(id);
          renderContainersView();
          showView('containers');
        },
      );
      break;
    case 'delete-item':
      showConfirm(
        `Delete "${store.items.get(id)?.name}"? It will be removed from all packing lists.`,
        () => deleteItem(id),
      );
      break;
    case 'delete-list':
      showConfirm(`Delete list "${store.lists.get(id)?.name}"?`, () => deleteList(id));
      break;
    case 'add-entry':
      openAddEntrySheet(id);
      break;
    case 'pick-entry-item': {
      const listId = target.dataset['list'] ?? '';
      const itemId = target.dataset['item'] ?? '';
      await addEntryToList(listId, itemId);
      break;
    }
    case 'delete-entry': {
      const listId = target.dataset['list'] ?? '';
      const entryId = target.dataset['entry'] ?? '';
      await removeEntryFromList(listId, entryId);
      break;
    }
    case 'entry-up': {
      const listId = target.dataset['list'] ?? '';
      await reorderListEntry(listId, target.dataset['entry'] ?? '', 'up');
      break;
    }
    case 'entry-down': {
      const listId = target.dataset['list'] ?? '';
      await reorderListEntry(listId, target.dataset['entry'] ?? '', 'down');
      break;
    }
    case 'toggle-list': {
      target.classList.toggle('active');
      break;
    }
  }
});

// Qty input for list entries (blur to save)
document.addEventListener('change', async e => {
  const src = e.target as HTMLElement | null;
  const inp = src?.closest<HTMLInputElement>('[data-action="entry-qty"]');
  if (!inp) return;
  await updateEntryQty(inp.dataset['list'] ?? '', inp.dataset['entry'] ?? '', inp.value);
});

// ============================================================
//  INIT — show login placeholder until auth resolves
// ============================================================
showView('login', {}, { replace: true });
