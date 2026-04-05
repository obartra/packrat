# Packrat — Design Proposal v0.3

**Personal Inventory & AI-Assisted Packing App**

## 1. Project Overview

Packrat is a mobile-optimized web application for one authenticated user to inventory physical possessions, track which container each item lives in, define reusable packing lists, and receive AI-generated packing recommendations for a trip — including climate context auto-fetched from Open-Meteo.

**Constraints:**
- TypeScript + Vite build pipeline, static output to `dist/` deployable to any static host
- Firebase backend (Auth, Firestore, Storage) bundled via npm (`firebase@10.11.1`)
- Firebase config driven by `VITE_FIREBASE_*` env vars — `.env.local` for dev, Netlify dashboard vars for prod
- Mobile-first, usable one-handed on a phone
- One user account (personal tool, not multi-tenant)
- AI API key is BYO, stored in `localStorage` per device, never written to Firestore

_Historical note: v0.1–0.2 shipped as a zero-build three-file app (`index.html` + `app.js` + `app.css` loaded via CDN ES modules). The migration to TypeScript + Vite preserves the same architecture and Firestore data model; the source is now organized into `src/` modules (see § 3.1) but the client-side logic, security boundary, and data flow are unchanged._

---

## 2. Firebase Architecture

### 2.1 Services Used

| Service | Purpose |
|---|---|
| Firebase Auth | Email/password login; all security anchors to `uid` |
| Firestore | All structured data (items, containers, lists) |
| Firebase Storage | Photo blobs for items and containers |
| Cloud Functions | Not used |

### 2.2 API Key Handling

The Anthropic API key is **not stored in Firestore**. Instead:

- A "Settings" screen prompts the user to paste their key on first use
- The key is saved to `localStorage` under `packrat_anthropic_key`
- It is never written to any network-accessible location
- If `localStorage` is cleared, the user re-enters it
- The tradeoff is explicit in the UI: "Your API key is stored only on this device."

This means AI features work per-device (phone needs its own key entry, laptop needs its own). This is acceptable for a personal tool and removes the most critical security flaw from v0.1.

### 2.3 Firestore Data Model

All data lives under `users/{uid}/` — the security boundary.

#### `users/{uid}` (document)

```
{
  createdAt: timestamp,
  email: string            // denormalized from Auth for display
}
```

No secrets. No API keys.

#### `users/{uid}/containers/{containerId}`

