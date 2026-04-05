import {
  collection,
  query,
  orderBy,
  getDocs,
  onSnapshot,
  type Unsubscribe,
  type DocumentChange,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Store, Container, Item, List, ListEntry } from './types';

export const store: Store = {
  user: null,
  containers: new Map<string, Container>(),
  items: new Map<string, Item>(),
  lists: new Map<string, List>(),
  listEntries: new Map<string, Map<string, ListEntry>>(),
};

// ============================================================
//  Firestore path helpers (all scoped by logged-in uid)
// ============================================================
export const uid = (): string | undefined => store.user?.uid;
export const userPath = (): string => `users/${uid()}`;
export const itemsCol = () => collection(db, `${userPath()}/items`);
export const contsCol = () => collection(db, `${userPath()}/containers`);
export const listsCol = () => collection(db, `${userPath()}/lists`);
export const entriesCol = (lid: string) => collection(db, `${userPath()}/lists/${lid}/entries`);

// ============================================================
//  Loading
// ============================================================
export async function loadAllData(): Promise<void> {
  const [cSnap, iSnap, lSnap] = await Promise.all([
    getDocs(query(contsCol(), orderBy('createdAt', 'asc'))),
    getDocs(query(itemsCol(), orderBy('createdAt', 'asc'))),
    getDocs(query(listsCol(), orderBy('createdAt', 'asc'))),
  ]);

  store.containers.clear();
  cSnap.forEach(d => store.containers.set(d.id, { id: d.id, ...d.data() } as Container));

  store.items.clear();
  iSnap.forEach(d => store.items.set(d.id, { id: d.id, ...d.data() } as Item));

  store.lists.clear();
  store.listEntries.clear();
  lSnap.forEach(d => store.lists.set(d.id, { id: d.id, ...d.data() } as List));

  await Promise.all([...store.lists.keys()].map(loadListEntries));
}

export async function loadListEntries(listId: string): Promise<void> {
  const snap = await getDocs(query(entriesCol(listId), orderBy('sortOrder', 'asc')));
  const m = new Map<string, ListEntry>();
  snap.forEach(d => m.set(d.id, { id: d.id, ...d.data() } as ListEntry));
  store.listEntries.set(listId, m);
}

// ============================================================
//  Realtime listeners (containers + lists only; items are client-managed)
// ============================================================
let containerListener: Unsubscribe | null = null;
let listListener: Unsubscribe | null = null;

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
}

export function clearStore(): void {
  store.user = null;
  store.containers.clear();
  store.items.clear();
  store.lists.clear();
  store.listEntries.clear();
}
