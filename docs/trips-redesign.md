# Trips Redesign — Design Doc

Replaces the single trip planner with a trips *collection*: persisted to Firestore, browsable as a list, with a 3-step left/right wizard for *creating* trips, a single-form page for *editing*, and a dedicated detail view that defaults to cached recommendations.

**Status:** v1 shipped in PR #8; v2 (this iteration) redesigns the date model, splits edit from create, enriches climate data, adds units preference.
**Replaces:** the single-form trip planner (but reuses its weather/AI helpers)
**Deltas from this doc → implementation:** see [§ 13](#13-deltas-from-doc-to-implementation)

---

## 1. Goals

- **Trips are data** — persist to Firestore so you can come back to them, edit, delete, browse prior ones, sort chronologically.
- **Left/right split layout** — form inputs on the left, live visualization on the right (map, weather, summary). Desktop shows side-by-side; mobile stacks (left above right).
- **Focused wizard** — creating a trip is 3 steps, one topic per step. Works one-handed on a phone; feels deliberate on a desktop.
- **Recommendations first** — opening a saved trip jumps straight to AI output. Edit is a secondary action.
- **Save is decoupled from AI** — saving a trip does *not* require an API key. AI generation is a separate step the user triggers explicitly (or that runs automatically as a convenience when a key is present).
- **Customizable activities** — editable list in Settings.
- **Unique trip URLs** — composed from destination + months + year + duration; can't create two of the same.

## 2. Non-goals

- Sharing trips with other users
- Interactive maps (pan/zoom) — static preview is enough
- Real-time reactivity during editing — user explicitly hits Save / Regenerate
- Replacing `docs/design.md`'s core architecture

## 3. Decisions from feedback

### v1 decisions (shipped in PR #8)

1. **Save decoupled from AI.** Save = write the trip to Firestore. Regenerate = call AI and cache the result. A trip with `aiResult: null` is a valid trip — the detail view renders a "Generate recommendations" CTA instead of the packing list. No API key required to create, edit, or save. Transient AI failures don't block persistence.

2. **Single PR, no rollout regression.** This lands as one PR. The old `/trip` view is removed and `/trips` + `/trips/:id` + `/trips/new` + `/trips/:id/edit` all land together. No in-between state where create is broken.

3. **Inventory snapshot semantics.** At save time, the trip captures a concrete `candidateItemIds: string[]` array (never `null`). AI output is kept as-is on the trip (not live-joined with `store.items`). The detail view displays `aiResult.packingList[].itemName` directly from the AI result. Staleness is surfaced two ways:
   - If any `aiResult.packingList[].itemId` no longer exists in `store.items`, show a small "inventory changed" badge.
   - "Save as packing list" only creates entries for itemIds that still exist.

4. **User doc loading.** The store currently has `store.user` (the Auth user) but never reads `users/{uid}` from Firestore. This PR adds a lightweight `userDoc: { activities?: string[] }` load alongside the other collections in `loadAllData`. Custom activities fall back to `DEFAULT_ACTIVITIES` from constants when unset.

5. **Router navigation guard.** The wizard registers a `beforeLeave` hook. Edit-mode wizard confirms unsaved-changes on back/nav-tab click; create-mode doesn't (it's greenfield). `showView` checks the hook before switching views.

### v2 decisions (this iteration)

6. **Dates: start-month + duration, not picked months + year.** The original UX let users pick any multi-month combo + a free-text duration ("2 weeks"), which produced nonsensical states — a 1-month duration with 3 months selected, a 4-week duration spanning only 1 picked month. New model: user picks a **start month**, a **start year**, a **duration count**, and a **duration unit** (`days` / `weeks` / `months`). The set of covered months is *derived* from these four inputs. Climate aggregation uses the derived months. A 13-day trip starting mid-May covers `[May]`; a 6-week trip starting Apr covers `[Apr, May]`; a 4-month trip starting Nov 2026 covers `[Nov, Dec, Jan, Feb]` (and spans into 2027, but `startYear` anchors climate lookups).