```
{
  name: string,                      // "Osprey carry-on"
  type: "suitcase" | "backpack" | "box" | "bag" | "shelf" | "other",
  location: string,                  // freeform: "storage unit", "closet", "with me"
  parentContainerId: string | null,  // enables nesting: "packing cube inside suitcase"
  photoPath: string | null,          // Firebase Storage path, never a URL
  color: string | null,
  notes: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Nesting note:** The UI supports one level of nesting in v0.1 (container inside container). Deeper nesting is stored correctly but rendered flat. A container with a `parentContainerId` is called a "compartment" in the UI.

#### `users/{uid}/items/{itemId}`

```
{
  name: string,                  // "Black merino t-shirt"
  category: {
    group: string,               // "clothing" — see §2.4 taxonomy
    value: string                // "tops"
  },
  quantityOwned: number,         // how many I own (default 1)
  quantityPackDefault: number,   // how many I usually pack (default = quantityOwned)
  containerId: string | null,    // FK to containers; null = "unassigned"
  photoPath: string | null,
  tags: string[],
  notes: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Why two quantities:** `quantityOwned` answers "how many do I have?" and `quantityPackDefault` answers "how many do I normally bring?" These diverge often — you own 8 t-shirts but typically pack 5. The AI prompt receives `quantityPackDefault` as the recommendation baseline.

#### `users/{uid}/lists/{listId}`

```
{
  name: string,             // "Toiletry essentials"
  isEssential: boolean,     // pre-checked in trip planner by default
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `users/{uid}/lists/{listId}/entries/{entryId}` (subcollection)

```
{
  itemId: string,               // FK to items
  quantityOverride: number | null,  // null = use item's quantityPackDefault
  sortOrder: number,            // float for drag-to-reorder without reindexing
  addedAt: timestamp
}
```

**Why subcollection (not embedded array):**
- Reordering is a single field update (`sortOrder`) with no read-modify-write on the parent
- Adding/removing entries does not require fetching the entire parent doc
- Cascade delete on item removal is a simple client-side scan of `store.listEntries` (see §4.2)
- No 1MB document size risk for large lists
- `sortOrder` uses float spacing (e.g. 1000, 2000, 3000) so insertions between two items just pick the midpoint — no full reindex needed

### 2.4 Category Taxonomy

Stored as `{ group, value }`. UI groups by `group`, labels by `value`.

```
clothing    → tops, bottoms, underwear, socks, outerwear, swimwear, activewear, shoes, accessories
toiletries  → skincare, haircare, shaving, oral-care, medication, supplements, sunscreen, hygiene
electronics → phone-tablet, cables, adapters, audio, camera, computer, accessories
documents   → passport, cards, insurance, cash
gear        → diving, capoeira, outdoor, sports, fitness
media       → books, notebooks, art-supplies
misc        → other
```

### 2.5 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Firebase Storage rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### 2.6 Firestore Reads — Realistic Startup Estimate

After login, the app loads:

| Read | Collection | Notes |
|---|---|---|
| 1 | `users/{uid}` | User doc |
| N | `containers` | All containers (typically 5–30 docs) |
| M | `items` | All item metadata — no photos (typically 50–300 docs) |
| K | `lists` | All list headers |
| K×avg | `lists/*/entries` | All entries for all lists |

Total is `1 + N + M + K + entries`. For a realistic inventory of 200 items, 20 containers, 10 lists with ~15 entries each: roughly 380 document reads at startup. At Firestore free tier (50K reads/day), this is negligible. Subsequent sessions benefit from Firestore's local persistence cache (enabled by default in the web SDK).

The key architectural decision: load all item metadata upfront, not lazily. This enables client-side fuzzy search, tag suggestions, container item counts, "appears in lists" cross-references, and AI prompt construction without additional async reads. Photos remain lazy (loaded on demand via `IntersectionObserver`).

---

## 3. Client Architecture

### 3.1 File Structure

```
/
├── index.html              — Vite entry: shell, view divs, bottom nav, script tag
├── src/
│   ├── main.ts             — app entry, auth, view wiring (most view logic)
│   ├── firebase.ts         — env-var-driven Firebase init (auth/db/storage exports)
│   ├── types.ts            — data model interfaces mirroring § 2.3
│   ├── constants.ts        — CATEGORIES taxonomy, icons, AI model/URL
│   ├── utils.ts            — $/$maybe DOM helpers, esc, sortOrderMidpoint, FormEl
│   ├── csv.ts              — RFC 4180 CSV parser
│   ├── weather.ts          — geocode + historical-climate aggregation
│   ├── ai.ts               — Anthropic prompt building + response parsing
│   ├── styles/             — tokens.css, base.css, components.css, views.css
│   └── __tests__/          — vitest pure-function tests
├── .env.local              — gitignored: VITE_FIREBASE_* values for local dev
└── .env.example            — committed template
```

Loaded via:
```html
<script type="module" src="/src/main.ts"></script>
```

CSS is imported from `main.ts` at runtime:
```typescript
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';
```

Vite handles the dev server (`npm run dev`) and production bundling (`npm run build` → `dist/`). The dist output is a flat directory of static assets (`index.html`, hashed JS bundle, hashed CSS bundle) deployable to any static host.

Firebase SDK is installed from npm and tree-shaken at build time (the app uses ~40% of the SDK surface). `src/firebase.ts` reads config from `import.meta.env.VITE_FIREBASE_*` and throws a clear error at startup if any required var is missing.

### 3.2 Application Shell

One visible view at a time. Router is `showView(name, params)`:

```
view-login         Auth gate
view-dashboard     Summary: item count, container count, quick-add, recent changes
view-containers    Grid of all containers
view-container     Single container detail + items inside it
view-items         Full item list with filter/search
view-item          Single item detail + edit
view-lists         All packing lists
view-list          Single list detail + entries
view-trip          Trip planner: input → weather → AI output
view-settings      API key entry, logout
```

Navigation: bottom tab bar with 4 primary tabs (Containers, Items, Lists, Trip). Settings accessible via a gear icon in the header. A view stack (`history.pushState`) enables the native Back button.

### 3.3 State Management

```javascript
// Module-level in app.js
let currentUser = null;

// Loaded once after login, kept in memory
const store = {
  containers: new Map(),   // containerId → doc
  items: new Map(),        // itemId → doc
  lists: new Map(),        // listId → doc
  listEntries: new Map(),  // listId → Map(entryId → doc)
};

// Photo URL cache: Storage path → download URL (session only)
const photoUrlCache = new Map();
```

`onSnapshot` listeners are set for `containers` and `lists` (small, frequently referenced). Items and list entries are loaded once via `getDocs` after login and updated locally on write — no `onSnapshot` per-item to avoid per-document listener overhead at scale.

### 3.4 Photo Handling

**Upload:**
1. Two buttons: "Camera" (`<input accept="image/*" capture="environment">`) and "Library" (`<input accept="image/*">` — no capture attribute)
2. Selected file → resize via Canvas API (max 1400px longest edge, JPEG quality 0.82)
3. Upload to `users/{uid}/{type}/{id}/{timestamp}.jpg` via `uploadBytes()`
4. Storage path written to Firestore doc

**Replace:**
1. Upload new photo first (get new path)
2. Update Firestore doc with new path
3. Attempt `deleteObject()` on old path — best-effort, swallow error
4. Remove old path from `photoUrlCache`

**Delete item/container:**
1. Delete Firestore doc first
2. Attempt `deleteObject()` on Storage path — best-effort
3. Accept that orphan blobs may accumulate; document this as known behavior

**Orphan policy:** Firebase Storage does not support server-side cleanup triggers in the free tier. Orphan blobs (from failed deletes or replaced photos) are accepted in v0.1. A periodic manual cleanup script (list Storage objects, compare against Firestore paths) is noted as a v0.2 maintenance tool, not a v0.1 feature.

**Render:**
- `IntersectionObserver` used to defer `getDownloadURL()` calls until the photo element enters the viewport (lazy image loading — not DOM virtualization)
- URL cached in `photoUrlCache` after first fetch; no re-fetch within a session
- Skeleton placeholder shown while loading (`@keyframes shimmer` CSS animation)

---

## 4. Feature Specifications

### 4.1 Container Management

**List view (`#view-containers`):**
- CSS grid: 2 columns on mobile, 3 on tablet
- Card: photo thumbnail, name, type icon, item count (computed client-side from `store.items`), location tag
- Compartments (nested containers) shown indented under their parent
- FAB → add container form

**Add/Edit form (inline panel, not a separate view):**
- Name: `<input type="text">` (required)
- Type: `<select>` with icon preview
- Parent container: `<select>` (optional — makes this a compartment)
- Location: `<input>` with `<datalist>` of previously used values
- Color: `<input type="text">`
- Notes: `<textarea>`
- Photo: camera + library buttons

**Delete container:**
- Confirmation dialog: "Move items to Unassigned" (default) or "Also delete all items inside"
- Best-effort Storage cleanup for container photo

### 4.2 Item Management

**List view (`#view-items`):**
- Default: grouped by `category.group`, each group collapsible
- Filter: container selector (`<select>`), category group chips, tag chips — all client-side (no Firestore reads)
- Search: client-side substring match on `name` + `tags` (all metadata in memory)
- Sort: name, category, container, recently updated
- Card: thumbnail, name, `quantityOwned` badge, category chip, container name
- Swipe-left or long-press → delete with 3s undo toast; on confirm, cascade delete runs:
  1. Delete Firestore item doc and best-effort Storage cleanup
  2. Scan `store.listEntries` for all entries referencing this `itemId`; batch-delete those Firestore docs
  3. Remove item and all affected entries from local store

**Item detail:**
- All fields editable via styled form elements (no `contenteditable`)
- `quantityOwned` and `quantityPackDefault` shown as two labeled steppers
- Container: `<select>` populated from `store.containers`
- Tags: text input, comma-separated; auto-suggests existing tags from `store.items`
- "Appears in lists": read-only list of list names, computed by scanning `store.listEntries`

**Add item:**
- FAB on list view → slide-up form panel
- Required: name, category group + value
- Optional: quantities (default both to 1), container, tags, photo, notes

### 4.3 Packing Lists

**List view (`#view-lists`):**
- Simple list: name, entry count, "Essential" badge
- FAB → create new list

**List detail (`#view-list`):**
- Editable name (styled `<input>`)
- Toggle: "Always include in trip planner" (`isEssential`)
- Entry rows: item name + container + quantity override input
- Drag-to-reorder: `sortOrder` field updated on drop (midpoint float between neighbors)
- Swipe-left on entry → remove from list
- Add item: searchable `<select>` or modal picker over `store.items`


### 4.5 CSV Import

Accessible from the Items view via an "Import CSV" button in the header. Intended for initial bulk data entry — the user can build their inventory in a spreadsheet and import it in one step, then add photos individually afterward through normal item editing.

**Expected CSV format:**

```
name,category_group,category_value,quantity_owned,quantity_pack_default,container_name,tags,notes
"Black merino t-shirt",clothing,tops,3,2,"Osprey carry-on","merino,warm weather",""
"Ibuprofen 200mg",toiletries,medication,1,1,"Toiletry bag","meds",""
```

- Header row is required and must match these exact column names
- `quantity_owned` and `quantity_pack_default` default to 1 if blank
- `container_name` is matched case-insensitively against existing containers; if no match, item is created with `containerId: null` (Unassigned) and the unmatched name is flagged in the import summary
- `tags` is a comma-separated string within the cell (use quotes in CSV)
- Columns beyond the defined set are ignored

**Import flow:**

1. User selects a `.csv` file via `<input type="file" accept=".csv">`
2. File is parsed client-side using a minimal hand-rolled CSV parser (no library; RFC 4180 compliant for quoted fields)
3. A preview table renders showing the first 10 rows and a row count — user confirms before write
4. On confirm: batch write all items to Firestore using `writeBatch()` (Firestore supports up to 500 operations per batch; large imports are chunked automatically)
5. Local `store.items` updated in memory
6. Import summary shown: "142 items added, 3 skipped (invalid category), 2 containers not matched (assigned to Unassigned)"

**Validation rules applied before write:**
- `name` must be non-empty
- `category_group` and `category_value` must appear in the taxonomy (§2.4); invalid rows are skipped and counted
- Quantities must be positive integers; malformed values default to 1
- Rows that pass validation but have no photo are imported normally — photos can be added later by tapping the item

**After import:** The Items view reloads from the updated in-memory store. Each imported item is fully editable, including adding a photo by tapping into the item detail view.

### 4.4 Trip Planner

**Input form (`#view-trip`):**

```
Destination:  [text input — e.g. "Cozumel, Mexico"]
Duration:     [text input — e.g. "2 weeks"]
Month:        [<select> Jan–Dec]
Activities:   [checkbox group: Diving, Beach, City, Hiking, Formal, Business, Cold weather]
Extra notes:  [<textarea> — e.g. "wedding dinner on day 3"]
```

Essential lists shown as pre-checked toggles (those with `isEssential: true`).

A "Select items to consider" expandable panel allows the user to include/exclude specific items or containers before generating. All items are pre-checked; the user can uncheck categories or specific items. This is the candidate-selection step — it controls what gets serialized into the AI prompt.

**Execution sequence on "Get packing list":**

**Step 1 — Geocode destination:**
```
GET https://geocoding-api.open-meteo.com/v1/search?name={destination}&count=1
```
Returns `latitude`, `longitude`, and canonical place name.

**Step 2 — Fetch historical climate data:**
```
GET https://archive-api.open-meteo.com/v1/archive
  ?latitude={lat}&longitude={lon}
  &start_date={month_start_last_year}
  &end_date={month_end_last_year}
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum
  &timezone=auto
```
Aggregate daily values into: avg high, avg low, total precipitation, rainy days count. These are 30-day historical averages from the same month last year — meaningful for trip planning.

**Step 3 — Render weather card:**
Before the AI call, display the weather summary immediately so the user sees useful data even if they cancel the AI step:

```
┌──────────────────────────────────┐
│ 🌤  Cozumel, Mexico — May        │
│  High 32°C · Low 25°C            │
│  ~14mm rain · 5 rainy days       │
└──────────────────────────────────┘
```

**Step 4 — Build AI prompt:**

Serialize only the user-selected candidate items (from the selection panel). Each item serialized as:

```json
{
  "id": "itemId",
  "name": "Black merino t-shirt",
  "category": "clothing/tops",
  "quantityOwned": 3,
  "quantityPackDefault": 2,
  "container": "Osprey carry-on",
  "tags": ["merino", "warm weather"]
}
```

System prompt:
```
You are a packing assistant. Respond ONLY with a valid JSON object.
No markdown, no prose, no explanation outside the JSON structure.

Schema:
{
  "packingList": [
    {
      "itemId": string,        // must match an id from the provided inventory
      "itemName": string,
      "quantity": number,
      "container": string,
      "reason": string         // one sentence, only if non-obvious
    }
  ],
  "missingEssentials": [
    {
      "name": string,          // item not in inventory that the trip warrants
      "category": string,
      "suggestion": string     // brief note on what to buy/substitute
    }
  ],
  "weatherNotes": string       // 1-2 sentence clothing/gear note based on climate
}
```

User message:
```
Destination: Cozumel, Mexico
Travel: 2 weeks in May
Climate: avg high 32°C, avg low 25°C, ~14mm rain, 5 rainy days
Activities: Diving, Beach
Extra: None

Inventory (candidate items):
{serializedInventory JSON array}

Essential lists selected: Toiletry essentials (8 items)

Recommend a complete packing list from the inventory above.
```

**Step 5 — Parse and validate JSON response:**

```javascript
let result;
try {
  result = JSON.parse(responseText);
  // Validate all itemIds exist in store.items
  result.packingList = result.packingList.filter(r => store.items.has(r.itemId));
} catch (e) {
  // Show raw response with error banner; don't fail silently
}
```

**Step 6 — Render results:**
- Two sections: "Bring these" (grouped by container) and "Consider buying" (missingEssentials)
- Each "Bring" card: item name, quantity, container name (with colored container badge), reason if present
- Grouped by container so the user can pack one bag at a time
- "Weather note" banner at top of results

**Step 7 — Save as list:**
- "Save as packing list" → creates `lists/{newId}` and `lists/{newId}/entries/*` from `packingList` array
- `quantityOverride` set to the AI-recommended quantity
- Saved list appears in `#view-lists` immediately (local store updated)

---

## 5. Mobile UX Specification

### 5.1 Layout

- `viewport`: `width=device-width, initial-scale=1, viewport-fit=cover`
- `padding-bottom: env(safe-area-inset-bottom)` on bottom nav and all scrollable containers
- Bottom tab bar: 4 tabs — Containers, Items, Lists, Trip
- Header: app name (left), contextual action button (right: Add, Save, or Settings gear)
- No horizontal scrolling

### 5.2 Touch Interactions

| Gesture | Action |
|---|---|
| Tap | Primary action / navigate |
| Long press (500ms) | Context menu (edit, move, delete) on list items |
| Swipe left on list row | Reveal delete button |
| Pinch on photo | Native zoom via `touch-action: pinch-zoom` |

Pull-to-refresh is removed. `onSnapshot` listeners handle live updates for containers and lists. Items are reloaded explicitly on the items view when the user navigates to it after a write.

### 5.3 Forms

- All text inputs: `font-size: 16px` minimum (prevents iOS auto-zoom on focus)
- Quantity inputs: `<input type="number" inputmode="numeric">`
- No `contenteditable` anywhere — all editing via `<input>`, `<select>`, `<textarea>` styled to match the surrounding card
- Validation: inline (border highlight + message beneath field), never `alert()`
- Photo upload: two distinct `<button>` elements that trigger hidden `<input type="file">` elements — one with `capture="environment"`, one without

### 5.4 Performance

- Startup: all item metadata loaded after login (one `getDocs` per collection); photos deferred
- Image loading: `IntersectionObserver` per thumbnail, `getDownloadURL` called only when element enters viewport
- View transitions: CSS `display` toggle, no animations blocking render
- Client-side search and filter: operates entirely on in-memory `store.items` Map — no debounce needed for typical inventory sizes (< 500 items)

---

## 6. Visual Design Direction

**Aesthetic:** Utilitarian-warm. A personal tool used frequently under practical conditions — packing a bag, checking what's in a storage box. Feels like a well-organized notebook: clear hierarchy, high information density, no decorative noise.

**Typography:**
- Display/headers: `DM Serif Display` (Google Fonts CDN link in `index.html`) — character without fussiness
- UI/body: `system-ui, -apple-system, sans-serif` — fast, legible at small sizes, platform-native

**Color tokens (CSS custom properties in `app.css`):**

```css
:root {
  --bg: #F7F4EF;
  --surface: #FFFFFF;
  --border: #E0DAD0;
  --text: #1A1714;
  --text-secondary: #6B6560;
  --accent: #3D7A72;
  --accent-light: #EAF3F2;
  --danger: #C0392B;
  --tag-bg: #EDE8E0;
  --shimmer-start: #EDE8E0;
  --shimmer-end: #F7F4EF;
}
```

**Component patterns:**
- Cards: `border-radius: 12px`, `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`
- Photos: `aspect-ratio: 4/3`, `object-fit: cover`, same border-radius as card
- FAB: 56px circle, fixed bottom-right (above bottom nav), accent color
- Skeleton loaders: `@keyframes shimmer` gradient sweep on photo placeholders
- Container-type icons: inline SVG, one per type, rendered in the card header

---


---

## 7. Out of Scope (v0.1)

- Multi-user sharing
- Barcode/QR scanning
- Export to CSV or PDF
- Explicit offline-first write support
- Cloud Functions or server-side proxy
- Item purchase history or cost tracking
- Baggage weight limit integration
- Periodic orphan Storage blob cleanup (maintenance script, not app feature)

---

## 8. Build Sequence

1. Firebase project setup: Auth, Firestore, Storage, Security Rules
2. `index.html` shell + `app.css` design system (tokens, typography, card patterns)
3. Router (`showView`) + bottom navigation
4. Login/logout + Settings (API key entry/display)
5. Container CRUD (no photos)
6. Item CRUD (no photos) + cascade delete
7. CSV import (bootstraps inventory before photo work begins)
8. Photo upload + lazy render (containers first, then items)
9. Packing lists CRUD (entries subcollection + drag-to-reorder)
10. Weather fetch (geocode → historical archive → weather card)
11. AI trip planner (candidate selection → prompt → JSON parse → render)
12. Save trip result as list
13. Polish: empty states, skeleton loaders, error handling, swipe-delete, undo toast
