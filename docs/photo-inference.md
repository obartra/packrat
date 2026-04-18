# Photo Inference — Design Proposal

**Auto-populate item fields from a photo using vision AI**

## 1. Goal

When a user takes or selects a photo for an item, send the image to a vision-capable LLM and get back structured JSON with as many item fields as the model can confidently determine. The user reviews the suggestions in the form (pre-filled but editable) before saving — the AI accelerates data entry but never writes to Firestore without confirmation.

---

## 2. New Item Fields

The current `Item` type captures name, category, quantities, container, tags, and notes. A photo gives the model enough signal to infer richer metadata that's useful for packing decisions, search, and visual identification.

### 2.1 Proposed additions to `Item`

| Field | Type | Why it helps |
|---|---|---|
| `color` | `string \| null` | Hex value of the item's primary/dominant color (e.g. `"#1B3A5C"`). The AI identifies the item in the photo and picks its dominant color, ignoring the background — something canvas-based pixel sampling can't do without a separate segmentation step. Hex enables: color swatch dots on item cards, grouping/filtering by color family (bucket hex ranges into ~12 named families client-side), and duplicate detection in the trip planner. For multi-color items the model picks the single most dominant color. Human-readable color names (e.g. "navy") can be derived client-side from the hex bucket rather than stored. |
| `description` | `string \| null` | 1-2 sentence factual description, editable. `name` stays short for cards ("Black running shorts"); `description` carries packing-relevant detail ("Lightweight quick-dry synthetic shorts with built-in liner, Patagonia"). Gives the trip planner much richer context for item-to-activity matching than name + category alone. Brand and material info lives here naturally rather than as separate fields. |

**Why only two fields:** The bar for a structured field is that it must be (a) reliably identifiable from a photo, (b) independently useful for search/filtering/trip planning beyond what `description` provides, and (c) worth the form space.

`color` clears this bar — hex is visually obvious from a photo, renders as a swatch on cards, and enables real grouping/filtering by color family without normalization issues that plague free-form text. `description` clears it because free-text carries richer signal than any set of structured fields and feeds directly into the trip planner prompt.

**Deliberately excluded:** brand, material, weight, size, and condition — all either hallucination-prone from photos or redundant with what `description` captures naturally.

### 2.2 Category taxonomy changes

The inference prompt needs a taxonomy to classify into. This is a good opportunity to fill gaps in the current taxonomy that affect both inference accuracy and general usability.

**New groups:**

| Group | Subtypes | Why |
|---|---|---|
| `travel` | `comfort`, `organization`, `security`, `other` | Core to a packing app — neck pillows, packing cubes, luggage locks currently land in `misc/other`. Subtypes are broad buckets (not item names) so the dropdown stays useful as inventory grows. `comfort` = pillow, eye mask, blanket; `organization` = packing cubes, compression bags; `security` = luggage lock, money belt. |
| `food` | `snacks`, `beverages`, `baby-food`, `other` | People pack food for long trips, road trips, and international travel. Currently no home for these items. |

**Expanded existing groups:**

| Group | Added subtypes | Why |
|---|---|---|
| `toiletries` | `fragrance`, `first-aid` | Perfume/cologne and first-aid kits (bandages, antiseptic, etc.) are commonly packed and don't fit existing subtypes. `first-aid` is distinct from `medication` (prescription/OTC drugs). |

**Implementation notes:**
- Add groups to `CATEGORIES` in `src/constants.ts` and `CategoryGroup` union in `src/types.ts`
- Add icons to `CATEGORY_ICONS` and `SUBCATEGORY_ICONS` in `src/constants.ts`
- Existing items are unaffected — their categories remain valid
- The AI prompt taxonomy and the app taxonomy must stay in sync. Generate the prompt taxonomy string from `CATEGORIES` at runtime rather than hardcoding it in the prompt, so they can't drift.

**Sequencing:** The taxonomy changes are useful independent of photo inference (they fix real gaps in manual item creation too). They should land as a **separate PR first**, so inference builds on top of the expanded taxonomy rather than bundling unrelated concerns into one change. This also makes the inference PR smaller and easier to review. The taxonomy PR should also update `docs/design.md` §2.4 to match `src/constants.ts` (which is the source of truth — the two have already drifted).