7. **Edit is a form, not a wizard.** The 3-step wizard is only for `/trips/new` — creation is guided, fields are discovered one at a time. Once a trip exists, `/trips/:id/edit` renders all fields on a single scrollable page: destination + map, start date + duration + climate, activities + notes + candidates. No Next/Back buttons. Rationale: editing is targeted ("fix the year, regenerate") — making the user click through 3 steps to change one field is friction.

8. **Clickable step dots in the wizard.** The progress indicator (Where / When / What) doubles as navigation. Clicking an earlier dot jumps to that step (always allowed). Clicking a later dot jumps forward *only if* all prior steps validate — otherwise the click is a no-op and the currently-broken step's error surfaces. Makes the wizard feel like a form; you can jump back to fix the destination without Back-clicking twice.

9. **Trip index cards are rich.** List rows gain a small map-tile thumbnail (OSM tile lookup, not iframe — static image, no cross-origin overhead in a list) and a weather summary chip (emoji + avg high + rainy-day fraction). Rows remain fully clickable to open detail view. Rationale: the text-only list was hard to scan; the map + weather give instant orientation.

10. **Climate enrichment.** Add **cloud cover** and **relative humidity** to the Open-Meteo fetch + `MonthlyClimate` + aggregated `TripWeatherData`. Display both in the climate strip. Rainy days rendered as a fraction of total trip days: `8 / 14 rainy days (~57%)` — absolute counts alone don't communicate intensity.

11. **Units preference (°C / °F).** Settings gains a Units toggle. Stored in `localStorage` under `packrat_units`, defaults to `'celsius'`. All temperature displays (climate strip, detail view weather, trip cards) read through a formatter that converts from the stored Celsius values. No re-fetching — Open-Meteo returns Celsius; conversion is display-only.

12. **Default year = current year (no free-text).** Year becomes a small dropdown of `[current year, current year + 1, current year + 2, current year - 1]` (recent past for post-trip logging + next two years for planning). Simpler than validating a free-text numeric input.

## 4. Data model

### Collection: `users/{uid}/trips/{tripId}`

```ts
type DurationUnit = 'days' | 'weeks' | 'months';

interface Trip {
  id: string;                    // slug-based (see § 5) — also the Firestore doc ID
  name: string;                  // display name, e.g. "Italy — May 2026"
  destination: string;           // raw input
  location: GeoLocation | null;  // resolved via Open-Meteo
  startMonth: number;            // 0-11
  startYear: number;             // e.g. 2026
  durationCount: number;         // integer >= 1
  durationUnit: DurationUnit;
  activities: string[];
  notes: string;
  candidateItemIds: string[];    // snapshot at save time
  yearClimate: MonthlyClimate[] | null;  // cached
  aiResult: TripAIResult | null;          // cached; null = no recs yet
  aiGeneratedAt: TimestampField | null;   // when AI last ran
  createdAt: TimestampField;
  updatedAt: TimestampField;
}
```

### Derived fields

Never stored; computed via pure helpers in `src/trips.ts`:

```ts
// Expand start-month + duration into month indices covered.
// 13 days starting May 20 → [4]   (month 4 = May)
// 13 days starting May 25 → [4, 5] (spills into June)
// 6 weeks starting Apr 15 → [3, 4] (Apr + May)
// 4 months starting Nov   → [10, 11, 0, 1]
spannedMonths(trip): number[]

// Total trip length in days, for display + rainy-day math.
// weeks → 7×, months → 30× (calendar-approximate is fine)
durationToDays(count, unit): number

// "2 weeks", "5 days", "1 month" — human string
formatDuration(count, unit): string
```

**Why approximate month lengths?** The climate fetch is monthly-aggregated already; day-level precision would imply a precision the data doesn't have. 30 days × 4 months = 120 days for a "4-month" trip is close enough for rainy-day fractions and packing-decision heuristics.

