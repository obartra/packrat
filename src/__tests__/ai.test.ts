import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildUserMessage,
  inventoryFromItems,
  parseAIResponse,
  callAI,
  SYSTEM_PROMPT,
  SMART_GROUP_SYSTEM_PROMPT,
  buildSmartGroupMessage,
  parseSmartGroupResponse,
  type TripPromptInput,
} from '../ai';
import type { Item } from '../types';

const sampleInput: TripPromptInput = {
  destination: 'Cozumel',
  country: 'Mexico',
  duration: '2 weeks',
  monthName: 'May',
  weatherSummary: 'Avg high 32°C, avg low 25°C, ~14mm rain, 5 rainy days in May',
  activities: 'Diving, Beach',
  extraNotes: 'wedding day 3',
  inventory: [
    {
      id: 'i1',
      name: 'Merino tee',
      category: 'clothing/tops',
      quantityOwned: 3,
      quantityPackDefault: 2,
      container: 'Carry-on',
    },
  ],
};

describe('SYSTEM_PROMPT', () => {
  it('requires JSON-only output with the expected schema', () => {
    expect(SYSTEM_PROMPT).toContain('Respond ONLY with a single valid JSON');
    expect(SYSTEM_PROMPT).toContain('packingList');
    expect(SYSTEM_PROMPT).toContain('missingEssentials');
    expect(SYSTEM_PROMPT).toContain('weatherNotes');
    expect(SYSTEM_PROMPT).toContain('itemId must exactly match');
  });
});

describe('buildUserMessage', () => {
  it('includes destination, country, month, duration, climate, activities', () => {
    const msg = buildUserMessage(sampleInput);
    expect(msg).toContain('Cozumel, Mexico');
    expect(msg).toContain('2 weeks');
    expect(msg).toContain('May');
    expect(msg).toContain('Avg high 32°C');
    expect(msg).toContain('Diving, Beach');
  });

  it('serializes inventory as JSON', () => {
    const msg = buildUserMessage(sampleInput);
    expect(msg).toContain('"id":"i1"');
    expect(msg).toContain('"name":"Merino tee"');
    expect(msg).toContain('"category":"clothing/tops"');
  });

  it('uses "None" placeholder when extra notes are empty', () => {
    const msg = buildUserMessage({ ...sampleInput, extraNotes: '' });
    expect(msg).toContain('Notes: None');
  });

  it('keeps extra notes verbatim when provided', () => {
    const msg = buildUserMessage({ ...sampleInput, extraNotes: 'wedding day 3' });
    expect(msg).toContain('Notes: wedding day 3');
  });

  it('reports inventory count', () => {
    const msg = buildUserMessage(sampleInput);
    expect(msg).toContain('Inventory (1 candidate items)');
  });
});

describe('inventoryFromItems', () => {
  const items: Item[] = [
    {
      id: 'a',
      name: 'Item A',
      category: { group: 'clothing', value: 'tops' },
      quantityOwned: 3,
      quantityPackDefault: 2,
      containerId: 'c1',
      photoPath: null,
      tags: [],
      notes: '',
      createdAt: null,
      updatedAt: null,
    },
    {
      id: 'b',
      name: 'Item B',
      category: { group: 'misc', value: 'other' },
      quantityOwned: 0,
      quantityPackDefault: 0,
      containerId: null,
      photoPath: null,
      tags: [],
      notes: '',
      createdAt: null,
      updatedAt: null,
    },
  ];

  it('maps items to prompt inventory shape', () => {
    const inv = inventoryFromItems(
      items,
      cid => (cid === 'c1' ? 'Carry-on' : 'Unassigned'),
      cat => `${cat.group}/${cat.value}`,
    );
    expect(inv).toEqual([
      {
        id: 'a',
        name: 'Item A',
        category: 'clothing/tops',
        quantityOwned: 3,
        quantityPackDefault: 2,
        container: 'Carry-on',
      },
      {
        id: 'b',
        name: 'Item B',
        category: 'misc/other',
        quantityOwned: 1,
        quantityPackDefault: 1,
        container: 'Unassigned',
      },
    ]);
  });

  it('defaults zero quantities to 1 (avoids misleading the model)', () => {
    const inv = inventoryFromItems(
      items,
      () => 'X',
      () => 'cat',
    );
    expect(inv[1]!.quantityOwned).toBe(1);
    expect(inv[1]!.quantityPackDefault).toBe(1);
  });

  it('includes description when present on item', () => {
    const withDesc: Item[] = [{ ...items[0]!, description: 'Cotton blend, lightweight' }];
    const inv = inventoryFromItems(
      withDesc,
      () => 'C1',
      cat => `${cat.group}/${cat.value}`,
    );
    expect(inv[0]!.description).toBe('Cotton blend, lightweight');
  });

  it('omits description when null or undefined', () => {
    const inv = inventoryFromItems(
      items,
      () => 'C1',
      cat => `${cat.group}/${cat.value}`,
    );
    expect('description' in inv[0]!).toBe(false);
    expect('description' in inv[1]!).toBe(false);
  });

  it('includes color when present on item', () => {
    const withColor: Item[] = [{ ...items[0]!, color: '#3B5998' }];
    const inv = inventoryFromItems(
      withColor,
      () => 'C1',
      cat => `${cat.group}/${cat.value}`,
    );
    expect(inv[0]!.color).toBe('#3B5998');
  });

  it('omits color when null or undefined', () => {
    const inv = inventoryFromItems(
      items,
      () => 'C1',
      cat => `${cat.group}/${cat.value}`,
    );
    expect('color' in inv[0]!).toBe(false);
    expect('color' in inv[1]!).toBe(false);
  });
});

