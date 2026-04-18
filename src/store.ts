import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type DocumentChange,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Store, Container, Item, List, ListEntry, Trip, DurationUnit } from './types';
import { parseDurationString } from './trips';

export const store: Store = {
  user: null,
  containers: new Map<string, Container>(),
  items: new Map<string, Item>(),
  lists: new Map<string, List>(),
  listEntries: new Map<string, Map<string, ListEntry>>(),
  trips: new Map<string, Trip>(),
  userActivities: null,
};

// ============================================================
//  Firestore path helpers (all scoped by logged-in uid)
// ============================================================
export const uid = (): string | undefined => store.user?.uid;
export const userPath = (): string => `users/${uid()}`;
export const userDocRef = () => doc(db, userPath());
export const itemsCol = () => collection(db, `${userPath()}/items`);
export const contsCol = () => collection(db, `${userPath()}/containers`);
export const listsCol = () => collection(db, `${userPath()}/lists`);
export const entriesCol = (lid: string) => collection(db, `${userPath()}/lists/${lid}/entries`);
export const tripsCol = () => collection(db, `${userPath()}/trips`);
export const tripDocRef = (id: string) => doc(db, `${userPath()}/trips/${id}`);

// ============================================================
//  Loading
// ============================================================
export async function loadAllData(): Promise<void> {
  const [cSnap, iSnap, lSnap, tSnap, uSnap] = await Promise.all([
    getDocs(query(contsCol(), orderBy('createdAt', 'asc'))),
    getDocs(query(itemsCol(), orderBy('createdAt', 'asc'))),
    getDocs(query(listsCol(), orderBy('createdAt', 'asc'))),
    getDocs(query(tripsCol(), orderBy('createdAt', 'asc'))),
    getDoc(userDocRef()),
  ]);

  store.containers.clear();
  cSnap.forEach(d => store.containers.set(d.id, { id: d.id, ...d.data() } as Container));

  store.items.clear();
  iSnap.forEach(d => store.items.set(d.id, { id: d.id, ...d.data() } as Item));

  store.lists.clear();
  store.listEntries.clear();
  lSnap.forEach(d => store.lists.set(d.id, { id: d.id, ...d.data() } as List));

  store.trips.clear();
  tSnap.forEach(d => store.trips.set(d.id, migrateTrip({ id: d.id, ...d.data() })));

  const userData = uSnap.data() as { activities?: string[] } | undefined;
  store.userActivities = Array.isArray(userData?.activities) ? userData.activities : null;

  await Promise.all([...store.lists.keys()].map(loadListEntries));
}

export async function loadListEntries(listId: string): Promise<void> {
  const snap = await getDocs(query(entriesCol(listId), orderBy('sortOrder', 'asc')));
  const m = new Map<string, ListEntry>();
  snap.forEach(d => m.set(d.id, { id: d.id, ...d.data() } as ListEntry));
  store.listEntries.set(listId, m);
}

// ============================================================
//  Trip CRUD
// ============================================================
/**
 * Create a trip at the given slug ID. Fails if a doc already exists.
 * Caller is responsible for shape + timestamps except id.
 */
export async function createTrip(id: string, data: Omit<Trip, 'id'>): Promise<void> {
  const ref = tripDocRef(id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error('DUPLICATE_TRIP');
  }
  await setDoc(ref, data);
  store.trips.set(id, { id, ...data } as Trip);
}

/** Update an existing trip by doc ID. */
export async function updateTrip(id: string, patch: Partial<Trip>): Promise<void> {
  await updateDoc(tripDocRef(id), patch as Record<string, unknown>);
  const existing = store.trips.get(id);
  if (existing) store.trips.set(id, { ...existing, ...patch });
}

/**
 * Replace a trip under a new slug (destination/months/year/duration changed).
 * Creates the new doc + deletes the old. Fails if the new slug collides.
 */
export async function renameTrip(
  oldId: string,
  newId: string,
  data: Omit<Trip, 'id'>,
): Promise<void> {
  if (oldId === newId) {
    await updateTrip(oldId, data);
    return;
  }
  // Check new slug availability
  const existing = await getDoc(tripDocRef(newId));
  if (existing.exists()) throw new Error('DUPLICATE_TRIP');
  await setDoc(tripDocRef(newId), data);
  await deleteDoc(tripDocRef(oldId));
  store.trips.delete(oldId);
  store.trips.set(newId, { id: newId, ...data } as Trip);
}