**Why `startYear` not a year range?** A trip spans at most a handful of months. For climate lookup, we fetch `startYear`'s monthly data (Open-Meteo archives go back decades; years beyond archive = fallback to climatology). A Dec→Jan trip uses Dec from startYear and Jan from startYear+1 — but the climate strip displays them together under one header.

### Climate enrichment

`MonthlyClimate` gains two fields, populated from new Open-Meteo parameters:

```ts
interface MonthlyClimate {
  monthIndex: number;
  avgHigh: number;
  avgLow: number;
  rainyDays: number;       // days with >1mm precip
  totalPrecipMm: number;
  cloudCoverPct: number;   // NEW — mean daily cloud cover
  humidityPct: number;     // NEW — mean relative humidity
}

interface TripWeatherData {
  avgHigh: number | null;
  avgLow: number | null;
  totalRainyDays: number | null;
  totalPrecipMm: number | null;
  cloudCoverPct: number | null;   // NEW
  humidityPct: number | null;     // NEW
  totalDays: number;              // NEW — for rainy-day %
}
```

Open-Meteo request adds: `cloud_cover_mean`, `relative_humidity_2m_mean`. Both are already in the free archive API.

### Store additions (`src/store.ts`)

- `store.trips: Map<string, Trip>`
- `store.userActivities: string[] | null` (populated from user doc)
- `loadAllData` also loads trips + user doc in parallel
- `onSnapshot` listener for trips (parallel to containers/lists)
- New helpers: `createTrip`, `updateTrip`, `deleteTrip`, `saveUserActivities`

### User doc: `users/{uid}`

Current shape: `{ createdAt, email }`. Add optional `activities: string[]`. Unset = use constants. Written only on first customization.

## 5. Trip IDs (slugs)

Trip doc IDs are composed slugs — the same input produces the same ID, so Firestore's "doc already exists" check enforces uniqueness for free.

### Format

```
{destination-slug}-{start-month}-{start-year}-{duration-count}-{duration-unit}
```

Examples:
- `italy-may-2026-2-weeks`
- `cozumel-dec-2026-5-days`
- `japan-apr-2027-10-days`
- `nz-nov-2026-4-months`

### Slug rules

- lowercase, ASCII only (strip accents)
- non-alphanumeric → `-`
- collapse repeated dashes, trim leading/trailing dashes
- destination uses the raw user input (not the geocoded location), so "Cozumel" → `cozumel`, not the geocoded `cozumel-mexico`
- start month: 3-letter abbrev (`jan`, `feb`, ...)
- duration: `{count}-{unit}` (e.g. `2-weeks`, `10-days`, `4-months`). Unit is always plural for consistency, even with count 1.

### Uniqueness handling

- On create: if `setDoc` with `{ merge: false }` finds an existing doc, throw → show toast "You already have a trip for {destination} in {startMonth} {startYear}. Open the existing one instead."
- On edit: if user changes destination / startMonth / startYear / duration such that the new slug differs from the current ID, create new doc + delete old (rare, but possible). If new slug collides with another existing trip, block save with toast.

### Display name

```
{Destination} — {MonthsLabel} {Year}
```

Where `MonthsLabel` is the derived month range: `May`, `Apr–May`, `Nov–Feb`.
Examples: `Italy — May 2026`, `Japan — Apr–May 2027`, `New Zealand — Nov–Feb 2026`.
Stored in `name` field; editable in the wizard/edit form. Regenerated automatically when destination/startMonth/startYear/duration change *and* the user hasn't manually edited the name.

## 6. Routes

| URL | View | Purpose |
|---|---|---|
| `/trips` | `trips` | List of all trips (with map thumbnails + weather chips) |
| `/trips/new` | `trip-wizard` | 3-step wizard (create) |
| `/trips/:id` | `trip` | Detail view — cached AI recs by default |
| `/trips/:id/edit` | `trip-edit` | Single-form edit page |

Routes updated in `router.ts`:
- `urlToRoute` parses `/trips`, `/trips/new`, `/trips/:id`, `/trips/:id/edit`
- `routeToUrl` emits the same
- `VIEW_TITLES` gains entries
- `TOP_LEVEL_VIEWS` includes `trips` (primary tab) but NOT `trip` / `trip-wizard` (those are children)

