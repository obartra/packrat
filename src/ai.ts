import type { Item, TripAIResult, PackingItem, SmartGroupResult } from './types';
import { AI_MODEL, AI_API_URL } from './constants';

export interface TripPromptInput {
  destination: string;
  country: string;
  duration: string;
  monthName: string;
  weatherSummary: string;
  activities: string;
  extraNotes: string;
  inventory: InventoryItem[];
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  description?: string;
  color?: string;
  quantityOwned: number;
  quantityPackDefault: number;
  container: string;
}

export const SYSTEM_PROMPT = `You are a packing assistant. Respond ONLY with a single valid JSON object. No markdown, no prose, no text outside the JSON.

Schema:
{
  "packingList": [{"itemId":"string","itemName":"string","quantity":number,"container":"string","reason":"string or null"}],
  "missingEssentials": [{"name":"string","category":"string","suggestion":"string"}],
  "weatherNotes": "string"
}

Rules:
- itemId must exactly match an id from the provided inventory
- reason: one short sentence only if genuinely non-obvious, otherwise null
- missingEssentials: items NOT in the inventory that this trip clearly warrants (max 5)
- weatherNotes: 1-2 sentences about weather-appropriate clothing/gear`;

export function buildUserMessage(input: TripPromptInput): string {
  return `Destination: ${input.destination}, ${input.country}
Duration: ${input.duration}
Month: ${input.monthName}
Climate: ${input.weatherSummary}
Activities: ${input.activities}
Notes: ${input.extraNotes || 'None'}

Inventory (${input.inventory.length} candidate items):
${JSON.stringify(input.inventory)}

Provide a complete packing recommendation.`;
}

export function inventoryFromItems(
  items: Item[],
  containerNameById: (id: string | null) => string,
  formatCategory: (cat: Item['category']) => string,
): InventoryItem[] {
  return items.map(it => ({
    id: it.id,
    name: it.name,
    category: formatCategory(it.category),
    ...(it.description ? { description: it.description } : {}),
    ...(it.color ? { color: it.color } : {}),
    quantityOwned: it.quantityOwned || 1,
    quantityPackDefault: it.quantityPackDefault || 1,
    container: containerNameById(it.containerId),
  }));
}

/**
 * Parse the raw AI response and filter packingList down to itemIds that
 * actually exist in the caller's store. Throws on JSON parse failure.
 */
export function parseAIResponse(raw: string, knownItemIds: Set<string>): TripAIResult {
  // Strip markdown code fences (with or without the `json` language marker)
  // and surrounding whitespace.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  const parsed = JSON.parse(cleaned) as TripAIResult;
  parsed.packingList = (parsed.packingList || []).filter((r: PackingItem) =>
    knownItemIds.has(r.itemId),
  );
  parsed.missingEssentials = parsed.missingEssentials || [];
  parsed.weatherNotes = parsed.weatherNotes || '';
  return parsed;
}

// ============================================================
//  SMART GROUPING
// ============================================================

export const SMART_GROUP_SYSTEM_PROMPT = `You are an inventory organizer. Given a list of items with their categories, create logical display groups for a packing/inventory view.

Respond ONLY with a single valid JSON object. No markdown, no prose.

Schema:
{
  "groups": [{"name":"string","itemIds":["string"]}]
}

Rules:
- Create 3-12 groups depending on item count and variety
- Group names should be concise (1-3 words), title case
- Every itemId from the input must appear in exactly one group
- Group related items together even across different categories (e.g. a scarf and sunglasses are both "Accessories")
- Order groups from most essential to least essential for travel
- Within each group, preserve the order items were provided`;

export function buildSmartGroupMessage(
  items: { id: string; name: string; category: string }[],
): string {
  const lines = items.map(it => `- "${it.name}" (${it.category}) [id:${it.id}]`);
  return `Organize these ${items.length} items into display groups:\n\n${lines.join('\n')}`;
}

export function parseSmartGroupResponse(raw: string, knownItemIds: Set<string>): SmartGroupResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  const parsed = JSON.parse(cleaned) as SmartGroupResult;
  // Filter to only known item IDs and drop empty groups
  parsed.groups = (parsed.groups || [])
    .map(g => ({
      name: g.name,
      itemIds: g.itemIds.filter(id => knownItemIds.has(id)),
    }))
    .filter(g => g.itemIds.length > 0);
  // Any items the AI missed get added to the last group (or a new "Other" group)
  const assigned = new Set(parsed.groups.flatMap(g => g.itemIds));
  const missing = [...knownItemIds].filter(id => !assigned.has(id));
  if (missing.length) {
    const last = parsed.groups.find(g => g.name.toLowerCase() === 'other');
    if (last) {
      last.itemIds.push(...missing);
    } else {
      parsed.groups.push({ name: 'Other', itemIds: missing });
    }
  }
  return parsed;
}

/**
 * Browser-direct call to the Anthropic API.
 *
 * SECURITY NOTE: `anthropic-dangerous-direct-browser-access: true` is required
 * for browser requests, but it means the user's API key sits in memory on the
 * client. Any XSS vulnerability in this app could exfiltrate the key. The
 * BYO-key-in-localStorage model is acceptable for a personal tool; in a
 * multi-user product this would route through a server-side proxy instead.
 */
export async function callAI(
  userMsg: string,
  systemPrompt: string,
  apiKey: string,
  signal?: AbortSignal,
  model?: string,
): Promise<string> {
  const res = await fetch(AI_API_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('AI returned empty response');
  return text;
}