export async function deleteTrip(id: string): Promise<void> {
  await deleteDoc(tripDocRef(id));
  store.trips.delete(id);
}

// ============================================================
//  User activities (custom list)
// ============================================================
export async function saveUserActivities(activities: string[]): Promise<void> {
  await setDoc(userDocRef(), { activities }, { merge: true });
  store.userActivities = activities.slice();
}

// ============================================================
//  Realtime listeners (containers, lists, trips)
// ============================================================
let containerListener: Unsubscribe | null = null;
let listListener: Unsubscribe | null = null;
let tripListener: Unsubscribe | null = null;

export function setupListeners(): void {
  if (containerListener) containerListener();
  containerListener = onSnapshot(query(contsCol(), orderBy('createdAt', 'asc')), snap => {
    snap.docChanges().forEach((change: DocumentChange) => {
      if (change.type === 'removed') store.containers.delete(change.doc.id);
      else
        store.containers.set(change.doc.id, {
          id: change.doc.id,
          ...change.doc.data(),
        } as Container);
    });
  });

  if (listListener) listListener();
  listListener = onSnapshot(query(listsCol(), orderBy('createdAt', 'asc')), snap => {
    snap.docChanges().forEach((change: DocumentChange) => {
      if (change.type === 'removed') {
        store.lists.delete(change.doc.id);
        store.listEntries.delete(change.doc.id);
      } else {
        store.lists.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as List);
      }
    });
  });

  if (tripListener) tripListener();
  tripListener = onSnapshot(query(tripsCol(), orderBy('createdAt', 'asc')), snap => {
    snap.docChanges().forEach((change: DocumentChange) => {
      if (change.type === 'removed') store.trips.delete(change.doc.id);
      else store.trips.set(change.doc.id, migrateTrip({ id: change.doc.id, ...change.doc.data() }));
    });
  });
}

/**
 * Migrate a pre-v2 trip doc (months/year/duration) into the v2 shape
 * (startMonth/startYear/durationCount/durationUnit). Returns v2 trips
 * unchanged. In-memory only — does not rewrite Firestore.
 */
function migrateTrip(raw: Record<string, unknown>): Trip {
  // Migrate location from { lat, lng } to { latitude, longitude, name, country }
  if (raw.location && typeof raw.location === 'object') {
    const loc = raw.location as Record<string, unknown>;
    if ('lat' in loc && !('latitude' in loc)) {
      raw.location = {
        latitude: loc.lat as number,
        longitude: loc.lng as number,
        name: typeof raw.destination === 'string' ? (raw.destination as string) : '',
        country: '',
      };
    }
  }

  if ('startMonth' in raw && 'durationCount' in raw) return raw as unknown as Trip;
  const legacyMonths = Array.isArray(raw.months) ? (raw.months as number[]) : [];
  const legacyYear = typeof raw.year === 'number' ? (raw.year as number) : new Date().getFullYear();
  const legacyDuration = typeof raw.duration === 'string' ? (raw.duration as string) : '';
  const parsed = parseDurationString(legacyDuration);
  const startMonth =
    legacyMonths.length > 0
      ? Math.min(...legacyMonths.filter(m => m >= 0 && m < 12))
      : new Date().getMonth();
  return {
    ...(raw as unknown as Trip),
    startMonth,
    startYear: legacyYear,
    durationCount: parsed.durationCount,
    durationUnit: parsed.durationUnit as DurationUnit,
  };
}

export function teardownListeners(): void {
  if (containerListener) {
    containerListener();
    containerListener = null;
  }
  if (listListener) {
    listListener();
    listListener = null;
  }
  if (tripListener) {
    tripListener();
    tripListener = null;
  }
}

export function clearStore(): void {
  store.user = null;
  store.containers.clear();
  store.items.clear();
  store.lists.clear();
  store.listEntries.clear();
  store.trips.clear();
  store.userActivities = null;
}