### 2.3 Firestore migration

No Firestore migration needed — it's schemaless, so new fields are simply absent on old docs. New category groups are additive — old docs with existing groups remain valid.

**TypeScript:** New fields must be optional on the `Item` interface (`color?: string | null`, `description?: string | null`) so old docs don't violate the type contract.

---

## 3. Inference API

### 3.1 Model choice

Use the same Anthropic API key and endpoint already in `localStorage` — no second key needed.

Use `claude-haiku-4-5` for inference. Reasons:

- **Speed:** Haiku responds in ~1-2s for a single image + short prompt, vs ~3-5s for Sonnet. For a "fill out this form" task, latency matters more than reasoning depth.
- **Cost:** ~10x cheaper than Sonnet per token. Photo inference happens on every item add/edit, so volume is much higher than trip planning (which happens a few times per trip).
- **Accuracy:** For object recognition, color identification, category classification, and generating a short description, Haiku is more than sufficient. This is a perception task, not a reasoning task.

Store the model as a constant in `src/constants.ts` (e.g. `AI_INFERENCE_MODEL`) separate from `AI_MODEL` used for trip planning, so they can be tuned independently.

### 3.2 Structured outputs

Use Anthropic's structured output support (`output_config.format` with a JSON schema) rather than prompt-based JSON instructions. This guarantees valid JSON and eliminates parse error handling. The only remaining error cases are network/timeout failures and max-token truncation.

### 3.3 Image encoding

Send the image as base64 inline — it's already in memory as a `File`/`Blob` from the photo picker, avoids CORS issues, and requires no extra round-trip.

---

## 4. Making Inference Fast

Target: the user should see AI suggestions appear in the form **within 2 seconds** of taking/selecting a photo, ideally before they've even started typing the name.

### 4.1 Downsample before sending

The photo from the camera/picker can be 4000x3000 (12MP) or larger. Sending the full image as base64 would be ~4-6MB in the request body, adding network latency and token cost (images are billed by pixel count in tiled chunks).

**Downsample to 768px on the longest edge, JPEG quality 0.6.**

Why 768px:
- Object identification (color, category, general description) doesn't benefit from more than ~800px of resolution. Going much smaller risks losing text on labels.
- A 768px image is roughly `768 * 768 / 750 ≈ 786` image tokens (Anthropic bills vision roughly by pixel area). Keeping it small minimizes both latency and cost.
- At quality 0.6, a 768px JPEG is typically 40-80KB base64-encoded — fast to encode, fast to transmit.
- At Haiku pricing, ~800 image tokens + ~200 prompt tokens + ~200 output tokens puts each call at a few tenths of a cent. At 1,000 items this is roughly a dollar or two.

This is a **separate resize** from the existing `resizeAndUpload` (1400px, quality 0.82) used for storage. The inference thumbnail is never persisted — it exists only in memory for the duration of the API call.

### 4.2 Pre-fill form fields as results arrive

Don't wait for the user to hit Save. As soon as the inference response arrives:

1. Parse the structured JSON response
2. For each field, check whether the user has **touched** it (see below). If untouched, populate with the AI suggestion.
3. If touched, leave it alone — user input always wins.

**"Touched" vs "empty":** A naive "fill if empty" check doesn't work because some fields have defaults. Category selects always have a value (the first option is auto-selected on new items), and quantity fields default to `1`. A field-by-field empty check would skip category every time. Instead, track a `touchedFields: Set<string>` that records which fields the user has interacted with (via `input`, `change`, or `focus` events). Inference fills any field not in the set — including selects that still hold their default.

For **existing items** (edit flow), all fields that already have stored values are treated as touched. Inference only fills fields that are genuinely empty/default on the existing doc (e.g. `color` and `description` on pre-feature items).

Inference fills fields **individually** — if the user typed into `name` during the 1-2s wait, `name` is skipped but `category`, `color`, `description`, and `tags` still fill normally.

