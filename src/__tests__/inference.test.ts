import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildTaxonomyString, buildInferenceSchema, callInferenceAPI } from '../inference';
import { CATEGORIES, AI_INFERENCE_MODEL } from '../constants';
import type { CategoriesMap } from '../types';

describe('buildTaxonomyString', () => {
  it('includes all category groups', () => {
    const taxonomy = buildTaxonomyString();
    Object.keys(CATEGORIES).forEach(group => {
      expect(taxonomy).toContain(group);
    });
  });

  it('includes subtypes for each group', () => {
    const taxonomy = buildTaxonomyString();
    Object.entries(CATEGORIES).forEach(([, values]) => {
      values.forEach(v => {
        expect(taxonomy).toContain(v);
      });
    });
  });

  it('formats as "group: value1, value2" lines', () => {
    const taxonomy = buildTaxonomyString();
    const lines = taxonomy.split('\n');
    expect(lines.length).toBe(Object.keys(CATEGORIES).length);
    lines.forEach(line => {
      expect(line).toMatch(/^\w+: .+/);
    });
  });
});

describe('buildInferenceSchema', () => {
  it('has the required properties', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, unknown>;
    expect(props['name']).toBeDefined();
    expect(props['description']).toBeDefined();
    expect(props['categoryGroup']).toBeDefined();
    expect(props['categoryValue']).toBeDefined();
    expect(props['color']).toBeDefined();
    expect(props['tags']).toBeDefined();
  });

  it('categoryGroup enum includes all groups plus null', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const groupEnum = props['categoryGroup']!['enum'] as unknown[];
    Object.keys(CATEGORIES).forEach(group => {
      expect(groupEnum).toContain(group);
    });
    expect(groupEnum).toContain(null);
  });

  it('categoryValue enum includes all unique values plus null', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const valueEnum = props['categoryValue']!['enum'] as unknown[];
    const allValues = new Set(Object.values(CATEGORIES).flat());
    allValues.forEach(v => {
      expect(valueEnum).toContain(v);
    });
    expect(valueEnum).toContain(null);
  });

  it('disallows additional properties', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    expect(schema['additionalProperties']).toBe(false);
  });

  it('categoryValue enum contains no duplicates', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const valueEnum = props['categoryValue']!['enum'] as unknown[];
    // Filter out null for uniqueness check on string values
    const strings = valueEnum.filter((v): v is string => typeof v === 'string');
    expect(new Set(strings).size).toBe(strings.length);
  });

  it('categoryGroup enum contains no duplicates', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const groupEnum = props['categoryGroup']!['enum'] as unknown[];
    const strings = groupEnum.filter((v): v is string => typeof v === 'string');
    expect(new Set(strings).size).toBe(strings.length);
  });

  it('all required fields are listed', () => {
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const required = schema['required'] as string[];
    expect(required).toContain('name');
    expect(required).toContain('description');
    expect(required).toContain('categoryGroup');
    expect(required).toContain('categoryValue');
    expect(required).toContain('color');
    expect(required).toContain('tags');
  });
});

