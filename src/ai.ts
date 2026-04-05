import type { Item, TripAIResult, PackingItem } from './types';
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
      model: AI_MODEL,
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