This means: user taps camera → takes photo → by the time they focus the name field, the AI has already filled in name, category, color, etc. They review, tweak if needed, and save.

### 4.3 Inference lifecycle and cancellation

Each inference call is identified by a monotonically increasing request ID (simple counter). When the callback fires, it checks that its ID matches the current expected ID — if not, the result is stale and discarded silently. An `AbortController` cancels the HTTP request for fast cleanup.

**Cancel/ignore inference on:**
- **Photo replaced:** cancel in-flight, start new inference with new ID
- **Photo removed:** cancel in-flight, don't clear already-filled fields (user may have edited them)
- **Sheet closed:** cancel in-flight (the form fields no longer exist)
- **User hits Save:** cancel in-flight (fields are already committed)

This prevents stale results from writing into the wrong form — important because the photo picker callback is global (`src/photos.ts`) and a slow response could outlive the sheet that triggered it.

---

## 5. Prompt Design

### 5.1 System prompt

The JSON schema is enforced via Anthropic's structured output support (`output_config.format`), so the prompt doesn't need to describe the schema or instruct JSON-only output. The system prompt focuses on behavioral rules. The category taxonomy block should be **generated from `CATEGORIES` at runtime** (see §2.2) — the example below is illustrative.

**JSON schema** (passed via `output_config.format`, not in the prompt):

```json
{
  "name": { "type": "string" },
  "description": { "type": "string" },
  "categoryGroup": { "type": ["string", "null"], "enum": ["clothing", "toiletries", "...", null] },
  "categoryValue": { "type": ["string", "null"], "enum": ["tops", "bottoms", "...", null] },
  "color": { "type": ["string", "null"], "description": "Hex color of the item, e.g. #3B5998" },
  "tags": { "type": "array", "items": { "type": "string" } }
}
```

`categoryGroup` and `categoryValue` use **enum constraints** generated from `CATEGORIES` at runtime — the model either picks a valid value or returns `null` (for ambiguous/unrecognizable items). This eliminates invalid taxonomy values at the schema level rather than catching them client-side. `name` and `description` stay required — the model can always say *something* about what it sees.

**System prompt:**

```
You are an inventory assistant that identifies physical objects from photos.

Category taxonomy:
${generatedTaxonomy}

Rules:
- name: concise product name, specific enough to distinguish from similar items (e.g. "Navy polo shirt" not just "shirt")
- description: 1-2 sentence factual description with packing-relevant detail. Must add information beyond what's in the name — don't restate the name. Mention brand only if a logo or label is clearly visible. Mention material only if identifiable.
- categoryGroup/categoryValue: use null if the item doesn't clearly fit the taxonomy
- color: hex value of the item's dominant color (e.g. "#1B3A5C"), ignoring the background surface. For multi-color items pick the single most dominant color. Use null if not determinable.
- tags: 2-5 keywords for search — include material, use case, season if applicable
- Prefer common/simple terms ("t-shirt" not "crew-neck short-sleeve top")
```

**`notes` is not in the schema.** Notes are user-only (personal reminders). `description` covers factual item detail.

User message: the base64 image + "Identify this item for my packing inventory." Pre-fill behavior is described in §4.2.

---

## 6. Implementation Plan

### 6.1 New / changed files

| File | Change |
|---|---|
| `src/types.ts` | Add `color`, `description` to `Item`; add `'travel'` and `'food'` to `CategoryGroup` (taxonomy PR) |
| `src/constants.ts` | Add `AI_INFERENCE_MODEL = 'claude-haiku-4-5'`; expand `CATEGORIES`, `CATEGORY_ICONS`, `SUBCATEGORY_ICONS` (taxonomy PR) |
| `src/inference.ts` | **New.** `downsampleForInference(file) → base64`, `inferItemFields(base64, apiKey, signal?) → InferenceResult`, prompt building (taxonomy generated from `CATEGORIES`), response parsing |
| `src/ai.ts` | Add `description` and `color` to the trip planner's serialized item shape |
| `src/main.ts` | In `openItemForm` photo-picker callback: fire `inferItemFields`; on result, fill untouched form fields. Extend client-side search to match against `description` and `color`. Show `color` and `description` on item detail view and item list cards (truncated). |
| `src/photos.ts` | No changes — upload flow is unchanged |
| `index.html` | Add description textarea and color input to the item sheet template |
| `src/__tests__/inference.test.ts` | Unit tests for response parsing, taxonomy validation |