describe('taxonomy ↔ schema consistency', () => {
  it('every group in taxonomy string appears in schema categoryGroup enum', () => {
    const taxonomy = buildTaxonomyString();
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const groupEnum = props['categoryGroup']!['enum'] as unknown[];

    taxonomy.split('\n').forEach(line => {
      const group = line.split(':')[0]!.trim();
      expect(groupEnum).toContain(group);
    });
  });

  it('every value in taxonomy string appears in schema categoryValue enum', () => {
    const taxonomy = buildTaxonomyString();
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const valueEnum = props['categoryValue']!['enum'] as unknown[];

    taxonomy.split('\n').forEach(line => {
      const valPart = line.split(': ')[1];
      if (!valPart) return;
      valPart.split(', ').forEach(v => {
        expect(valueEnum).toContain(v.trim());
      });
    });
  });

  it('documents which values appear in multiple groups (cross-group ambiguity)', () => {
    // Some values like "accessories" and "other" appear in multiple groups.
    // The AI must use categoryGroup to disambiguate. This test documents the overlap
    // so we stay aware of it — it's not a bug, but the prompt must handle it.
    const valueCounts = new Map<string, string[]>();
    Object.entries(CATEGORIES).forEach(([group, values]) => {
      values.forEach(v => {
        if (!valueCounts.has(v)) valueCounts.set(v, []);
        valueCounts.get(v)!.push(group);
      });
    });
    const shared = [...valueCounts.entries()].filter(([, groups]) => groups.length > 1);
    // At minimum "accessories" (clothing, electronics) and "other" (travel, food, misc)
    expect(shared.length).toBeGreaterThan(0);
    // Each shared value must still be in the enum exactly once
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const valueEnum = props['categoryValue']!['enum'] as unknown[];
    shared.forEach(([val]) => {
      expect(valueEnum.filter(v => v === val)).toHaveLength(1);
    });
  });

  it('schema and taxonomy are both derived from the same CATEGORIES constant', () => {
    const taxonomy = buildTaxonomyString();
    const schema = buildInferenceSchema() as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const groupEnum = (props['categoryGroup']!['enum'] as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    const valueEnum = (props['categoryValue']!['enum'] as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );

    // Both should have exactly the groups from CATEGORIES
    const catGroups = Object.keys(CATEGORIES);
    expect(groupEnum.sort()).toEqual(catGroups.sort());

    // Both should have exactly the values from CATEGORIES (deduplicated)
    const catValues = [...new Set(Object.values(CATEGORIES as CategoriesMap).flat())];
    expect(valueEnum.sort()).toEqual(catValues.sort());

    // Taxonomy should mention every group
    catGroups.forEach(g => expect(taxonomy).toContain(g));
  });
});

describe('callInferenceAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validResult = {
    name: 'Navy polo shirt',
    description: 'Lightweight cotton polo with button collar.',
    categoryGroup: 'clothing',
    categoryValue: 'tops',
    color: '#1B3A5C',
    tags: ['cotton', 'casual', 'summer'],
  };

  function okResponse(result: object) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(result) }],
        stop_reason: 'end_turn',
      }),
      text: async () => '',
    };
  }

  it('posts to Anthropic with the correct model and image content', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    await callInferenceAPI('base64data', 'sk-ant-test');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(AI_INFERENCE_MODEL);
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[0].source.data).toBe('base64data');
    expect(body.messages[0].content[1].type).toBe('text');
  });

  it('includes output_config with json_schema format', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    await callInferenceAPI('base64data', 'sk-ant-test');

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.name).toBe('item_identification');
    expect(body.output_config.format.schema).toBeDefined();
  });

  it('includes required headers for browser-direct access', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    await callInferenceAPI('base64data', 'sk-ant-test');

    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('parses a valid structured response', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    const result = await callInferenceAPI('base64data', 'sk-ant-test');

    expect(result.name).toBe('Navy polo shirt');
    expect(result.color).toBe('#1B3A5C');
    expect(result.categoryGroup).toBe('clothing');
    expect(result.tags).toEqual(['cotton', 'casual', 'summer']);
  });

  it('throws on truncated response (max_tokens)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"name":"tr' }],
        stop_reason: 'max_tokens',
      }),
      text: async () => '',
    });

    await expect(callInferenceAPI('base64data', 'sk-ant-test')).rejects.toThrow(/truncated/i);
  });

  it('throws on non-ok HTTP status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'invalid api key',
    });

    await expect(callInferenceAPI('base64data', 'bad')).rejects.toThrow(/401/);
  });

  it('throws on empty response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: [], stop_reason: 'end_turn' }),
      text: async () => '',
    });

    await expect(callInferenceAPI('base64data', 'sk-ant-test')).rejects.toThrow(/empty response/i);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(callInferenceAPI('base64data', 'sk-ant-test', controller.signal)).rejects.toThrow(
      /abort/i,
    );
  });

  it('accepts null categoryGroup and categoryValue', async () => {
    const result = { ...validResult, categoryGroup: null, categoryValue: null };
    fetchMock.mockResolvedValueOnce(okResponse(result));
    const parsed = await callInferenceAPI('base64data', 'sk-ant-test');
    expect(parsed.categoryGroup).toBeNull();
    expect(parsed.categoryValue).toBeNull();
  });

  it('accepts null color', async () => {
    const result = { ...validResult, color: null };
    fetchMock.mockResolvedValueOnce(okResponse(result));
    const parsed = await callInferenceAPI('base64data', 'sk-ant-test');
    expect(parsed.color).toBeNull();
  });

  it('accepts empty tags array', async () => {
    const result = { ...validResult, tags: [] };
    fetchMock.mockResolvedValueOnce(okResponse(result));
    const parsed = await callInferenceAPI('base64data', 'sk-ant-test');
    expect(parsed.tags).toEqual([]);
  });

  it('throws on malformed JSON in response text', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"name":"test"' }],
        stop_reason: 'end_turn',
      }),
      text: async () => '',
    });
    await expect(callInferenceAPI('base64data', 'sk-ant-test')).rejects.toThrow();
  });

  it('uses max_tokens of 512', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    await callInferenceAPI('base64data', 'sk-ant-test');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.max_tokens).toBe(512);
  });

  it('sends system prompt containing category taxonomy', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validResult));
    await callInferenceAPI('base64data', 'sk-ant-test');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.system).toContain('Category taxonomy:');
    expect(body.system).toContain('clothing');
    expect(body.system).toContain('travel');
    expect(body.system).toContain('food');
  });
});
