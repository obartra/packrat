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
  PackingItem,
  MonthlyClimate,
  Trip,
  InferenceResult,
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
  createTrip,
  updateTrip,
  renameTrip,
  deleteTrip,
  saveUserActivities,
} from './store';
import {
  pendingPhoto,
  resizeAndUpload,
  uploadBlob,
  lazyLoadPhoto,
  deletePhotoIfExists,
  triggerPhotoPicker,
  setupSheetPhotoButtons,
  setPhotoPickerCallback,
} from './photos';
import { generateThumbDataUrl, resizeBlobPng } from './images';
import { removePhotoBackground } from './bg-removal';
import { showToast } from './ui/toast';
import { showConfirm } from './ui/confirm';
import { openSheet, closeSheet, setOnSheetClose } from './ui/sheet';
import {
  CATEGORIES,
  CONTAINER_TYPES,
  MONTHS,
  ACTIVITIES,
  CONTAINER_ICONS,
  iconForCategory,
  AI_MODEL,
  AI_API_URL,
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
import {
  tripSlug,
  tripDisplayName,
  formatMonthsLabel,
  timestampMillis,
  isAIOutdated,
  staleItemIds,
  weatherEmoji,
  staticMapUrl,
  compareTripsDesc,
  validateStep,
  canJumpToStep,
  snapshotDraft as makeSnapshot,
  spannedMonths,
  durationToDays,
  formatDuration,
  formatTemp,
  formatRainyDays,
  mapTileUrl,
  type TripDraftSnapshot,
} from './trips';
import { geocode, fetchYearClimate, aggregateMonths, type GeoLocation } from './weather';
import { callAI, SYSTEM_PROMPT, buildUserMessage, inventoryFromItems, parseAIResponse } from './ai';
import { downsampleForInference, callInferenceAPI } from './inference';

// ============================================================
//  FORM STATE (local to this module)
// ============================================================
let currentItemFilter = '';
let currentColorFilter = '';
type ItemsGrouping = 'category' | 'container';
const ITEMS_GROUPING_KEY = 'packrat_items_grouping';
let itemsGrouping: ItemsGrouping =
  localStorage.getItem(ITEMS_GROUPING_KEY) === 'container' ? 'container' : 'category';
type ItemsViewMode = 'list' | 'grid';
const ITEMS_VIEW_KEY = 'packrat_items_view';
let itemsViewMode: ItemsViewMode =
  localStorage.getItem(ITEMS_VIEW_KEY) === 'grid' ? 'grid' : 'list';

// Inference lifecycle
let inferenceRequestId = 0;
let inferenceAbort: AbortController | null = null;
let bgRemovalBlob: Blob | null = null;

// ============================================================
//  UTILITY
// ============================================================
const formatCat = (cat: Category | null | undefined): string =>
  cat ? `${cat.group} / ${cat.value}` : '—';
const itemCount = (cid: string | null): number =>
  [...store.items.values()].filter(it => it.containerId === cid).length;
const containerName = (cid: string | null): string =>
  cid ? (store.containers.get(cid)?.name ?? 'Unknown') : 'Unassigned';
const categoryValueOptions = (group: string): string =>
  (CATEGORIES[group as keyof CategoriesMap] || CATEGORIES.misc)
    .map(v => `<option value="${v}">${v}</option>`)
    .join('');

function getApiKey(): string {
  return localStorage.getItem('packrat_anthropic_key') || '';
}
function setApiKey(k: string): void {
  localStorage.setItem('packrat_anthropic_key', k);
}

type TempUnit = 'celsius' | 'fahrenheit';
const TEMP_UNIT_KEY = 'packrat_units';
const LAST_CONTAINER_KEY = 'packrat_last_container';

const THUMB_BG_KEY = 'packrat_thumb_bg';
const THUMB_BACKGROUNDS: Record<string, { label: string; css: string }> = {
  wood: {
    label: 'Wood',
    css: 'linear-gradient(135deg, #deb887 0%, #c8a87a 25%, #d4a574 50%, #c2956b 75%, #deb887 100%)',
  },
  'dark-wood': {
    label: 'Dark wood',
    css: 'linear-gradient(135deg, #5c3d2e 0%, #6b4735 25%, #5a3828 50%, #6b4735 75%, #5c3d2e 100%)',
  },
  marble: {
    label: 'Marble',
    css: 'linear-gradient(135deg, #f0ece4 0%, #e8e0d4 30%, #f2ede5 50%, #e5ddd0 70%, #f0ece4 100%)',
  },
  metal: {
    label: 'Metal',
    css: 'linear-gradient(135deg, #c0c0c0 0%, #d8d8d8 25%, #b8b8b8 50%, #d0d0d0 75%, #c0c0c0 100%)',
  },
  slate: {
    label: 'Slate',
    css: 'linear-gradient(135deg, #4a5568 0%, #576475 25%, #3d4a5c 50%, #576475 75%, #4a5568 100%)',
  },
  none: { label: 'None', css: 'var(--border-light)' },
};
function getThumbBg(): string {
  return localStorage.getItem(THUMB_BG_KEY) || 'wood';
}
function getThumbBgCss(): string {
  return THUMB_BACKGROUNDS[getThumbBg()]?.css ?? THUMB_BACKGROUNDS['wood']!.css;
}

function getTempUnit(): TempUnit {
  return localStorage.getItem(TEMP_UNIT_KEY) === 'fahrenheit' ? 'fahrenheit' : 'celsius';
}
function setTempUnit(u: TempUnit): void {
  localStorage.setItem(TEMP_UNIT_KEY, u);
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
    setupListeners();
    // Navigate immediately — never block on Firestore. A slow or failing
    // data fetch used to trap users on the login screen with the button
    // stuck on "…". Views render from the store and re-render below once
    // loadAllData completes.
    const match = urlToRoute(initialPath);
    showView(match.name, match.id ? { id: match.id } : {}, { replace: true });
    try {
      await loadAllData();
      // Re-render current view with the freshly loaded data.
      showView(currentView, currentViewParams, { replace: true });
    } catch (err) {
      console.error('loadAllData failed', err);
      showToast('Could not load your data — check your connection.', 'error', 4000);
    }
  } else {
    teardownListeners();
    clearStore();
    setBeforeLeave(null); // clear any wizard guard so logout can always proceed
    showView('login', {}, { replace: true });
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
let currentViewParams: ViewParams = {};
let viewStack: ViewName[] = [];

/**
 * Hook that can block navigation away from the current view.
 * Returns true to allow the transition, false to cancel. Currently used by
 * the trip wizard in edit mode to confirm discarding unsaved changes.
 */
let beforeLeaveHook: (() => boolean) | null = null;

export function setBeforeLeave(hook: (() => boolean) | null): void {
  beforeLeaveHook = hook;
}

function showView(name: ViewName, params: ViewParams = {}, opts: ShowViewOpts = {}): void {
  // Navigation guard — give the current view a chance to cancel (e.g. confirm
  // unsaved changes). `fromHistory` + `replace` skip the hook to avoid loops.
  if (beforeLeaveHook && !opts.fromHistory && !opts.replace && currentView !== name) {
    const canLeave = beforeLeaveHook();
    if (!canLeave) return;
    beforeLeaveHook = null;
  }

  // Authenticated users can't navigate to /login — redirect to containers
  // so the URL and UI stay consistent (chrome visible, data shown).
  if (name === 'login' && store.user) {
    name = 'containers';
    params = {};
    opts = { ...opts, fromHistory: false, replace: true };
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $maybe(`view-${name}`);
  if (el) el.classList.add('active');
  currentView = name;
  currentViewParams = params;

  // Sync URL with view (unless this call was triggered by a history event)
  if (!opts.fromHistory) {
    const url = routeToUrl(name, params);
    if (opts.replace || url === window.location.pathname) {
      window.history.replaceState({ name, params }, '', url);
    } else {
      window.history.pushState({ name, params }, '', url);
    }
  }

  // App chrome is visible on every view except login
  const isLogin = name === 'login';
  $('app-header').classList.toggle('hidden', isLogin);
  $('bottom-nav').classList.toggle('hidden', isLogin);

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
    case 'trips':
      renderTripsView();
      break;
    case 'trip':
      if (params.id) renderTripDetailView(params.id);
      break;
    case 'trip-wizard':
      renderTripWizardView();
      break;
    case 'trip-edit':
      if (params.id) renderTripEditView(params.id);
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

// Re-render the current view when units preference changes so temperature
// labels update without requiring a navigation.
window.addEventListener('packrat:units-changed', () => {
  if (currentView === 'trips') renderTripsView();
  else if (currentView === 'trip') {
    const state = window.history.state as { params?: { id?: string } } | null;
    const id = state?.params?.id;
    if (id) renderTripDetailView(id);
  }
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
            c.photoThumb
              ? `<img src="${c.photoThumb}" alt="${esc(c.name)}">`
              : c.photoPath
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
      data['photoThumb'] = null;
    } else if (pendingPhoto.file) {
      await deletePhotoIfExists(existingId ? store.containers.get(existingId)?.photoPath : null);
      const path = `${userPath()}/containers/${docId}.jpg`;
      const { thumb } = await resizeAndUpload(pendingPhoto.file, path);
      data['photoPath'] = path;
      data['photoThumb'] = thumb;
    } else {
      data['photoPath'] = existingId ? (store.containers.get(existingId)?.photoPath ?? null) : null;
      data['photoThumb'] = existingId ? (store.containers.get(existingId)?.photoThumb ?? null) : null;
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
  // Group-by segmented control
  document.querySelectorAll<HTMLElement>('.group-by-row .segment').forEach(btn => {
    btn.classList.toggle('active', btn.dataset['group'] === itemsGrouping);
  });
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
        (it.description || '').toLowerCase().includes(search) ||
        (it.color || '').toLowerCase().includes(search) ||
        (it.tags || []).some(t => t.toLowerCase().includes(search)),
    );
  if (cFilter) items = items.filter(it => it.containerId === cFilter);
  if (catFilter) items = items.filter(it => it.category?.group === catFilter);
  if (currentColorFilter) items = items.filter(it => it.color === currentColorFilter);

  // Color swatches — derived from all items (before color filter) so user can pick
  renderColorChips();

  // Update view toggle icon
  updateViewToggleIcon();

  const content = $('items-list-content');
  const emptyEl = $('items-empty');

  if (!items.length) {
    content.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  const isGrid = itemsViewMode === 'grid';

  // Group by selected mode (category.group or container)
  const groupKeyOf = (it: Item): string =>
    itemsGrouping === 'container' ? containerName(it.containerId) : it.category?.group || 'misc';

  const groups: Record<string, Item[]> = {};
  items.forEach(it => {
    const k = groupKeyOf(it);
    if (!groups[k]) groups[k] = [];
    groups[k]!.push(it);
  });

  // Stable group ordering
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (itemsGrouping === 'category') {
      const cats = Object.keys(CATEGORIES);
      return cats.indexOf(a) - cats.indexOf(b);
    }
    // Container mode: alphabetical, Unassigned last
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  const labelFor = (k: string): string =>
    itemsGrouping === 'category' ? k.charAt(0).toUpperCase() + k.slice(1) : k;

  const renderFn = isGrid ? renderItemGridCell : renderItemRow;
  const wrapClass = isGrid ? 'item-grid' : 'stack';

  content.innerHTML = sortedKeys
    .map(
      k => `
    <div class="group-header">${esc(labelFor(k))} <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0">(${groups[k]!.length})</span></div>
    <div class="${wrapClass}" style="margin-bottom:4px">
      ${groups[k]!.map(it => renderFn(it)).join('')}
    </div>
  `,
    )
    .join('');

  content
    .querySelectorAll<HTMLImageElement>('img[data-photo]')
    .forEach(img => lazyLoadPhoto(img, img.dataset['photo']));
}

function renderItemRow(it: Item): string {
  const icon = iconForCategory(it.category?.group, it.category?.value);
  const useNobg = !!it.photoNobgThumb && getThumbBg() !== 'none';
  const thumbSrc = useNobg ? it.photoNobgThumb : it.photoThumb;
  const thumbBg = useNobg ? `background:${getThumbBgCss()}` : '';
  return `
    <div class="item-row" data-action="open-item" data-id="${it.id}">
      <div class="item-thumb"${thumbBg ? ` style="${thumbBg}"` : ''}>
        ${thumbSrc ? `<img src="${thumbSrc}" alt="${esc(it.name)}"${useNobg ? ' class="nobg-thumb"' : ''}>` : it.photoPath ? `<img data-photo="${esc(it.photoPath)}" alt="${esc(it.name)}">` : `<span>${icon}</span>`}
      </div>
      <div class="item-info">
        <div class="item-name">${it.color ? `<span class="color-dot" style="background:${esc(it.color)}"></span> ` : ''}${esc(it.name)}</div>
        <div class="item-meta">
          <span class="tag">${esc(it.category?.value || '—')}</span>
          ${it.containerId ? `<span>${esc(containerName(it.containerId))}</span>` : '<span style="color:var(--text-tertiary)">Unassigned</span>'}
        </div>
      </div>
      <span class="item-qty">${it.quantityOwned || 1}</span>
    </div>`;
}

function renderItemGridCell(it: Item): string {
  const icon = iconForCategory(it.category?.group, it.category?.value);
  const useNobg = !!it.photoNobgThumb && getThumbBg() !== 'none';
  const thumbSrc = useNobg ? it.photoNobgThumb : it.photoThumb;
  const thumbBg = useNobg ? `background:${getThumbBgCss()}` : '';
  return `
    <div class="item-grid-cell" data-action="open-item" data-id="${it.id}">
      <div class="item-grid-photo"${thumbBg ? ` style="${thumbBg}"` : ''}>
        ${thumbSrc ? `<img src="${thumbSrc}" alt="${esc(it.name)}"${useNobg ? ' class="nobg-thumb"' : ''}>` : it.photoPath ? `<img data-photo="${esc(it.photoPath)}" alt="${esc(it.name)}">` : `<span>${icon}</span>`}
      </div>
      <div class="item-grid-name">${esc(it.name)}</div>
    </div>`;
}

function renderColorChips(): void {
  const el = $maybe('items-color-chips');
  if (!el) return;
  const allColors = [
    ...new Set(
      [...store.items.values()]
        .map(it => it.color)
        .filter((c): c is string => !!c && c.startsWith('#')),
    ),
  ].sort();
  if (!allColors.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML =
    `<span class="chip color-chip-all${!currentColorFilter ? ' active' : ''}" data-color="">All</span>` +
    allColors
      .map(
        c =>
          `<span class="color-chip${currentColorFilter === c ? ' active' : ''}" data-color="${esc(c)}" title="${esc(c)}" style="background:${esc(c)}"></span>`,
      )
      .join('');
}

const VIEW_ICON_GRID = '<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="11" y="1" width="6" height="6" rx="1"/><rect x="1" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>';
const VIEW_ICON_LIST = '<line x1="1" y1="3" x2="17" y2="3"/><line x1="1" y1="9" x2="17" y2="9"/><line x1="1" y1="15" x2="17" y2="15"/>';

function updateViewToggleIcon(): void {
  const svg = $maybe('view-toggle-icon');
  if (svg) svg.innerHTML = itemsViewMode === 'list' ? VIEW_ICON_GRID : VIEW_ICON_LIST;
}

$('btn-add-item').addEventListener('click', () => openItemForm());

$('items-search').addEventListener('input', applyItemFilters);
$('items-filter-container').addEventListener('change', applyItemFilters);

// Group-by segmented control
document.querySelectorAll<HTMLElement>('.group-by-row .segment').forEach(btn => {
  btn.addEventListener('click', () => {
    const g = btn.dataset['group'] as ItemsGrouping;
    if (g !== itemsGrouping) {
      itemsGrouping = g;
      localStorage.setItem(ITEMS_GROUPING_KEY, g);
      document.querySelectorAll<HTMLElement>('.group-by-row .segment').forEach(b => {
        b.classList.toggle('active', b.dataset['group'] === g);
      });
      applyItemFilters();
    }
  });
});

$('btn-view-toggle').addEventListener('click', () => {
  itemsViewMode = itemsViewMode === 'list' ? 'grid' : 'list';
  localStorage.setItem(ITEMS_VIEW_KEY, itemsViewMode);
  applyItemFilters();
});

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
  // Color filter
  const colorEl = target?.closest<HTMLElement>('[data-color]');
  if (colorEl && colorEl.closest('#items-color-chips')) {
    currentColorFilter = colorEl.dataset['color'] ?? '';
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
          : `<div class="no-photo"><div class="no-photo-icon-lg">${iconForCategory(it.category?.group, it.category?.value)}</div><span>No photo</span></div>`
      }
    </div>
    <div class="detail-section">
      ${it.description ? `<div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${esc(it.description)}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${esc(formatCat(it.category))}</span></div>
      ${it.color ? `<div class="detail-row"><span class="detail-label">Color</span><span class="detail-value"><span class="color-dot" style="background:${esc(it.color)}"></span> ${esc(it.color)}</span></div>` : ''}
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

  // When the stored group is missing or unknown, the browser falls back to the
  // first <option> in the group dropdown — align the category values with that
  // same default so the two selects never disagree on first render.
  const firstGroupKey = Object.keys(CATEGORIES)[0] as keyof CategoriesMap;
  const valOpts = (g: string | undefined): string => {
    const key = (g && g in CATEGORIES ? g : firstGroupKey) as keyof CategoriesMap;
    return CATEGORIES[key]
      .map(v => `<option value="${v}" ${it.category?.value === v ? 'selected' : ''}>${v}</option>`)
      .join('');
  };

  const selectedContainer = it.containerId ?? localStorage.getItem(LAST_CONTAINER_KEY) ?? '';
  const contOpts =
    '<option value="">Unassigned</option>' +
    [...store.containers.values()]
      .map(
        c =>
          `<option value="${c.id}" ${selectedContainer === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
      )
      .join('');

  return `
    <div class="form-group"><label>Photo</label>
      <div class="photo-input-area">
        <div class="photo-preview" id="f-photo-preview">
          ${it.photoPath ? '<img id="f-photo-img">' : iconForCategory(it.category?.group, it.category?.value)}
        </div>
        <div class="photo-btns">
          <button type="button" class="btn-sm" id="btn-photo-camera">📷 Camera</button>
          <button type="button" class="btn-sm" id="btn-photo-library">🖼 Library</button>
          ${it.photoPath ? '<button type="button" class="btn-sm danger" id="btn-photo-remove">Remove</button>' : ''}
        </div>
      </div>
      <div class="inference-status hidden" id="f-inference-status" aria-live="polite">Analyzing photo...</div>
    </div>
    <div class="form-group"><label>Name *</label>
      <input type="text" id="f-name" value="${esc(it.name || '')}" placeholder="e.g. Black merino t-shirt" autocomplete="off"></div>
    <div class="form-group"><label>Description</label>
      <textarea id="f-description" rows="2" placeholder="AI-generated description...">${esc(it.description || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Group</label>
        <select id="f-cat-group">${groupOpts}</select></div>
      <div class="form-group"><label>Category</label>
        <select id="f-cat-value">${valOpts(it.category?.group)}</select></div>
    </div>
    <div class="form-group"><label>Color</label>
      <div class="color-input-row">
        <div class="color-swatch" id="f-color-swatch" style="background:${esc(it.color || '#ccc')}"></div>
        <input type="text" id="f-color" value="${esc(it.color || '')}" placeholder="#000000" maxlength="7">
      </div>
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
      <textarea id="f-notes" rows="2">${esc(it.notes || '')}</textarea></div>`;
}

function openItemForm(itemId: string | null = null): void {
  const it: Partial<Item> = itemId ? (store.items.get(itemId) ?? {}) : {};
  openSheet(itemId ? 'Edit Item' : 'New Item', itemFormBody(it), () => saveItemForm(itemId));

  if (it.photoPath) {
    const img = $maybe('f-photo-img');
    if (img) lazyLoadPhoto(img, it.photoPath);
  }

  // --- Touched-field tracking ---
  const touchedFields = new Set<string>();
  if (itemId && it.id) {
    if (it.name) touchedFields.add('name');
    if (it.description) touchedFields.add('description');
    if (it.category?.group) touchedFields.add('category');
    if (it.color) touchedFields.add('color');
    if (it.tags?.length) touchedFields.add('tags');
  }

  const trackTouch = (id: string, field: string): void => {
    const el = $maybe(id);
    if (!el) return;
    el.addEventListener('input', () => touchedFields.add(field));
    el.addEventListener('change', () => touchedFields.add(field));
  };
  trackTouch('f-name', 'name');
  trackTouch('f-description', 'description');
  trackTouch('f-cat-group', 'category');
  trackTouch('f-cat-value', 'category');
  trackTouch('f-color', 'color');
  trackTouch('f-tags', 'tags');

  // Update color swatch on manual input
  $maybe('f-color')?.addEventListener('input', () => {
    const val = ($maybe('f-color') as HTMLInputElement | null)?.value || '';
    const swatch = $maybe('f-color-swatch');
    if (swatch) (swatch as HTMLElement).style.background = val || '#ccc';
  });

  // Dynamic category value update
  $maybe('f-cat-group')?.addEventListener('change', e => {
    const sel = e.target as HTMLSelectElement;
    const valSel = $maybe('f-cat-value');
    if (valSel) valSel.innerHTML = categoryValueOptions(sel.value);
  });

  // --- Shared inference helpers ---
  function applyInferenceResult(result: InferenceResult): void {
    if (!touchedFields.has('name') && result.name) {
      const el = $maybe('f-name') as HTMLInputElement | null;
      if (el) el.value = result.name;
    }
    if (!touchedFields.has('description') && result.description) {
      const el = $maybe('f-description') as HTMLTextAreaElement | null;
      if (el) el.value = result.description;
    }
    if (!touchedFields.has('category') && result.categoryGroup) {
      const groupSel = $maybe('f-cat-group') as HTMLSelectElement | null;
      if (groupSel) {
        groupSel.value = result.categoryGroup;
        const valSel = $maybe('f-cat-value') as HTMLSelectElement | null;
        if (valSel) {
          valSel.innerHTML = categoryValueOptions(result.categoryGroup!);
          if (result.categoryValue) valSel.value = result.categoryValue;
        }
      }
    }
    if (!touchedFields.has('color') && result.color) {
      const el = $maybe('f-color') as HTMLInputElement | null;
      if (el) el.value = result.color;
      const swatch = $maybe('f-color-swatch');
      if (swatch) (swatch as HTMLElement).style.background = result.color;
    }
    if (!touchedFields.has('tags') && result.tags?.length) {
      const el = $maybe('f-tags') as HTMLInputElement | null;
      if (el) el.value = result.tags.join(', ');
    }
  }

  let inferenceBase64: string | null = null;
  let reInferTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCorrectionKey = '';

  function gatherCorrections(): Record<string, string> | null {
    const c: Record<string, string> = {};
    if (touchedFields.has('name')) {
      const v = ($maybe('f-name') as HTMLInputElement | null)?.value?.trim();
      if (v) c['Name'] = v;
    }
    if (touchedFields.has('description')) {
      const v = ($maybe('f-description') as HTMLTextAreaElement | null)?.value?.trim();
      if (v) c['Description'] = v;
    }
    if (touchedFields.has('category')) {
      const g = ($maybe('f-cat-group') as HTMLSelectElement | null)?.value;
      const v = ($maybe('f-cat-value') as HTMLSelectElement | null)?.value;
      if (g) c['Category'] = v ? `${g} > ${v}` : g;
    }
    if (touchedFields.has('color')) {
      const v = ($maybe('f-color') as HTMLInputElement | null)?.value?.trim();
      if (v) c['Color'] = v;
    }
    if (touchedFields.has('tags')) {
      const v = ($maybe('f-tags') as HTMLInputElement | null)?.value?.trim();
      if (v) c['Tags'] = v;
    }
    return Object.keys(c).length > 0 ? c : null;
  }

  function scheduleReInference(): void {
    if (!inferenceBase64) return;
    const apiKey = getApiKey();
    if (!apiKey) return;

    if (reInferTimer) clearTimeout(reInferTimer);
    reInferTimer = setTimeout(() => {
      const corrections = gatherCorrections();
      if (!corrections) return;

      const key = JSON.stringify(corrections);
      if (key === lastCorrectionKey) return;
      lastCorrectionKey = key;

      if (inferenceAbort) inferenceAbort.abort();
      const requestId = ++inferenceRequestId;
      inferenceAbort = new AbortController();
      const timeoutId = setTimeout(() => inferenceAbort?.abort(), 10_000);

      const statusEl = $maybe('f-inference-status');
      if (statusEl) {
        statusEl.textContent = 'Re-analyzing…';
        statusEl.classList.remove('hidden');
      }

      callInferenceAPI(inferenceBase64!, apiKey, inferenceAbort.signal, corrections)
        .then(result => {
          clearTimeout(timeoutId);
          if (requestId !== inferenceRequestId) return;
          applyInferenceResult(result);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          if (err instanceof DOMException && err.name === 'AbortError') return;
        })
        .finally(() => {
          if (requestId === inferenceRequestId) {
            const statusEl = $maybe('f-inference-status');
            if (statusEl) statusEl.classList.add('hidden');
          }
        });
    }, 800);
  }

  // Blur on text/textarea fields triggers re-inference
  for (const id of ['f-name', 'f-description', 'f-color', 'f-tags']) {
    $maybe(id)?.addEventListener('blur', scheduleReInference);
  }
  // Select changes trigger re-inference directly (selects don't blur predictably)
  $maybe('f-cat-group')?.addEventListener('change', scheduleReInference);
  $maybe('f-cat-value')?.addEventListener('change', scheduleReInference);

  // --- Cancel inference on sheet close ---
  setOnSheetClose(() => {
    if (inferenceAbort) {
      inferenceAbort.abort();
      inferenceAbort = null;
    }
    if (reInferTimer) clearTimeout(reInferTimer);
    bgRemovalBlob = null;
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  });

  // --- Photo picker with inference ---
  let previewObjectUrl: string | null = null;
  setPhotoPickerCallback((file: File) => {
    // Standard preview behavior
    pendingPhoto.file = file;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    const prev = $maybe('f-photo-preview');
    if (prev) {
      prev.innerHTML = `<img src="${previewObjectUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    }

    // Cancel any in-flight inference
    if (inferenceAbort) inferenceAbort.abort();

    // Start background removal in parallel (fire and forget)
    bgRemovalBlob = null;
    removePhotoBackground(file)
      .then(blob => {
        // Only store if this photo is still the pending one
        if (pendingPhoto.file === file) bgRemovalBlob = blob;
      })
      .catch(() => {
        /* bg removal is best-effort */
      });

    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('Add your Anthropic API key in Settings to auto-fill from photos', '');
      return;
    }

    const requestId = ++inferenceRequestId;
    inferenceAbort = new AbortController();
    const timeoutId = setTimeout(() => inferenceAbort?.abort(), 10_000);

    const statusEl = $maybe('f-inference-status');
    if (statusEl) {
      statusEl.textContent = 'Analyzing photo…';
      statusEl.classList.remove('hidden');
    }

    downsampleForInference(file)
      .then(base64 => {
        inferenceBase64 = base64;
        return callInferenceAPI(base64, apiKey, inferenceAbort!.signal);
      })
      .then(result => {
        clearTimeout(timeoutId);
        if (requestId !== inferenceRequestId) return;
        applyInferenceResult(result);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === 'AbortError') return;
        showToast('Photo analysis failed — fill fields manually', 'error');
      })
      .finally(() => {
        if (requestId === inferenceRequestId) {
          const statusEl = $maybe('f-inference-status');
          if (statusEl) statusEl.classList.add('hidden');
        }
      });
  });

  $maybe('btn-photo-camera')?.addEventListener('click', () => triggerPhotoPicker('camera'));
  $maybe('btn-photo-library')?.addEventListener('click', () => triggerPhotoPicker('library'));
  $maybe('btn-photo-remove')?.addEventListener('click', () => {
    pendingPhoto.file = 'REMOVE';
    pendingPhoto.oldPath = it.photoPath ?? null;
    $('f-photo-preview').innerHTML = iconForCategory(it.category?.group, it.category?.value);
    inferenceBase64 = null;
    bgRemovalBlob = null;
    if (inferenceAbort) {
      inferenceAbort.abort();
      inferenceAbort = null;
    }
    if (reInferTimer) clearTimeout(reInferTimer);
    const statusEl = $maybe('f-inference-status');
    if (statusEl) statusEl.classList.add('hidden');
  });
}

async function saveItemForm(existingId: string | null): Promise<void> {
  // Cancel any in-flight inference
  if (inferenceAbort) {
    inferenceAbort.abort();
    inferenceAbort = null;
  }

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
      color: ($maybe('f-color') as HTMLInputElement | null)?.value?.trim() || null,
      description: ($maybe('f-description') as HTMLTextAreaElement | null)?.value?.trim() || null,
      tags,
      notes: $('f-notes').value?.trim() || '',
      updatedAt: serverTimestamp(),
    };

    const selectedContainerId = data['containerId'] as string | null;
    if (selectedContainerId) {
      localStorage.setItem(LAST_CONTAINER_KEY, selectedContainerId);
    }

    const docRef = existingId ? doc(db, `${userPath()}/items/${existingId}`) : doc(itemsCol());
    const docId = docRef.id;

    if (pendingPhoto.file === 'REMOVE') {
      await deletePhotoIfExists(
        pendingPhoto.oldPath || (existingId ? store.items.get(existingId)?.photoPath : null),
      );
      const oldNobg = existingId ? store.items.get(existingId)?.photoNobgPath : null;
      await deletePhotoIfExists(oldNobg);
      data['photoPath'] = null;
      data['photoThumb'] = null;
      data['photoNobgPath'] = null;
      data['photoNobgThumb'] = null;
    } else if (pendingPhoto.file) {
      await deletePhotoIfExists(existingId ? store.items.get(existingId)?.photoPath : null);
      const oldNobg = existingId ? store.items.get(existingId)?.photoNobgPath : null;
      await deletePhotoIfExists(oldNobg);
      const path = `${userPath()}/items/${docId}.jpg`;
      const { thumb } = await resizeAndUpload(pendingPhoto.file, path);
      data['photoPath'] = path;
      data['photoThumb'] = thumb;
      // Use bg removal result if ready
      if (bgRemovalBlob) {
        const nobgPath = `${userPath()}/items/${docId}_nobg.png`;
        const resizedNobg = await resizeBlobPng(bgRemovalBlob, 1400);
        const nobgThumb = await generateThumbDataUrl(resizedNobg, 80, 'image/png');
        await uploadBlob(resizedNobg, nobgPath, 'image/png');
        data['photoNobgPath'] = nobgPath;
        data['photoNobgThumb'] = nobgThumb;
      } else {
        data['photoNobgPath'] = null;
        data['photoNobgThumb'] = null;
      }
    } else {
      data['photoPath'] = existingId ? (store.items.get(existingId)?.photoPath ?? null) : null;
      data['photoThumb'] = existingId ? (store.items.get(existingId)?.photoThumb ?? null) : null;
      data['photoNobgPath'] = existingId ? (store.items.get(existingId)?.photoNobgPath ?? null) : null;
      data['photoNobgThumb'] = existingId ? (store.items.get(existingId)?.photoNobgThumb ?? null) : null;
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
//  TRIP UTILITIES (shared by index / detail / wizard)
// ============================================================
function debounce<F extends (...args: never[]) => unknown>(fn: F, ms: number): F {
  let timer: number | undefined;
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  }) as F;
}

function resolvedActivities(): string[] {
  return store.userActivities ?? ACTIVITIES;
}

/** Which itemIds from the AI result no longer exist in the inventory. */
function staleItemIdsIn(trip: Trip): string[] {
  return staleItemIds(trip.aiResult?.packingList, new Set(store.items.keys()));
}

/** True when the trip's inputs have been edited since AI was last generated. */
function isTripAIOutdated(trip: Trip): boolean {
  if (!trip.aiResult || !trip.aiGeneratedAt) return false;
  return isAIOutdated(timestampMillis(trip.updatedAt), timestampMillis(trip.aiGeneratedAt));
}

// ============================================================
//  TRIPS INDEX
// ============================================================
function renderTripsView(): void {
  const stack = $('trips-stack');
  const empty = $('trips-empty');
  const trips = [...store.trips.values()].sort(compareTripsDesc);

  if (!trips.length) {
    stack.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const unit = getTempUnit();
  stack.innerHTML = trips
    .map(t => {
      const status = !t.aiResult
        ? `<span class="trip-status trip-status--none">No recommendations yet</span>`
        : staleItemIdsIn(t).length
          ? `<span class="trip-status trip-status--warn">Inventory changed</span>`
          : isTripAIOutdated(t)
            ? `<span class="trip-status trip-status--warn">Outdated</span>`
            : `<span class="trip-status trip-status--ok">Ready</span>`;
      const activitiesLine = t.activities.length
        ? ` · ${esc(t.activities.slice(0, 3).join(', '))}`
        : '';
      const durationStr = formatDuration(t.durationCount, t.durationUnit);
      const mapImg = t.location
        ? `<img class="trip-card-map" src="${esc(mapTileUrl(t.location.latitude, t.location.longitude))}" alt="" loading="lazy">`
        : `<div class="trip-card-map trip-card-map--empty">📍</div>`;
      let weatherChip = '';
      if (t.yearClimate) {
        const tMonths = spannedMonths({
          startMonth: t.startMonth,
          startYear: t.startYear,
          durationCount: t.durationCount,
          durationUnit: t.durationUnit,
        });
        const days = durationToDays(t.durationCount, t.durationUnit);
        const agg = aggregateMonths(t.yearClimate, tMonths, days);
        const icon = weatherEmoji(agg.avgHigh, agg.totalPrecip, agg.rainyDays);
        const rainy = formatRainyDays(agg.rainyDays, days);
        weatherChip = `<div class="trip-card-weather">${icon} ${agg.avgHigh !== null ? `<strong>${formatTemp(agg.avgHigh, unit)}</strong>` : ''} ${rainy !== '—' ? `· ${esc(rainy)}` : ''}</div>`;
      }
      return `
      <div class="stack-card trip-card" data-action="open-trip" data-id="${t.id}">
        ${mapImg}
        <div class="stack-main">
          <div class="stack-name">${esc(t.name)}</div>
          <div class="stack-meta">${esc(t.location?.name ?? t.destination)} · ${esc(durationStr)}${activitiesLine}</div>
          ${weatherChip}
          <div style="margin-top:4px">${status}</div>
        </div>
        <span style="color:var(--text-tertiary);font-size:20px">›</span>
      </div>`;
    })
    .join('');
}

$('btn-add-trip').addEventListener('click', () => {
  showView('trip-wizard');
});

// ============================================================
//  TRIP DETAIL
// ============================================================
function renderTripDetailView(tripId: string): void {
  const trip = store.trips.get(tripId);
  if (!trip) {
    showView('trips');
    return;
  }
  $('header-title').textContent = trip.name;

  const content = $('trip-detail-content');
  const hasKey = !!getApiKey();
  const stale = staleItemIdsIn(trip);
  const outdated = isTripAIOutdated(trip);

  const tripMonths = spannedMonths({
    startMonth: trip.startMonth,
    startYear: trip.startYear,
    durationCount: trip.durationCount,
    durationUnit: trip.durationUnit,
  });
  const totalDays = durationToDays(trip.durationCount, trip.durationUnit);
  const durationStr = formatDuration(trip.durationCount, trip.durationUnit);
  const unit = getTempUnit();

  const header = `
    <div class="detail-section">
      <div style="font-weight:700;font-size:18px;font-family:'DM Serif Display',serif;margin-bottom:4px">${esc(trip.name)}</div>
      <div style="color:var(--text-secondary);font-size:14px">${esc(trip.location?.name ?? trip.destination)} · ${esc(formatMonthsLabel(tripMonths))} ${trip.startYear} · ${esc(durationStr)}</div>
      ${trip.activities.length ? `<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${trip.activities.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div>` : ''}
      <div class="detail-actions" style="margin-top:12px">
        <button class="btn-sm accent" data-action="edit-trip" data-id="${tripId}">Edit</button>
        ${
          trip.aiResult
            ? `<button class="btn-sm" data-action="regenerate-trip" data-id="${tripId}">Regenerate</button>`
            : ''
        }
        ${
          trip.aiResult
            ? `<button class="btn-sm" data-action="save-trip-as-list" data-id="${tripId}">Save as list</button>`
            : ''
        }
        <button class="btn-sm danger" data-action="delete-trip" data-id="${tripId}">Delete</button>
      </div>
    </div>`;

  // Weather card
  const weather = trip.yearClimate
    ? aggregateMonths(trip.yearClimate, tripMonths, totalDays)
    : null;
  const rainyStr = weather ? formatRainyDays(weather.rainyDays, totalDays) : '—';
  const weatherCard = weather
    ? `<div class="climate-summary" style="margin-bottom:12px">
        <div class="climate-icon">${weatherEmoji(weather.avgHigh, weather.totalPrecip, weather.rainyDays)}</div>
        <div class="climate-info">
          <div class="climate-place">${esc(weather.monthName)} ${trip.startYear}</div>
          <div class="climate-stats">
            ${weather.avgHigh !== null ? `<span><strong>${formatTemp(weather.avgHigh, unit)}</strong> high</span>` : ''}
            ${weather.avgLow !== null ? `<span><strong>${formatTemp(weather.avgLow, unit)}</strong> low</span>` : ''}
          </div>
          <div class="climate-stats climate-stats--sub">
            ${rainyStr !== '—' ? `<span>${rainyStr}</span>` : ''}
            ${weather.cloudCoverPct !== null ? `<span>${weather.cloudCoverPct}% cloud</span>` : ''}
            ${weather.humidityPct !== null ? `<span>${weather.humidityPct}% humidity</span>` : ''}
          </div>
        </div>
      </div>`
    : '';

  // No recommendations yet
  if (!trip.aiResult) {
    content.innerHTML = `
      ${header}
      ${weatherCard}
      <div class="detail-section" style="text-align:center;padding:24px">
        <div style="font-size:15px;color:var(--text-secondary);margin-bottom:12px">
          No recommendations yet.
        </div>
        <button class="btn-primary" id="btn-generate-trip" data-id="${tripId}">
          ${hasKey ? 'Generate recommendations' : 'Add API key in Settings'}
        </button>
      </div>`;
    $maybe('btn-generate-trip')?.addEventListener('click', () => {
      if (hasKey) regenerateTripRecs(tripId);
      else showView('settings');
    });
    return;
  }

  // Has aiResult — render packing list
  const staleBanner = stale.length
    ? `<div class="detail-section" style="background:#FFF3CD;border:1px solid #FFE08A;font-size:13px;color:#856404">⚠️ ${stale.length} recommended item${stale.length === 1 ? '' : 's'} no longer in inventory</div>`
    : '';
  const outdatedBanner = outdated
    ? `<div class="detail-section" style="background:#FFF3CD;border:1px solid #FFE08A;font-size:13px;color:#856404">⚠️ Inputs changed since last generation — regenerate for fresh recommendations</div>`
    : '';

  const byContainer: Record<string, PackingItem[]> = {};
  trip.aiResult.packingList.forEach(p => {
    const key = p.container || 'Unassigned';
    if (!byContainer[key]) byContainer[key] = [];
    byContainer[key]!.push(p);
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

  const missingHTML = trip.aiResult.missingEssentials?.length
    ? `<div class="results-section">
        <div class="results-section-header" style="color:#856404;background:#FFF9E6">🛒 Consider buying</div>
        ${trip.aiResult.missingEssentials
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

  const weatherNoteHTML = trip.aiResult.weatherNotes
    ? `<div class="detail-section" style="background:var(--accent-faint);border:1px solid var(--accent-light)">
        <p style="font-size:14px;color:var(--accent)">${esc(trip.aiResult.weatherNotes)}</p>
      </div>`
    : '';

  content.innerHTML = `
    ${header}
    ${weatherCard}
    ${staleBanner}
    ${outdatedBanner}
    ${weatherNoteHTML}
    ${packHTML}
    ${missingHTML}`;
}

async function regenerateTripRecs(tripId: string): Promise<void> {
  const trip = store.trips.get(tripId);
  if (!trip) return;
  const key = getApiKey();
  if (!key) {
    showView('settings');
    showToast('Add your Anthropic API key to generate recommendations', '');
    return;
  }
  if (!trip.location || !trip.yearClimate) {
    showToast('Trip is missing location or climate data; try editing it', 'error');
    return;
  }

  showToast('Generating recommendations…', '');
  const tripMonths = spannedMonths({
    startMonth: trip.startMonth,
    startYear: trip.startYear,
    durationCount: trip.durationCount,
    durationUnit: trip.durationUnit,
  });
  const totalDays = durationToDays(trip.durationCount, trip.durationUnit);
  const agg = aggregateMonths(trip.yearClimate, tripMonths, totalDays);
  const candidateItems = trip.candidateItemIds
    .map(id => store.items.get(id))
    .filter((it): it is Item => !!it);
  const inventory = inventoryFromItems(candidateItems, containerName, formatCat);
  const weatherSummary =
    agg.avgHigh !== null
      ? `Avg high ${agg.avgHigh}°C, avg low ${agg.avgLow}°C, ~${agg.totalPrecip}mm rain, ${agg.rainyDays} rainy days during ${agg.monthName} ${trip.startYear}`
      : 'Weather data unavailable';

  const userMsg = buildUserMessage({
    destination: trip.location.name,
    country: trip.location.country,
    duration: formatDuration(trip.durationCount, trip.durationUnit),
    monthName: `${agg.monthName} ${trip.startYear}`,
    weatherSummary,
    activities: trip.activities.join(', ') || 'General travel',
    extraNotes: trip.notes,
    inventory,
  });

  try {
    const raw = await callAI(userMsg, SYSTEM_PROMPT, key);
    const knownIds = new Set(store.items.keys());
    const parsed = parseAIResponse(raw, knownIds);
    await updateTrip(tripId, {
      aiResult: parsed,
      aiGeneratedAt: serverTimestamp(),
    });
    showToast('Recommendations updated', 'success');
    renderTripDetailView(tripId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error: ' + msg, 'error', 5000);
  }
}

async function saveTripAsList(tripId: string): Promise<void> {
  const trip = store.trips.get(tripId);
  if (!trip?.aiResult) return;

  try {
    const listRef = await addDoc(listsCol(), {
      name: trip.name,
      isEssential: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const listId = listRef.id;
    store.lists.set(listId, {
      id: listId,
      name: trip.name,
      isEssential: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const entriesMap = new Map<string, ListEntry>();
    store.listEntries.set(listId, entriesMap);

    const batch = writeBatch(db);
    let order = 1000;
    trip.aiResult.packingList.forEach(r => {
      if (!store.items.has(r.itemId)) return; // skip stale
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

    showToast(`Saved as "${trip.name}"`, 'success');
    showView('list', { id: listId, title: trip.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error saving list: ' + msg, 'error');
  }
}

async function deleteTripConfirm(tripId: string): Promise<void> {
  const trip = store.trips.get(tripId);
  if (!trip) return;
  showConfirm(`Delete "${trip.name}"?`, async () => {
    await deleteTrip(tripId);
    showToast('Trip deleted', 'success');
    showView('trips');
  });
}

// ============================================================
//  TRIP WIZARD (create-only)
// ============================================================
interface TripDraft {
  name: string;
  nameUserEdited: boolean;
  destination: string;
  location: GeoLocation | null;
  locationError: string | null;
  startMonth: number;
  startYear: number;
  durationCount: number;
  durationUnit: 'days' | 'weeks' | 'months';
  activities: string[];
  notes: string;
  candidateItemIds: string[];
  yearClimate: MonthlyClimate[] | null;
}

let wizardDraft: TripDraft | null = null;
let wizardStep: 1 | 2 | 3 = 1;
let wizardLocationAbort: AbortController | null = null;

function snapshotDraft(d: TripDraft): string {
  const forSnapshot: TripDraftSnapshot = {
    destination: d.destination,
    location: d.location,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
    activities: d.activities,
    notes: d.notes,
    candidateItemIds: d.candidateItemIds,
    name: d.name,
  };
  return makeSnapshot(forSnapshot);
}

function renderTripWizardView(): void {
  wizardStep = 1;
  const year = new Date().getFullYear();
  const thisMonth = new Date().getMonth();
  wizardDraft = {
    name: '',
    nameUserEdited: false,
    destination: '',
    location: null,
    locationError: null,
    startMonth: thisMonth,
    startYear: year,
    durationCount: 7,
    durationUnit: 'days',
    activities: [],
    notes: '',
    candidateItemIds: [...store.items.keys()],
    yearClimate: null,
  };
  // No exit guard for create-mode wizard (nothing persisted to lose).
  setBeforeLeave(null);
  renderWizardFrame();
}

function renderWizardFrame(): void {
  $('header-title').textContent = 'New trip';
  const root = $('trip-wizard-content');
  root.innerHTML = `
    <div class="wizard-left">
      <div class="wizard-progress" role="tablist">
        ${[1, 2, 3]
          .map(
            i =>
              `<button type="button" role="tab" class="wizard-dot${i === wizardStep ? ' active' : ''}${i < wizardStep ? ' done' : ''}" data-step="${i}" aria-selected="${i === wizardStep}">${['Where?', 'When?', 'What?'][i - 1]}</button>`,
          )
          .join('')}
      </div>
      <div id="wizard-step-body"></div>
      <div class="wizard-nav">
        <button type="button" class="btn-ghost" id="wizard-back"${wizardStep === 1 ? ' disabled' : ''}>Back</button>
        <button type="button" class="btn-primary" id="wizard-next">
          ${wizardStep < 3 ? 'Next' : 'Save trip'}
        </button>
      </div>
    </div>
    <aside class="wizard-right">
      <div class="wizard-right-label">Preview</div>
      <div id="wizard-preview"></div>
    </aside>`;

  renderWizardStep();
  $('wizard-back').addEventListener('click', () => {
    if (wizardStep > 1) {
      wizardStep = (wizardStep - 1) as 1 | 2 | 3;
      renderWizardFrame();
    }
  });
  $('wizard-next').addEventListener('click', () => {
    if (!wizardDraft) return;
    const result = validateStep(wizardStep, wizardDraft);
    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }
    if (wizardStep < 3) {
      wizardStep = (wizardStep + 1) as 1 | 2 | 3;
      renderWizardFrame();
    } else {
      void saveWizardTrip();
    }
  });
  // Clickable step dots
  document.querySelectorAll<HTMLElement>('.wizard-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      if (!wizardDraft) return;
      const target = parseInt(dot.dataset['step'] ?? '0', 10) as 1 | 2 | 3;
      if (target === wizardStep || target < 1 || target > 3) return;
      const can = canJumpToStep(target, wizardStep, wizardDraft);
      if (!can.ok) {
        showToast(can.error, 'error');
        return;
      }
      wizardStep = target;
      renderWizardFrame();
    });
  });
}

function renderWizardStep(): void {
  if (!wizardDraft) return;
  const body = $('wizard-step-body');
  if (wizardStep === 1) body.innerHTML = renderStep1(wizardDraft);
  else if (wizardStep === 2) body.innerHTML = renderStep2(wizardDraft);
  else body.innerHTML = renderStep3(wizardDraft);
  wireStepInputs();
  renderWizardPreview();
}

function renderStep1(d: TripDraft): string {
  return `
    <h2 class="wizard-heading">Where are you going?</h2>
    <div class="form-group">
      <label>Destination</label>
      <input type="text" id="w-dest" value="${esc(d.destination)}" placeholder="e.g. Cozumel, Mexico" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Trip name</label>
      <input type="text" id="w-name" value="${esc(d.name)}" placeholder="Auto-generated as you fill this out">
    </div>`;
}

function renderStep2(d: TripDraft): string {
  return `
    <h2 class="wizard-heading">When?</h2>
    ${renderDateFields(d, 'w')}`;
}

/** Shared date-inputs block used by wizard step 2 AND the edit form. */
function renderDateFields(d: TripDraft, prefix: string): string {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  const monthOptions = MONTHS.map(
    (m, i) => `<option value="${i}"${i === d.startMonth ? ' selected' : ''}>${m}</option>`,
  ).join('');
  const yearOptions = years
    .map(y => `<option value="${y}"${y === d.startYear ? ' selected' : ''}>${y}</option>`)
    .join('');
  const units: Array<[string, string]> = [
    ['days', 'days'],
    ['weeks', 'weeks'],
    ['months', 'months'],
  ];
  const unitOptions = units
    .map(
      ([v, label]) =>
        `<option value="${v}"${v === d.durationUnit ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
  const months = spannedMonths({
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
  });
  const monthsLabel = formatMonthsLabel(months);
  const totalDays = durationToDays(d.durationCount, d.durationUnit);
  const hint =
    monthsLabel && totalDays > 0 ? `Covers ${monthsLabel} ${d.startYear} (≈${totalDays} days)` : '';

  return `
    <div class="form-group">
      <label>Start</label>
      <div class="form-row">
        <select id="${prefix}-start-month" class="date-select">${monthOptions}</select>
        <select id="${prefix}-start-year" class="date-select">${yearOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label>Duration</label>
      <div class="form-row">
        <input type="number" id="${prefix}-dur-count" class="date-input" value="${d.durationCount}" min="1" max="365" style="max-width:100px">
        <select id="${prefix}-dur-unit" class="date-select">${unitOptions}</select>
      </div>
      <div class="form-hint">${esc(hint)}</div>
    </div>`;
}

function renderStep3(d: TripDraft): string {
  const activityList = resolvedActivities();
  const actChips = activityList
    .map(
      a =>
        `<button type="button" class="activity-btn${d.activities.includes(a) ? ' selected' : ''}" data-activity="${esc(a)}">${esc(a)}</button>`,
    )
    .join('');
  const candidateGroups: Record<string, Item[]> = {};
  store.items.forEach(it => {
    const g = it.category?.group || 'misc';
    if (!candidateGroups[g]) candidateGroups[g] = [];
    candidateGroups[g]!.push(it);
  });
  const candidatesHTML = Object.entries(candidateGroups)
    .map(
      ([g, its]) => `
      <div class="candidate-group-title">${g}</div>
      ${its
        .map(
          it => `
        <div class="candidate-item">
          <input type="checkbox" id="w-cand-${it.id}" data-cand="${it.id}" ${d.candidateItemIds.includes(it.id) ? 'checked' : ''}>
          <label for="w-cand-${it.id}">${esc(it.name)}</label>
          <span style="font-size:12px;color:var(--text-tertiary)">${esc(containerName(it.containerId))}</span>
        </div>`,
        )
        .join('')}`,
    )
    .join('');

  return `
    <h2 class="wizard-heading">What are you doing?</h2>
    <div class="form-group">
      <label>Activities</label>
      <div class="activity-grid">${actChips}</div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="w-notes" rows="3" placeholder="e.g. formal dinner on day 3">${esc(d.notes)}</textarea>
    </div>
    <div class="candidates-panel" style="margin:0">
      <button class="candidates-toggle" id="w-cand-toggle">
        <span>Items to consider (${d.candidateItemIds.length}/${store.items.size})</span>
        <span id="w-cand-arrow">▼</span>
      </button>
      <div id="w-cand-body" class="candidates-body hidden">${candidatesHTML}</div>
    </div>`;
}

function wireStepInputs(): void {
  if (!wizardDraft) return;
  const d = wizardDraft;

  if (wizardStep === 1) {
    const onDest = debounce(() => void refreshWizardLocation(), 400);
    $('w-dest').addEventListener('input', () => {
      d.destination = ($('w-dest').value ?? '').trim();
      if (!d.nameUserEdited) updateAutoName();
      onDest();
    });
    $('w-name').addEventListener('input', () => {
      d.name = $('w-name').value ?? '';
      d.nameUserEdited = d.name.trim() !== autoName();
    });
  }

  if (wizardStep === 2) {
    wireDateFields(d, 'w', () => {
      renderWizardStep();
    });
  }

  if (wizardStep === 3) {
    document.querySelectorAll<HTMLElement>('.activity-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset['activity'];
        if (!a) return;
        const idx = d.activities.indexOf(a);
        if (idx >= 0) d.activities.splice(idx, 1);
        else d.activities.push(a);
        btn.classList.toggle('selected');
        renderWizardPreview();
      });
    });
    $('w-notes').addEventListener('input', () => {
      d.notes = $('w-notes').value ?? '';
      renderWizardPreview();
    });
    $('w-cand-toggle').addEventListener('click', () => {
      const body = $('w-cand-body');
      const arrow = $('w-cand-arrow');
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      arrow.textContent = open ? '▼' : '▲';
    });
    document
      .querySelectorAll<HTMLInputElement>('#w-cand-body input[type="checkbox"]')
      .forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.dataset['cand'];
          if (!id) return;
          const idx = d.candidateItemIds.indexOf(id);
          if (cb.checked && idx < 0) d.candidateItemIds.push(id);
          if (!cb.checked && idx >= 0) d.candidateItemIds.splice(idx, 1);
          renderWizardPreview();
        });
      });
  }
}

/**
 * Render the climate preview card + year strip for a trip draft. Shared
 * by wizard step 2 and the edit form's right panel.
 */
function renderClimatePreview(d: TripDraft): string {
  if (!d.yearClimate) {
    return `<div class="wizard-preview-empty">Loading climate…</div>`;
  }
  const months = spannedMonths({
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
  });
  const totalDays = durationToDays(d.durationCount, d.durationUnit);
  const agg = aggregateMonths(d.yearClimate, months, totalDays);
  const unit = getTempUnit();
  const icon = weatherEmoji(agg.avgHigh, agg.totalPrecip, agg.rainyDays);
  const allHighs = d.yearClimate.map(c => c.avgHigh).filter((x): x is number => x != null);
  const allLows = d.yearClimate.map(c => c.avgLow).filter((x): x is number => x != null);
  const tMin = Math.min(...allLows, 0);
  const tMax = Math.max(...allHighs, 30);
  const tRange = Math.max(tMax - tMin, 1);
  const pct = (v: number): number => ((v - tMin) / tRange) * 100;
  const strip = d.yearClimate
    .map(
      c => `
    <div class="climate-month${months.includes(c.monthIdx) ? ' active' : ''}" title="${esc(c.monthName)}">
      <div class="climate-bar-wrap">
        <div class="climate-bar" style="bottom:${c.avgLow != null ? pct(c.avgLow) : 0}%; top:${c.avgHigh != null ? 100 - pct(c.avgHigh) : 100}%"></div>
      </div>
      <div class="climate-m">${c.monthName.slice(0, 1)}</div>
    </div>`,
    )
    .join('');
  const rainyStr = formatRainyDays(agg.rainyDays, totalDays);
  return `
    <div class="climate-summary">
      <div class="climate-icon">${icon}</div>
      <div class="climate-info">
        <div class="climate-place">${esc(agg.monthName || '—')}</div>
        <div class="climate-stats">
          ${agg.avgHigh !== null ? `<span><strong>${formatTemp(agg.avgHigh, unit)}</strong> high</span>` : ''}
          ${agg.avgLow !== null ? `<span><strong>${formatTemp(agg.avgLow, unit)}</strong> low</span>` : ''}
        </div>
        <div class="climate-stats climate-stats--sub">
          ${rainyStr !== '—' ? `<span>${rainyStr}</span>` : ''}
          ${agg.cloudCoverPct !== null ? `<span>${agg.cloudCoverPct}% cloud</span>` : ''}
          ${agg.humidityPct !== null ? `<span>${agg.humidityPct}% humidity</span>` : ''}
        </div>
      </div>
    </div>
    <div class="climate-strip">${strip}</div>`;
}

/**
 * Wires up a date-fields block (start month/year + duration count/unit)
 * to a TripDraft, calling `onChange` after each mutation. Caller is
 * responsible for re-rendering the derived hint and the preview.
 */
function wireDateFields(d: TripDraft, prefix: string, onChange: () => void): void {
  $(`${prefix}-start-month`).addEventListener('change', e => {
    d.startMonth = parseInt((e.target as HTMLSelectElement).value, 10);
    if (!d.nameUserEdited) updateAutoName();
    onChange();
  });
  $(`${prefix}-start-year`).addEventListener('change', e => {
    d.startYear = parseInt((e.target as HTMLSelectElement).value, 10);
    if (!d.nameUserEdited) updateAutoName();
    onChange();
  });
  $(`${prefix}-dur-count`).addEventListener('input', e => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v) && v >= 1) {
      d.durationCount = v;
      if (!d.nameUserEdited) updateAutoName();
      onChange();
    }
  });
  $(`${prefix}-dur-unit`).addEventListener('change', e => {
    d.durationUnit = (e.target as HTMLSelectElement).value as 'days' | 'weeks' | 'months';
    if (!d.nameUserEdited) updateAutoName();
    onChange();
  });
}

function autoName(): string {
  if (!wizardDraft) return '';
  return tripDisplayName({
    destination: wizardDraft.destination.trim() || '…',
    startMonth: wizardDraft.startMonth,
    startYear: wizardDraft.startYear,
    durationCount: wizardDraft.durationCount,
    durationUnit: wizardDraft.durationUnit,
  });
}

function updateAutoName(): void {
  if (!wizardDraft) return;
  wizardDraft.name = autoName();
  const nameInput = $maybe<HTMLInputElement>('w-name');
  if (nameInput) nameInput.value = wizardDraft.name;
  renderWizardPreview();
}

async function refreshWizardLocation(): Promise<void> {
  if (!wizardDraft) return;
  wizardLocationAbort?.abort();
  const dest = wizardDraft.destination;
  if (dest.length < 3) {
    wizardDraft.location = null;
    wizardDraft.yearClimate = null;
    wizardDraft.locationError = null;
    renderWizardPreview();
    return;
  }
  const ctrl = new AbortController();
  wizardLocationAbort = ctrl;
  try {
    const loc = await geocode(dest, ctrl.signal);
    if (ctrl.signal.aborted || !wizardDraft) return;
    wizardDraft.location = loc;
    wizardDraft.locationError = null;
    renderWizardPreview();
    const climate = await fetchYearClimate(loc, undefined, ctrl.signal);
    if (ctrl.signal.aborted || !wizardDraft) return;
    wizardDraft.yearClimate = climate;
    renderWizardPreview();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    if (!wizardDraft) return;
    wizardDraft.location = null;
    wizardDraft.yearClimate = null;
    wizardDraft.locationError = `Couldn't find "${dest}". Try a different spelling or be more specific.`;
    renderWizardPreview();
  }
}

function renderWizardPreview(): void {
  if (!wizardDraft) return;
  const d = wizardDraft;
  const preview = $('wizard-preview');

  if (wizardStep === 1) {
    if (d.locationError) {
      preview.innerHTML = `<div class="wizard-preview-empty wizard-preview-error">${esc(d.locationError)}</div>`;
      return;
    }
    if (!d.location) {
      preview.innerHTML = `<div class="wizard-preview-empty">Type a destination to see the map.</div>`;
      return;
    }
    const mapUrl = staticMapUrl(d.location.latitude, d.location.longitude);
    preview.innerHTML = `
      <iframe class="wizard-map" src="${esc(mapUrl)}" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"></iframe>
      <div class="wizard-location">
        <div class="wizard-location-name">${esc(d.location.name)}, ${esc(d.location.country)}</div>
        <div class="wizard-location-coord">${d.location.latitude.toFixed(2)}°, ${d.location.longitude.toFixed(2)}°</div>
      </div>`;
    return;
  }

  if (wizardStep === 2) {
    preview.innerHTML = renderClimatePreview(d);
    return;
  }

  // Step 3: trip summary card
  const monthsLabel = formatMonthsLabel(
    spannedMonths({
      startMonth: d.startMonth,
      startYear: d.startYear,
      durationCount: d.durationCount,
      durationUnit: d.durationUnit,
    }),
  );
  const durStr = formatDuration(d.durationCount, d.durationUnit);
  preview.innerHTML = `
    <div class="wizard-summary">
      <div class="wizard-summary-title">${esc(d.name || autoName())}</div>
      ${d.location ? `<div class="wizard-summary-row">📍 ${esc(d.location.name)}, ${esc(d.location.country)}</div>` : ''}
      <div class="wizard-summary-row">📅 ${esc(monthsLabel || '—')} ${d.startYear} · ${esc(durStr)}</div>
      ${d.activities.length ? `<div class="wizard-summary-row">🎯 ${esc(d.activities.join(', '))}</div>` : ''}
      ${d.notes.trim() ? `<div class="wizard-summary-row">📝 ${esc(d.notes)}</div>` : ''}
      <div class="wizard-summary-row">📦 ${d.candidateItemIds.length}/${store.items.size} items to consider</div>
    </div>
    ${!getApiKey() ? `<div class="wizard-api-hint">💡 Add your Anthropic API key in Settings to get recommendations after saving.</div>` : ''}`;
}

async function saveWizardTrip(): Promise<void> {
  if (!wizardDraft) return;
  const d = wizardDraft;
  if (!d.location) {
    showToast('Pick a destination first', 'error');
    return;
  }
  const name = (d.name.trim() || autoName()).trim();
  const newId = tripSlug({
    destination: d.destination,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
  });

  const now = serverTimestamp();
  const tripData: Omit<Trip, 'id'> = {
    name,
    destination: d.destination.trim(),
    location: d.location,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
    activities: [...d.activities],
    notes: d.notes,
    candidateItemIds: [...d.candidateItemIds],
    yearClimate: d.yearClimate,
    aiResult: null,
    aiGeneratedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createTrip(newId, tripData);
    setBeforeLeave(null);
    showToast('Trip saved', 'success');
    showView('trip', { id: newId });
    // Convenience: if a key is set and no recs yet, auto-regenerate
    if (getApiKey() && !tripData.aiResult) {
      void regenerateTripRecs(newId);
    }
  } catch (err) {
    if ((err as Error)?.message === 'DUPLICATE_TRIP') {
      const monthName = MONTHS[d.startMonth] ?? '';
      showToast(
        `A trip for ${d.destination} in ${monthName} ${d.startYear} already exists`,
        'error',
        5000,
      );
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error saving trip: ' + msg, 'error');
  }
}

// ============================================================
//  TRIP EDIT FORM (single page)
// ============================================================
let editDraft: TripDraft | null = null;
let editTripId: string | null = null;
let editSavedSnapshot = '';
let editLocationAbort: AbortController | null = null;

function editDraftDirty(): boolean {
  if (!editDraft) return false;
  return snapshotDraft(editDraft) !== editSavedSnapshot;
}

function renderTripEditView(tripId: string): void {
  const trip = store.trips.get(tripId);
  if (!trip) {
    showView('trips');
    return;
  }
  editTripId = tripId;
  editDraft = {
    name: trip.name,
    nameUserEdited: true,
    destination: trip.destination,
    location: trip.location,
    locationError: null,
    startMonth: trip.startMonth,
    startYear: trip.startYear,
    durationCount: trip.durationCount,
    durationUnit: trip.durationUnit,
    activities: [...trip.activities],
    notes: trip.notes,
    candidateItemIds: [...trip.candidateItemIds],
    yearClimate: trip.yearClimate,
  };
  editSavedSnapshot = snapshotDraft(editDraft);

  setBeforeLeave(() => {
    if (editDraftDirty()) {
      return window.confirm('Discard unsaved changes to this trip?');
    }
    return true;
  });

  $('header-title').textContent = 'Edit trip';
  renderEditFormFrame();
}

function renderEditFormFrame(): void {
  if (!editDraft) return;
  const d = editDraft;
  const activityList = resolvedActivities();
  const actChips = activityList
    .map(
      a =>
        `<button type="button" class="activity-btn${d.activities.includes(a) ? ' selected' : ''}" data-activity="${esc(a)}">${esc(a)}</button>`,
    )
    .join('');
  const candidateGroups: Record<string, Item[]> = {};
  store.items.forEach(it => {
    const g = it.category?.group || 'misc';
    if (!candidateGroups[g]) candidateGroups[g] = [];
    candidateGroups[g]!.push(it);
  });
  const candidatesHTML = Object.entries(candidateGroups)
    .map(
      ([g, its]) => `
      <div class="candidate-group-title">${g}</div>
      ${its
        .map(
          it => `
        <div class="candidate-item">
          <input type="checkbox" id="e-cand-${it.id}" data-cand="${it.id}" ${d.candidateItemIds.includes(it.id) ? 'checked' : ''}>
          <label for="e-cand-${it.id}">${esc(it.name)}</label>
          <span style="font-size:12px;color:var(--text-tertiary)">${esc(containerName(it.containerId))}</span>
        </div>`,
        )
        .join('')}`,
    )
    .join('');

  $('trip-edit-content').innerHTML = `
    <div class="wizard-left">
      <div class="edit-section">
        <h3 class="edit-heading">Where</h3>
        <div class="form-group">
          <label>Destination</label>
          <input type="text" id="e-dest" value="${esc(d.destination)}" placeholder="e.g. Cozumel, Mexico" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Trip name</label>
          <input type="text" id="e-name" value="${esc(d.name)}" placeholder="Auto-generated">
        </div>
      </div>
      <div class="edit-section">
        <h3 class="edit-heading">When</h3>
        ${renderDateFields(d, 'e')}
      </div>
      <div class="edit-section">
        <h3 class="edit-heading">What</h3>
        <div class="form-group">
          <label>Activities</label>
          <div class="activity-grid">${actChips}</div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="e-notes" rows="3" placeholder="e.g. formal dinner on day 3">${esc(d.notes)}</textarea>
        </div>
        <div class="candidates-panel" style="margin:0">
          <button class="candidates-toggle" id="e-cand-toggle">
            <span>Items to consider (${d.candidateItemIds.length}/${store.items.size})</span>
            <span id="e-cand-arrow">▼</span>
          </button>
          <div id="e-cand-body" class="candidates-body hidden">${candidatesHTML}</div>
        </div>
      </div>
      <div class="edit-footer">
        <button type="button" class="btn-ghost" id="edit-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="edit-save">Save changes</button>
      </div>
    </div>
    <aside class="wizard-right">
      <div class="wizard-right-label">Preview</div>
      <div id="edit-preview"></div>
    </aside>`;

  wireEditForm();
  renderEditPreview();
}

function wireEditForm(): void {
  if (!editDraft) return;
  const d = editDraft;

  const onDest = debounce(() => void refreshEditLocation(), 400);
  $('e-dest').addEventListener('input', () => {
    d.destination = ($('e-dest').value ?? '').trim();
    if (!d.nameUserEdited) updateEditAutoName();
    onDest();
  });
  $('e-name').addEventListener('input', () => {
    d.name = $('e-name').value ?? '';
    d.nameUserEdited = d.name.trim() !== editAutoName();
  });
  wireDateFieldsFor(d, 'e', () => {
    renderEditFormFrame();
  });
  document.querySelectorAll<HTMLElement>('.trip-edit-form .activity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset['activity'];
      if (!a) return;
      const idx = d.activities.indexOf(a);
      if (idx >= 0) d.activities.splice(idx, 1);
      else d.activities.push(a);
      btn.classList.toggle('selected');
    });
  });
  $('e-notes').addEventListener('input', () => {
    d.notes = $('e-notes').value ?? '';
  });
  $('e-cand-toggle').addEventListener('click', () => {
    const body = $('e-cand-body');
    const arrow = $('e-cand-arrow');
    const open = !body.classList.contains('hidden');
    body.classList.toggle('hidden', open);
    arrow.textContent = open ? '▼' : '▲';
  });
  document.querySelectorAll<HTMLInputElement>('#e-cand-body input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset['cand'];
      if (!id) return;
      const idx = d.candidateItemIds.indexOf(id);
      if (cb.checked && idx < 0) d.candidateItemIds.push(id);
      if (!cb.checked && idx >= 0) d.candidateItemIds.splice(idx, 1);
    });
  });
  $('edit-cancel').addEventListener('click', () => {
    if (editTripId) showView('trip', { id: editTripId });
  });
  $('edit-save').addEventListener('click', () => void saveEditedTrip());
}

/**
 * Same as wireDateFields but targets the edit draft. The shared helper
 * uses wizardDraft via updateAutoName(); we need a variant for editDraft.
 */
function wireDateFieldsFor(d: TripDraft, prefix: string, onChange: () => void): void {
  $(`${prefix}-start-month`).addEventListener('change', e => {
    d.startMonth = parseInt((e.target as HTMLSelectElement).value, 10);
    if (!d.nameUserEdited) updateEditAutoName();
    onChange();
  });
  $(`${prefix}-start-year`).addEventListener('change', e => {
    d.startYear = parseInt((e.target as HTMLSelectElement).value, 10);
    if (!d.nameUserEdited) updateEditAutoName();
    onChange();
  });
  $(`${prefix}-dur-count`).addEventListener('input', e => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v) && v >= 1) {
      d.durationCount = v;
      if (!d.nameUserEdited) updateEditAutoName();
      onChange();
    }
  });
  $(`${prefix}-dur-unit`).addEventListener('change', e => {
    d.durationUnit = (e.target as HTMLSelectElement).value as 'days' | 'weeks' | 'months';
    if (!d.nameUserEdited) updateEditAutoName();
    onChange();
  });
}

function editAutoName(): string {
  if (!editDraft) return '';
  return tripDisplayName({
    destination: editDraft.destination.trim() || '…',
    startMonth: editDraft.startMonth,
    startYear: editDraft.startYear,
    durationCount: editDraft.durationCount,
    durationUnit: editDraft.durationUnit,
  });
}

function updateEditAutoName(): void {
  if (!editDraft) return;
  editDraft.name = editAutoName();
  const nameInput = $maybe<HTMLInputElement>('e-name');
  if (nameInput) nameInput.value = editDraft.name;
}

async function refreshEditLocation(): Promise<void> {
  if (!editDraft) return;
  editLocationAbort?.abort();
  const dest = editDraft.destination;
  if (dest.length < 3) {
    editDraft.location = null;
    editDraft.yearClimate = null;
    editDraft.locationError = null;
    renderEditPreview();
    return;
  }
  const ctrl = new AbortController();
  editLocationAbort = ctrl;
  try {
    const loc = await geocode(dest, ctrl.signal);
    if (ctrl.signal.aborted || !editDraft) return;
    editDraft.location = loc;
    editDraft.locationError = null;
    renderEditPreview();
    const climate = await fetchYearClimate(loc, undefined, ctrl.signal);
    if (ctrl.signal.aborted || !editDraft) return;
    editDraft.yearClimate = climate;
    renderEditPreview();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    if (!editDraft) return;
    editDraft.location = null;
    editDraft.yearClimate = null;
    editDraft.locationError = `Couldn't find "${dest}". Try a different spelling or be more specific.`;
    renderEditPreview();
  }
}

function renderEditPreview(): void {
  if (!editDraft) return;
  const d = editDraft;
  const preview = $('edit-preview');
  const mapHTML = d.locationError
    ? `<div class="wizard-preview-empty wizard-preview-error">${esc(d.locationError)}</div>`
    : d.location
      ? `<iframe class="wizard-map" src="${esc(staticMapUrl(d.location.latitude, d.location.longitude))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
         <div class="wizard-location">
           <div class="wizard-location-name">${esc(d.location.name)}, ${esc(d.location.country)}</div>
           <div class="wizard-location-coord">${d.location.latitude.toFixed(2)}°, ${d.location.longitude.toFixed(2)}°</div>
         </div>`
      : `<div class="wizard-preview-empty">Type a destination to see the map.</div>`;
  preview.innerHTML = `${mapHTML}${renderClimatePreview(d)}`;
}

async function saveEditedTrip(): Promise<void> {
  if (!editDraft || !editTripId) return;
  const d = editDraft;
  if (!d.location) {
    showToast('Pick a destination first', 'error');
    return;
  }
  const name = (d.name.trim() || editAutoName()).trim();
  const newId = tripSlug({
    destination: d.destination,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
  });
  const existing = store.trips.get(editTripId);
  const now = serverTimestamp();
  const tripData: Omit<Trip, 'id'> = {
    name,
    destination: d.destination.trim(),
    location: d.location,
    startMonth: d.startMonth,
    startYear: d.startYear,
    durationCount: d.durationCount,
    durationUnit: d.durationUnit,
    activities: [...d.activities],
    notes: d.notes,
    candidateItemIds: [...d.candidateItemIds],
    yearClimate: d.yearClimate,
    aiResult: existing?.aiResult ?? null,
    aiGeneratedAt: existing?.aiGeneratedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    if (newId !== editTripId) {
      await renameTrip(editTripId, newId, tripData);
    } else {
      await updateTrip(editTripId, tripData);
    }
    editSavedSnapshot = snapshotDraft(d);
    setBeforeLeave(null);
    showToast('Trip saved', 'success');
    showView('trip', { id: newId });
  } catch (err) {
    if ((err as Error)?.message === 'DUPLICATE_TRIP') {
      const monthName = MONTHS[d.startMonth] ?? '';
      showToast(
        `A trip for ${d.destination} in ${monthName} ${d.startYear} already exists`,
        'error',
        5000,
      );
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Error saving trip: ' + msg, 'error');
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
        <div class="btn-row" style="align-items:center">
          <button class="btn-sm accent" id="btn-save-key">Save Key</button>
          <span id="key-status" style="font-size:13px"></span>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">AI Model</div>
          <div class="settings-row-sub" style="font-family:monospace;font-size:12px">${AI_MODEL}</div>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Appearance</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="settings-row-label">Thumbnail background</div>
        <div class="settings-row-sub">Background shown behind items with transparent photos</div>
        <div class="thumb-bg-picker" id="thumb-bg-picker">
          ${Object.entries(THUMB_BACKGROUNDS)
            .map(
              ([key, { label, css }]) =>
                `<button class="thumb-bg-opt${getThumbBg() === key ? ' active' : ''}" data-bg="${key}" title="${label}">
                  <span class="thumb-bg-swatch" style="background:${css}"></span>
                  <span>${label}</span>
                </button>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Units</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="settings-row-label">Temperature</div>
        <div class="settings-row-sub">Display temperatures in Celsius or Fahrenheit.</div>
        <div class="btn-row" role="radiogroup" aria-label="Temperature unit">
          <button class="btn-sm ${getTempUnit() === 'celsius' ? 'accent' : ''}" id="btn-unit-c" role="radio" aria-checked="${getTempUnit() === 'celsius'}">°C</button>
          <button class="btn-sm ${getTempUnit() === 'fahrenheit' ? 'accent' : ''}" id="btn-unit-f" role="radio" aria-checked="${getTempUnit() === 'fahrenheit'}">°F</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Activities</div>
      <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="settings-row-label">Trip activities</div>
        <div class="settings-row-sub">Shown in the Trip wizard. Edit to match your travel style.</div>
        <div id="settings-activities" class="activities-list"></div>
        <div class="btn-row" style="margin-top:4px">
          <input type="text" id="settings-new-activity" placeholder="Add activity…" autocomplete="off" style="flex:1">
          <button class="btn-sm accent" id="btn-add-activity">Add</button>
        </div>
        <button class="btn-sm" id="btn-reset-activities">Reset to defaults</button>
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
      Packrat build ${__APP_VERSION__}
    </div>`;

  $maybe('btn-save-key')?.addEventListener('click', async () => {
    const val = $('settings-api-key').value?.trim() ?? '';
    setApiKey(val);
    const statusEl = $maybe('key-status');
    if (!val) {
      if (statusEl) statusEl.textContent = '';
      showToast('API key cleared', 'success');
      return;
    }
    if (statusEl) {
      statusEl.textContent = 'Validating…';
      statusEl.style.color = 'var(--text-secondary)';
    }
    try {
      const res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': val,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 1,
          messages: [{ role: 'user', content: '.' }],
        }),
      });
      if (res.ok) {
        if (statusEl) {
          statusEl.textContent = '✓ Valid';
          statusEl.style.color = 'var(--success, #2e7d32)';
        }
        showToast('API key saved and verified', 'success');
      } else {
        const errText = await res.text();
        const msg = res.status === 401 ? 'Invalid key' : `Error (${res.status})`;
        if (statusEl) {
          statusEl.textContent = '✗ ' + msg;
          statusEl.style.color = 'var(--danger, #c62828)';
        }
        showToast(msg + ' — check your API key', 'error');
        console.warn('API key validation failed:', errText.slice(0, 200));
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = '✗ Network error';
        statusEl.style.color = 'var(--danger, #c62828)';
      }
      showToast('Could not reach Anthropic API', 'error');
    }
  });

  $maybe('thumb-bg-picker')?.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.thumb-bg-opt');
    if (!btn) return;
    const bg = btn.dataset['bg'];
    if (bg) {
      localStorage.setItem(THUMB_BG_KEY, bg);
      renderSettingsView();
    }
  });

  $maybe('btn-unit-c')?.addEventListener('click', () => {
    setTempUnit('celsius');
    renderSettingsView();
    window.dispatchEvent(new CustomEvent('packrat:units-changed'));
  });
  $maybe('btn-unit-f')?.addEventListener('click', () => {
    setTempUnit('fahrenheit');
    renderSettingsView();
    window.dispatchEvent(new CustomEvent('packrat:units-changed'));
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

  renderActivitiesList();
  $('btn-add-activity')?.addEventListener('click', () => {
    void addActivityFromInput();
  });
  $('settings-new-activity')?.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') void addActivityFromInput();
  });
  $('btn-reset-activities')?.addEventListener('click', () => {
    showConfirm(
      'Reset activities to the defaults?',
      async () => {
        await saveUserActivities(ACTIVITIES.slice());
        renderActivitiesList();
        showToast('Activities reset', 'success');
      },
      'Reset',
    );
  });
}

function renderActivitiesList(): void {
  const container = $('settings-activities');
  const list = resolvedActivities();
  if (!list.length) {
    container.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px">No activities yet — add one below.</div>`;
    return;
  }
  container.innerHTML = list
    .map(
      (a, i) =>
        `<span class="activity-pill"><span>${esc(a)}</span><button class="activity-pill-x" data-act-idx="${i}" aria-label="Remove ${esc(a)}">✕</button></span>`,
    )
    .join('');
  container.querySelectorAll<HTMLElement>('.activity-pill-x').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset['actIdx'] ?? '-1', 10);
      const current = resolvedActivities();
      const next = current.filter((_, i) => i !== idx);
      await saveUserActivities(next);
      renderActivitiesList();
    });
  });
}

async function addActivityFromInput(): Promise<void> {
  const input = $<HTMLInputElement>('settings-new-activity');
  const raw = (input.value ?? '').trim();
  if (!raw) return;
  if (raw.length > 50) {
    showToast('Activity name is too long (max 50 chars)', 'error');
    return;
  }
  const existing = resolvedActivities();
  if (existing.some(a => a.toLowerCase() === raw.toLowerCase())) {
    showToast('That activity already exists', 'error');
    return;
  }
  const next = [...existing, raw];
  await saveUserActivities(next);
  input.value = '';
  renderActivitiesList();
}

function downloadCSVTemplate() {
  const headers =
    'name,category_group,category_value,quantity_owned,quantity_pack_default,container_name,tags,notes,description,color';
  const example =
    '"Black merino t-shirt",clothing,tops,3,2,"Osprey carry-on","merino,warm weather","","Lightweight wool tee",#1A1A2E';
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
        description: r['description']?.trim() || null,
        color: r['color']?.trim() || null,
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
    case 'open-trip':
      showView('trip', { id });
      break;
    case 'edit-trip':
      showView('trip-edit', { id });
      break;
    case 'delete-trip':
      await deleteTripConfirm(id);
      break;
    case 'regenerate-trip':
      await regenerateTripRecs(id);
      break;
    case 'save-trip-as-list':
      await saveTripAsList(id);
      break;
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