Bottom-nav tab: rename "Trip" → "Trips", points at `/trips`.

The old `/trip` view code is removed entirely. Not keeping a redirect — this app isn't deployed broadly, any bookmarks will 404-then-redirect to containers per the existing `urlToRoute` fallback.

## 7. Views

### 7.1 Trips index (`/trips`)

List grouped chronologically. Sort key: `(startYear, startMonth)` descending (most recent planned trips first). Past trips still listed, just lower.

```
┌──────────────────────────────────────────┐
│ ┌────┐  Italy — May 2026               ›│
│ │map │  Rome · 2 weeks · City, Formal   │
│ │    │  ☀️ 24° · 3/14 rainy (~21%)       │
│ └────┘  ★ Recommendations ready          │
├──────────────────────────────────────────┤
│ ┌────┐  Cozumel — Dec 2026             ›│
│ │map │  Cozumel · 5 days · Diving, Beach│
│ │    │  ⛅ 28° · 2/5 rainy (~40%)        │
│ └────┘  ⚠ No recommendations yet         │
└──────────────────────────────────────────┘
                                       ⊕ FAB
```

- Each row (fully clickable → detail view):
  - **Map thumbnail** (~64×64): OSM tile PNG at zoom 5, from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. If no `location` yet, render a muted placeholder square.
  - Trip name
  - One-line summary: destination · duration · activities
  - Weather chip: emoji + avg high (unit-aware) + rainy fraction (e.g. `3/14 rainy (~21%)`). Only rendered if `yearClimate` is cached.
  - Status badge: recs ready / no recs / inventory-stale
- **FAB** → create trip. If no API key: still opens wizard (save is decoupled); inline hint on step 3.
- **Tap a row** → open detail view (where Delete lives). No swipe-delete — matches `/lists` pattern, avoids accidents.
- **Empty state:** "No trips yet. Tap + to plan one."