describe('parseAIResponse', () => {
  const known = new Set(['i1', 'i2']);

  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      packingList: [{ itemId: 'i1', itemName: 'Tee', quantity: 2, container: 'Bag', reason: null }],
      missingEssentials: [],
      weatherNotes: 'warm',
    });
    const r = parseAIResponse(raw, known);
    expect(r.packingList).toHaveLength(1);
    expect(r.weatherNotes).toBe('warm');
  });

  it('strips markdown code fences the model sometimes adds', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        packingList: [],
        missingEssentials: [],
        weatherNotes: '',
      }) +
      '\n```';
    expect(() => parseAIResponse(raw, known)).not.toThrow();
  });

  it('filters out packingList items whose itemId is not in the store', () => {
    const raw = JSON.stringify({
      packingList: [
        { itemId: 'i1', itemName: 'Tee', quantity: 2, container: 'Bag' },
        { itemId: 'ghost', itemName: 'Unknown', quantity: 1, container: 'Bag' },
        { itemId: 'i2', itemName: 'Pants', quantity: 1, container: 'Bag' },
      ],
      missingEssentials: [],
      weatherNotes: '',
    });
    const r = parseAIResponse(raw, known);
    expect(r.packingList.map(p => p.itemId)).toEqual(['i1', 'i2']);
  });

  it('defaults missingEssentials and weatherNotes when absent', () => {
    const raw = JSON.stringify({ packingList: [] });
    const r = parseAIResponse(raw, known);
    expect(r.missingEssentials).toEqual([]);
    expect(r.weatherNotes).toBe('');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAIResponse('not json at all', known)).toThrow();
  });

  it('defaults packingList to [] when missing entirely', () => {
    const raw = JSON.stringify({ missingEssentials: [], weatherNotes: 'n/a' });
    const r = parseAIResponse(raw, known);
    expect(r.packingList).toEqual([]);
  });

  it('strips plain code fences without the `json` language marker', () => {
    const raw =
      '```\n' +
      JSON.stringify({ packingList: [], missingEssentials: [], weatherNotes: '' }) +
      '\n```';
    expect(() => parseAIResponse(raw, known)).not.toThrow();
  });

  it('tolerates surrounding whitespace around fences', () => {
    const raw =
      '\n\n  ```json\n' +
      JSON.stringify({ packingList: [], missingEssentials: [], weatherNotes: 'x' }) +
      '\n```  \n';
    const r = parseAIResponse(raw, known);
    expect(r.weatherNotes).toBe('x');
  });

  it('keeps only valid packingList entries when mixed with unknown itemIds', () => {
    const raw = JSON.stringify({
      packingList: [
        { itemId: 'i1', itemName: 'A', quantity: 1, container: 'X' },
        { itemId: 'nope', itemName: 'B', quantity: 1, container: 'X' },
      ],
    });
    const r = parseAIResponse(raw, known);
    expect(r.packingList).toHaveLength(1);
    expect(r.packingList[0]!.itemId).toBe('i1');
  });

  it('preserves reason field when the model provides one', () => {
    const raw = JSON.stringify({
      packingList: [
        { itemId: 'i1', itemName: 'A', quantity: 1, container: 'X', reason: 'because warm' },
      ],
    });
    const r = parseAIResponse(raw, known);
    expect(r.packingList[0]!.reason).toBe('because warm');
  });
});

