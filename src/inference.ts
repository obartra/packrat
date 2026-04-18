import { AI_API_URL, AI_INFERENCE_MODEL, CATEGORIES } from './constants';
import type { CategoriesMap, InferenceResult } from './types';
import { resizeToCanvas } from './images';

// ============================================================
//  Taxonomy helpers (generated from CATEGORIES at runtime)
// ============================================================

export function buildTaxonomyString(): string {
  return Object.entries(CATEGORIES)
    .map(([group, values]) => `${group}: ${values.join(', ')}`)
    .join('\n');
}

export function buildInferenceSchema(): object {
  const groups = Object.keys(CATEGORIES);
  const allValues = [...new Set(Object.values(CATEGORIES as CategoriesMap).flat())];
  return {
    type: 'object' as const,
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      categoryGroup: { type: ['string', 'null'], enum: [...groups, null] },
      categoryValue: { type: ['string', 'null'], enum: [...allValues, null] },
      color: { type: ['string', 'null'], description: 'Hex color of the item, e.g. #3B5998' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'description', 'categoryGroup', 'categoryValue', 'color', 'tags'],
    additionalProperties: false,
  };
}

// Lazily cached — CATEGORIES is const so these never change at runtime.
let _systemPrompt: string | null = null;
let _schema: object | null = null;

function buildSystemPrompt(): string {
  return `You are an inventory assistant that identifies physical objects from photos.

Category taxonomy:
${buildTaxonomyString()}

Rules:
- name: concise product name, specific enough to distinguish from similar items (e.g. "Navy polo shirt" not just "shirt")
- description: 1-2 sentence factual description with packing-relevant detail. Must add information beyond what's in the name — don't restate the name. Mention brand only if a logo or label is clearly visible. Mention material only if identifiable.
- categoryGroup/categoryValue: use null if the item doesn't clearly fit the taxonomy
- color: hex value of the item's dominant color (e.g. "#1B3A5C"), ignoring the background surface. For multi-color items pick the single most dominant color. Use null if not determinable.
- tags: 2-5 keywords for search — include material, use case, season if applicable
- Prefer common/simple terms ("t-shirt" not "crew-neck short-sleeve top")`;
}

// ============================================================
//  Image downsampling (768px, JPEG q0.6 — inference only)
// ============================================================

export async function downsampleForInference(file: File): Promise<string> {
  const canvas = await resizeToCanvas(file, 768);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('base64 encoding failed');
  return base64;
}

// ============================================================
//  Anthropic API call (structured outputs)
// ============================================================

export async function callInferenceAPI(
  base64: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<InferenceResult> {
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
      model: AI_INFERENCE_MODEL,
      max_tokens: 512,
      system: (_systemPrompt ??= buildSystemPrompt()),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
            },
            { type: 'text', text: 'Identify this item for my packing inventory.' },
          ],
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: (_schema ??= buildInferenceSchema()),
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Inference failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.stop_reason === 'max_tokens') {
    throw new Error('Inference response truncated');
  }

  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Inference returned empty response');
  return JSON.parse(text) as InferenceResult;
}

// ============================================================
//  Convenience wrapper: downsample → infer
// ============================================================

export async function inferFromPhoto(
  file: File,
  apiKey: string,
  signal?: AbortSignal,
): Promise<InferenceResult> {
  const base64 = await downsampleForInference(file);
  return callInferenceAPI(base64, apiKey, signal);
}