**Why a tile PNG, not an iframe?** Iframes are heavy to list — a grid of 10+ embeds would hammer OSM and destroy scroll perf. A tile PNG is a single image, caches, scales. Trades precision (tile boundaries don't center on the pin) for listability.

### 7.2 Trip detail (`/trips/:id`)

Default view shows cached AI result.

```
┌─────────────────────────────────────┐
│  Italy — May 2026               ⋮   │ kebab menu
│  Rome, Italy · May · 2 weeks        │
├─────────────────────────────────────┤
│  ☀️ Rome · May 2026                 │
│    24° high · 14° low                │ weather card (cached, unit-aware)
│    3/14 rainy (~21%) · 45% cloud     │
│    62% humidity                      │
├─────────────────────────────────────┤
│ 📝 WEATHER NOTES                    │
│ Dress in layers; pack a rain jacket.│
├─────────────────────────────────────┤
│ 📦 OSPREY CARRY-ON                  │
│ × 2  Black merino t-shirt           │
│ × 1  Rain jacket (non-obvious)      │
│ ...                                 │
├─────────────────────────────────────┤
│ 🛒 CONSIDER BUYING                  │
│ • Travel adapter (Italy uses C)     │
└─────────────────────────────────────┘
   [Edit]  [Regenerate]  [Save as list]
```

**When `aiResult === null`:**

```
Recommendations not yet generated.

  [Generate recommendations]    ← disabled if no API key
  (Requires an Anthropic API key in Settings)
```

**Action row** (below the trip header, always visible): Edit · Regenerate (when aiResult exists) · Save as packing list (when aiResult exists) · Delete. Inline buttons — a kebab menu was considered but the action row has enough space and makes the actions discoverable without an extra tap.

**Staleness handling:**
- **Inventory badge** — if any `aiResult.packingList[].itemId` is missing from `store.items`, show a small yellow chip "⚠ Some items no longer in inventory".
- **Input drift badge** — if `updatedAt > aiGeneratedAt`, show "Recommendations outdated — inputs have changed since last generation".

**Save as packing list** — only creates list entries for itemIds that still exist.

### 7.3 Wizard (`/trips/new` only)

Progress indicator at top, left/right split, Back/Next (or Save) at bottom. **Create-only** — editing uses the single-form view in § 7.4.

**Responsive:**
- Desktop (≥768px): left 42% / right 58%, side-by-side, independently scrollable, top-aligned.
- Mobile (<768px): left above right, single scroll. Right panel gets a subtle header ("Preview") to visually separate it.

**Progress indicator (clickable):**

```
  [●]─────[○]─────[○]
  Where?  When?   What?
```

Each dot is a button. Click behavior:
- **Backward** (clicking a completed step): always allowed, jumps to that step.
- **Forward** (clicking an uncompleted step): only if all intermediate steps validate. Otherwise the click surfaces the validation error of the first broken step (same error a Next-click would show) and stays put.
- **Current step**: no-op.

Completed / current / locked states are visually distinct (filled / outlined / muted).

**Exit guard:** none for create (no saved data to lose). The navigation guard lives on the edit form (§ 7.4).

---

### Step 1 — Where?

**Left:**
- Destination text input (debounced 400ms geocode)
- Trip name (auto-generated from destination + startMonth + startYear; editable; regenerates while user hasn't manually overridden it)

**Right:**
- Empty: "Type a destination to see the map"
- Resolved: OpenStreetMap iframe centered on the resolved lat/lon (see § 8), with the name + coordinates below
- Error: "Couldn't find 'xyz'. Try a different spelling or be more specific." — the map clears (new search is active; keeping a stale map for a non-matching query would be confusing)

**Validation:** `location !== null` to proceed.

---

### Step 2 — When?

**Left:**
```
┌────────────────────────────────────────┐
│ Start                                   │
│  [Month: May ▼]  [Year: 2026 ▼]         │
│                                         │
│ Duration                                │
│  [ 2 ]  [weeks ▼]                       │
│                                         │
│ ↳ Covers May 2026 (≈14 days)           │ derived hint, muted
└────────────────────────────────────────┘
```

- **Start month**: dropdown, 12 months, defaults to current month.
- **Start year**: dropdown of `[current-1, current, current+1, current+2]`, defaults to current year.
- **Duration count**: numeric input, min 1, max 365.
- **Duration unit**: dropdown `days` / `weeks` / `months`, defaults to `days`.
- **Derived hint** below inputs: shows the spanned months + approximate total days (e.g. `Covers Apr–May 2026 (≈42 days)`).

**Right:**
- Year-round climate strip, with **highlighted** bars for the derived month span.
- Aggregated summary for the derived months:
  - `☀️ 24° high · 14° low` (unit-aware)
  - `3/14 rainy days (~21%)` (fraction + percent)
  - `45% cloud cover · 62% humidity`
- If year's data hasn't loaded yet: skeleton.

**Validation:** `durationCount >= 1` (dropdowns and year always have values).

---

### Step 3 — What?

**Left:**
- Activities: chip grid (reads user's custom list, falls back to `DEFAULT_ACTIVITIES`)
- Notes textarea
- "Items to consider" collapsible panel

**Right:**
- Live summary card:
  ```
  Italy — May 2026
  Rome · May 2026 · 2 weeks
  Activities: City, Formal
  Notes: Wedding day 3
  Candidates: 42 items
  ```

**Validation:** none (can save without activities or notes).

**Save button:**
- Writes the trip to Firestore (no AI call)
- Navigates to `/trips/:id` detail view
- If the user has an API key set, **auto-triggers a Regenerate** after navigation for convenience — but the navigation and save happen regardless.
- If slug collides with existing trip: toast + stay on wizard.

---

### 7.4 Edit form (`/trips/:id/edit`)

Single-page form, not a wizard. All fields visible; user scrolls. Left/right split matches the wizard so visual affordance is consistent.

**Left (top to bottom):**
1. **Destination + trip name** (same inputs as wizard step 1)
2. **Start month + year + duration count + unit** (same inputs as wizard step 2; with derived-hint line)
3. **Activities chips**
4. **Notes textarea**
5. **Items to consider** (collapsible)

**Right (sticky, scrolls independently on desktop):**
- Map (iframe) if destination resolved
- Climate summary for derived months
- Live summary card (as in step 3)

**Footer (sticky):** `[Cancel]` `[Save changes]`
- **Cancel** — if draft is dirty, confirm "Discard changes?"; else navigate back to detail view.
- **Save** — validates destination + durationCount, writes to Firestore, navigates to detail view.

**Navigation guard:** if draft differs from saved trip, `beforeLeave` hook confirms on back / nav-tab click.

**Why a single form for edit?** Editing is targeted — you know what you're changing. A 3-step wizard makes the user hunt for the right step. Creation benefits from guided steps because the user is building context.

## 8. Static map

**Approach:** OpenStreetMap. No API key, no new dependency. Two use cases, two forms:

### 8.1 Detail + wizard/edit right panel — iframe embed

`https://www.openstreetmap.org/export/embed.html?bbox={minLon},{minLat},{maxLon},{maxLat}&marker={lat},{lon}` — shows OSM centered on the pin, with the pin visible. Zero JS dep. 4:3 aspect, full width of right panel.

The iframe URL is built from the resolved lat/lon with a 0.4° bbox padding (~40km — enough for a city view without being too zoomed out for larger regions).

The location name + coordinates render below the iframe regardless, so users still see *where* even if the iframe fails. No explicit iframe-failure fallback card — cross-origin iframes don't reliably surface load errors to JS, and the text below is a functional substitute.

### 8.2 Trips index cards — static tile PNG

`https://tile.openstreetmap.org/{z}/{x}/{y}.png` at zoom 5 (country-level). Rendered as a `<img>` tag, ~64×64. One PNG per trip card.

Tile coords derived from lat/lon via the standard slippy-map projection:
```ts
x = floor((lon + 180) / 360 * 2^z)
y = floor((1 - ln(tan(lat_rad) + sec(lat_rad)) / π) / 2 * 2^z)
```

**Why zoom 5, not 6?** A country-level view gives geographic context in a 64px square. Higher zoom shows a featureless tile; lower zoom shows too much ocean.

**Why not iframes for cards?** A list of 10+ iframes hammers OSM's embed endpoint and kills scroll perf. Tile PNGs cache at the browser and CDN level.

## 9. Custom activities in Settings

New Settings section between "AI" and "Data":

```
ACTIVITIES
─────────────────────────────
Used in the Trip wizard's activity picker.

  Diving      ✕
  Beach       ✕
  City        ✕
  ...
  [+ Add activity]

  [Reset to defaults]
```

**Storage:**
- `users/{uid}.activities: string[]` on the Firestore user doc
- Loaded in `loadAllData` into `store.userActivities`
- Read at render time: `store.userActivities ?? DEFAULT_ACTIVITIES`
- Written only on first customization (so untouched users keep a `undefined` field)

**Validation:** non-empty strings, trimmed, deduped case-insensitively, max ~50 chars each. No hard upper limit on count.

### 9.5 Units preference

New Settings toggle between "AI" and "Activities":

```
UNITS
─────────────────────────────
Temperature display

  ( ● ) Celsius   (°C)
  (   ) Fahrenheit (°F)
```

**Storage:** `localStorage` key `packrat_units`, value `'celsius' | 'fahrenheit'`. Default `'celsius'`.

**Why localStorage, not Firestore?** Display preference — device-local is fine, and avoids a write on every toggle. Doesn't need to sync across devices.

**Display pipeline:**
- All climate data is fetched + stored in Celsius (Open-Meteo's native unit).
- `formatTemp(celsius: number): string` reads the preference and returns either `24°` or `75°` — no `C`/`F` suffix in the string (the toggle sets the expectation).
- Affected surfaces: climate strip, trip detail weather card, trip index weather chips, wizard step 2 aggregated summary.
- The toggle fires a custom event that triggers a re-render of the currently-visible view. No need to refetch.

## 10. API-key gating

- **Create FAB on `/trips`:** enabled. The wizard itself doesn't require a key.
- **"Generate recommendations" button in detail view:** always enabled. When no key is set, clicking navigates to Settings (instead of sitting disabled with a tooltip the user can't act on).
- **Save button in wizard step 3:** always enabled. After save, if a key exists, auto-regenerate as a convenience; otherwise just navigate to detail view.
- **Regenerate button in detail view:** same behavior as Generate — always enabled, navigates to Settings if no key.

**Why not disabled?** A disabled button with "Add API key first" as its label is a dead-end — the user is told what to do but can't do it from the button. Making the button the *thing that takes you to Settings* means one click to resolve the missing-key state.

## 11. Component reuse

| Existing piece | Status |
|---|---|
| `fetchYearClimate`, `aggregateMonths` | Reused, extended with cloud/humidity |
| Year-round climate strip | Reused, highlights derived months instead of picked months |
| Candidate selector panel | Reused |
| `callAI` with AbortSignal | Reused |
| `inventoryFromItems`, `buildUserMessage`, `parseAIResponse` | Reused |
| Activity button click handling | Reused |
| Navigation guard (`beforeLeave` on `showView`) | Reused (now on edit form, not wizard) |
| Multi-month chip picker | **Removed** — replaced by start-month + duration model |
| Single-form planner layout | Removed |
| `maybeCallAI` reactive pattern | Removed (explicit save/regenerate instead) |

**Testable pure helpers** live in `src/trips.ts` and are unit-tested in isolation:
- slug + display: `slugify`, `tripSlug`, `tripDisplayName`, `formatMonthsLabel`
- date math: `spannedMonths`, `durationToDays`, `formatDuration`
- staleness + timestamps: `timestampMillis`, `isAIOutdated`, `staleItemIds`
- trip sort: `compareTripsDesc`
- weather: `weatherEmoji`, `formatTemp`, `formatRainyDays`
- maps: `staticMapUrl` (iframe), `mapTileUrl` + `latLonToTile` (static PNG)
- wizard: `validateStep`, `snapshotDraft`

The `main.ts` view code consumes these via thin wrappers that inject the live store — keeps the Firestore/DOM coupling out of the pure-function surface.

## 12. Open questions resolved

1. **Map provider:** OSM iframe for panels, OSM tile PNGs for list cards. No key, no dep.
2. **Trip name format:** `{Destination} — {MonthsLabel} {Year}`, e.g. `Italy — May 2026`.
3. **`/trip` redirect:** none needed (app not yet widely deployed).
4. **Trip name uniqueness:** enforced via slug-based doc IDs. Can't have two `italy-may-2026-2-weeks`.
5. **Regenerate updates `aiGeneratedAt` only**, not `updatedAt` — keeps the "outdated" staleness badge clean.
6. **Exit confirm:** edit form, yes. Wizard (create), no. Navigation guard via `showView` hook.
7. **Right panel scroll:** independently scrollable, both top-aligned.
8. **Mobile layout order:** left above right.
9. **Date model:** start-month + duration (not picked months). Months are derived. (v2)
10. **Units:** °C / °F toggle in Settings, localStorage-persisted. (v2)
11. **Approximate month length:** 30 days for `durationUnit === 'months'`. Weeks = 7×. Good enough for monthly-aggregated climate data. (v2)
12. **Legacy trip migration:** on load, derive `startMonth = months[0]`, `startYear = year`, parse `duration` ("2 weeks" → count=2, unit=weeks) via a best-effort parser. Unparseable durations default to `{count: 7, unit: 'days'}`. (v2)

## 13. Deltas from doc to implementation

During build, a few things changed from the original spec. Documenting here so the doc reflects what shipped:

### v1 (PR #8)

| Delta | Doc said | Shipped | Why |
|---|---|---|---|
| Trip list delete | Swipe-left / long-press on list rows | Delete button on detail view | Matches existing `/lists` pattern; avoids accidental swipes; keeps the list display clean. |
| Detail view actions | Kebab menu (⋮) | Inline button row | Space allows for discoverable inline buttons; no extra tap needed. |
| Step 1 error UX | "Keeps previous map visible" on geocode failure | Clears map, shows error message | A stale map for a non-matching query confuses the user — the new search is the current intent. |
| Step 1 error text | "Couldn't find that location" | "Couldn't find 'xyz'. Try a different spelling or be more specific." | More actionable + includes the offending input. |
| Map iframe fallback | Text card if iframe blocked | Location name + coords always rendered below the iframe | Cross-origin iframes can't reliably signal load failure to JS; the text below is a functional substitute. |
| Map bbox padding | "~1°" | 0.4° | Tighter city view; still wide enough for country-level results. |
| Trip-name regeneration | Regenerates while user hasn't edited it | Same, but "edited" is strict equality against auto-generated — so going back to the auto value resumes regeneration | Edge case of user typing the auto value manually, not worth complicating. |

### v2 (this iteration)

| Delta | Initial spec | Shipped | Why |
|---|---|---|---|
| Step 2 no-months state | "Pick one or more months" prompt (v1 behavior) | Obsolete — v2 always derives ≥1 month from startMonth + durationCount ≥ 1 | New date model can't produce an empty month span. |
| API-key gating on Generate/Regenerate | Disabled button with inline hint when no key | Button always enabled; navigates to Settings when no key | Disabled button that says "add key" is a dead-end — can't act on it. Clicking should resolve the state. |
| ViewParams.mode field | `mode: 'new' \| 'edit'` on router params to discriminate wizard vs edit | Removed — `/trips/new` is the only wizard URL, `/trips/:id/edit` routes to the distinct `trip-edit` view | Wizard became create-only; the mode discriminator is dead weight. |

None of these affect the architectural decisions or the data model.

## 14. V2 implementation notes

### Migration from v1 to v2 Trip docs

Existing v1 trips in Firestore have `months: number[]`, `year: number`, `duration: string`. On load, migrate in-memory (do not rewrite Firestore):

```ts
function migrateTrip(raw: any): Trip {
  if ('startMonth' in raw) return raw; // already v2
  return {
    ...raw,
    startMonth: raw.months?.[0] ?? new Date().getMonth(),
    startYear: raw.year,
    ...parseDuration(raw.duration),
  };
}

function parseDuration(s: string): { durationCount: number; durationUnit: DurationUnit } {
  const m = s.trim().toLowerCase().match(/^(\d+)\s*(day|week|month)s?$/);
  if (!m) return { durationCount: 7, durationUnit: 'days' };
  return { durationCount: parseInt(m[1]!), durationUnit: (m[2] + 's') as DurationUnit };
}
```

On first `updateTrip` after migration, the new fields persist. `months`/`year`/`duration` fields are left in Firestore as dead fields (harmless; no deploy coordination needed).

### Clickable step dots — validation logic

```ts
function canJumpTo(targetStep: 1 | 2 | 3, currentStep: number, draft: TripDraft): boolean {
  if (targetStep <= currentStep) return true; // backward always ok
  // forward: all intermediate steps must validate
  for (let s = 1 as 1 | 2 | 3; s < targetStep; s++) {
    if (!validateStep(s, draft).ok) return false;
  }
  return true;
}
```

When a forward jump fails, show the same error toast that a Next-click would show, derived from the first failing step. This makes the dots behave consistently with the Next button.

### Edit form layout

The edit form reuses the left/right CSS grid from the wizard. Differences:
- No `.wizard-progress` header
- Left panel shows all 5 sections sequentially (destination / dates / activities / notes / candidates), each with a light divider
- Right panel is `position: sticky; top: var(--header-height)` on desktop; inline at the top on mobile
- Footer `[Cancel] [Save]` bar is `position: sticky; bottom: 0` with a subtle border-top

No new CSS class tree — the existing `.wizard-split` grid plus a `.trip-edit-form` modifier covers it.