describe('callAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okResponse(text: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text }] }),
      text: async () => '',
    };
  }

  it('posts to Anthropic messages endpoint with the expected headers', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{"packingList":[]}'));
    await callAI('user msg', 'sys', 'sk-ant-test');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('includes system prompt and user message in the request body', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{}'));
    await callAI('hello trip', 'be terse', 'sk-ant-x');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello trip' }]);
    expect(body.model).toBeTypeOf('string');
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('returns the text from the first content block', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('the answer'));
    const out = await callAI('u', 's', 'k');
    expect(out).toBe('the answer');
  });

  it('throws with status code and snippet when response is not ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'invalid api key',
    });
    await expect(callAI('u', 's', 'bad')).rejects.toThrow(/401/);
    await expect(callAI('u', 's', 'bad')).rejects.toThrow(/invalid api key/);
  });

  it('throws when response body has no text field', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: [] }),
      text: async () => '',
    });
    await expect(callAI('u', 's', 'k')).rejects.toThrow(/empty response/i);
  });

  it('throws when content[0].text is not a string', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 42 }] }),
      text: async () => '',
    });
    await expect(callAI('u', 's', 'k')).rejects.toThrow();
  });

  it('uses custom model when provided', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('ok'));
    await callAI('u', 's', 'k', undefined, 'claude-haiku-4-5');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe('claude-haiku-4-5');
  });
});

describe('SMART_GROUP_SYSTEM_PROMPT', () => {
  it('requires JSON-only output with groups schema', () => {
    expect(SMART_GROUP_SYSTEM_PROMPT).toContain('Respond ONLY with a single valid JSON');
    expect(SMART_GROUP_SYSTEM_PROMPT).toContain('"groups"');
    expect(SMART_GROUP_SYSTEM_PROMPT).toContain('"itemIds"');
  });
});

describe('buildSmartGroupMessage', () => {
  it('lists items with name, category, and id', () => {
    const msg = buildSmartGroupMessage([
      { id: 'a1', name: 'Wool Scarf', category: 'clothing/accessories' },
      { id: 'b2', name: 'Sunscreen', category: 'toiletries/sunscreen' },
    ]);
    expect(msg).toContain('"Wool Scarf"');
    expect(msg).toContain('clothing/accessories');
    expect(msg).toContain('[id:a1]');
    expect(msg).toContain('2 items');
  });
});

describe('parseSmartGroupResponse', () => {
  const known = new Set(['i1', 'i2', 'i3']);

  it('parses a valid response and filters to known IDs', () => {
    const raw = JSON.stringify({
      groups: [
        { name: 'Clothing', itemIds: ['i1', 'i2'] },
        { name: 'Gear', itemIds: ['i3', 'unknown'] },
      ],
    });
    const r = parseSmartGroupResponse(raw, known);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]!.itemIds).toEqual(['i1', 'i2']);
    expect(r.groups[1]!.itemIds).toEqual(['i3']);
  });

  it('drops empty groups after filtering', () => {
    const raw = JSON.stringify({
      groups: [
        { name: 'Valid', itemIds: ['i1'] },
        { name: 'Empty', itemIds: ['ghost'] },
      ],
    });
    const r = parseSmartGroupResponse(raw, known);
    // Empty group is dropped; i2/i3 end up in "Other"
    expect(r.groups.find(g => g.name === 'Empty')).toBeUndefined();
    expect(r.groups[0]!.name).toBe('Valid');
  });

  it('adds missing items to an Other group', () => {
    const raw = JSON.stringify({
      groups: [{ name: 'Clothing', itemIds: ['i1'] }],
    });
    const r = parseSmartGroupResponse(raw, known);
    expect(r.groups).toHaveLength(2);
    const other = r.groups.find(g => g.name === 'Other');
    expect(other).toBeDefined();
    expect(other!.itemIds).toContain('i2');
    expect(other!.itemIds).toContain('i3');
  });

  it('appends missing items to existing Other group', () => {
    const raw = JSON.stringify({
      groups: [
        { name: 'Clothing', itemIds: ['i1'] },
        { name: 'Other', itemIds: ['i2'] },
      ],
    });
    const r = parseSmartGroupResponse(raw, known);
    const other = r.groups.find(g => g.name === 'Other');
    expect(other!.itemIds).toContain('i2');
    expect(other!.itemIds).toContain('i3');
  });

  it('strips markdown code fences', () => {
    const raw =
      '```json\n' +
      JSON.stringify({ groups: [{ name: 'All', itemIds: ['i1', 'i2', 'i3'] }] }) +
      '\n```';
    expect(() => parseSmartGroupResponse(raw, known)).not.toThrow();
    const r = parseSmartGroupResponse(raw, known);
    expect(r.groups[0]!.itemIds).toHaveLength(3);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSmartGroupResponse('not json', known)).toThrow();
  });
});