### 6.2 Sequence diagram

```
User taps camera → photo selected
    │
    ├──→ [1] Show preview in form (instant, blob URL)
    ├──→ [2] pendingPhoto.file = file             (existing: queued for upload on Save)
    ├──→ [3] Show "Analyzing photo..." label
    └──→ [4] downsampleForInference(file)         ~50ms
              └──→ callInferenceAPI(base64)        ~1-2s
                    └──→ parse JSON
                          └──→ fill untouched form fields, hide label

User reviews/edits fields → taps Save
    │
    ├──→ resizeAndUpload(file, path)              (existing: 1400px → Storage)
    └──→ setDoc/updateDoc with all fields         (existing + new fields)
```

Inference fires on photo selection (latency-sensitive). Upload happens on Save (existing flow, not latency-sensitive).

### 6.3 Error handling

- **No API key:** Don't attempt inference. Form works normally without AI.
- **Network failure / API error:** Log to console, hide "Analyzing..." label. Don't block the user — inference is a nice-to-have, not a gate.
- **Max-token truncation:** Structured outputs guarantee valid JSON, but the response could be truncated if it hits the token limit. Check the `stop_reason`; if `max_tokens`, discard the response.
- **Timeout:** Use a 10s `AbortController` timeout. If inference takes longer than that, the user has already started typing and the pre-fill would be disruptive anyway.

---

## 7. UX Details

### 7.1 Form layout with new fields

The item form sheet gains a second section below the existing fields:

```
[Photo preview]  [Camera] [Library] [Remove]
              [Analyzing photo...]

Name:        [___________________]     ← AI fills if empty
Description: [___________________]     ← NEW, AI fills (editable textarea)
Category:    [group ▼] [value ▼]       ← AI fills if untouched (has default, see §4.2)
Color:       [■ #1B3A5C]               ← NEW, hex from AI, shown as swatch + value

Qty owned:   [1]    Qty pack:  [1]
Container:   [▼ Unassigned]
Tags:        [___________________]     ← AI fills if empty
Notes:       [___________________]     ← user-only, AI does not touch
```

`description` is an editable `<textarea>` — AI-generated on inference, but the user can edit or clear it. `notes` remains user-only for personal reminders; the AI never writes to it. Brand and material info appears naturally in `description` when the AI can identify them.

**Trip planner integration:** Include `description` and `color` in the trip planner's serialized item shape (`src/ai.ts`) so the packing AI has richer context for item-to-activity matching.

**Loading state:** While inference is in flight (~1-2s), show an "Analyzing photo..." label below the photo preview. Fields stay empty and interactive — the user can start typing. Label disappears on completion or error.

### 7.2 Existing items

Inference only runs when the user **selects a new photo** (camera or library). Editing an existing item that already has a photo does not trigger inference — the fields are already populated. If the user wants to re-analyze, they re-take the photo, which is one tap and avoids the complexity of fetching the stored image from Firebase Storage (canvas tainting, CORS configuration, fetch-as-blob workaround).

---

## 8. Privacy

Same trust model as existing AI features: browser-direct API calls with BYO key in `localStorage`. Photos are downsampled in memory for the API call and not persisted anywhere beyond the existing Firebase Storage upload.

---

## 9. Open Questions

1. **Should inference run on container photos too?** Containers have fewer fields (name, type, color, location) but a photo of a suitcase could auto-detect type + color. Low priority — items are higher volume and more tedious to fill out.

2. **Multi-item photos?** User photographs a drawer full of items — could the AI identify multiple items and create them in batch? Compelling but complex UX (confirmation UI for N items). Defer to v2.
