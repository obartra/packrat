import type { CategoriesMap } from './types';

export const AI_MODEL = 'claude-sonnet-4-6';
export const AI_INFERENCE_MODEL = 'claude-haiku-4-5';
export const AI_API_URL = 'https://api.anthropic.com/v1/messages';

export const CATEGORIES: CategoriesMap = {
  clothing: [
    'tops',
    'bottoms',
    'underwear',
    'socks',
    'outerwear',
    'swimwear',
    'activewear',
    'shoes',
    'accessories',
  ],
  toiletries: [
    'skincare',
    'shaving',
    'oral-care',
    'medication',
    'supplements',
    'sunscreen',
    'hygiene',
    'fragrance',
    'first-aid',
  ],
  electronics: ['phone-tablet', 'cables', 'adapters', 'audio', 'camera', 'computer', 'accessories'],
  documents: [
    'passport',
    'identification',
    'certificates',
    'cards',
    'insurance',
    'medical',
    'financial',
    'legal',
    'visas',
    'cash',
  ],
  gear: ['diving', 'outdoor', 'workout'],
  media: ['books', 'notebooks', 'art-supplies'],
  travel: ['comfort', 'organization', 'security', 'other'],
  food: ['snacks', 'beverages', 'baby-food', 'other'],
  misc: ['other'],
};

export const CONTAINER_TYPES = ['suitcase', 'backpack', 'box', 'bag', 'shelf', 'other'] as const;

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const ACTIVITIES = [
  'Diving',
  'Beach',
  'City',
  'Hiking',
  'Formal',
  'Business',
  'Cold weather',
  'Festival',
];

export const CONTAINER_ICONS: Record<string, string> = {
  suitcase: '🧳',
  backpack: '🎒',
  box: '📦',
  bag: '👜',
  shelf: '🗄️',
  other: '📫',
};

export const CATEGORY_ICONS: Record<string, string> = {
  clothing: '👕',
  toiletries: '🧴',
  electronics: '📱',
  documents: '📄',
  gear: '🤿',
  media: '📚',
  travel: '🧳',
  food: '🍎',
  misc: '📦',
};

/** Subtype icons, keyed by `"group/value"`. Falls back to group icon if absent. */
export const SUBCATEGORY_ICONS: Record<string, string> = {
  // clothing
  'clothing/tops': '👕',
  'clothing/bottoms': '👖',
  'clothing/underwear': '🩲',
  'clothing/socks': '🧦',
  'clothing/outerwear': '🧥',
  'clothing/swimwear': '🩱',
  'clothing/activewear': '🏃',
  'clothing/shoes': '👟',
  'clothing/accessories': '👓',
  // toiletries
  'toiletries/skincare': '🧴',
  'toiletries/shaving': '🪒',
  'toiletries/oral-care': '🪥',
  'toiletries/medication': '💊',
  'toiletries/supplements': '💊',
  'toiletries/sunscreen': '☀️',
  'toiletries/hygiene': '🧼',
  // electronics
  'electronics/phone-tablet': '📱',
  'electronics/cables': '🔌',
  'electronics/adapters': '🔌',
  'electronics/audio': '🎧',
  'electronics/camera': '📷',
  'electronics/computer': '💻',
  'electronics/accessories': '🔋',
  // documents
  'documents/passport': '🛂',
  'documents/identification': '🪪',
  'documents/certificates': '📜',
  'documents/cards': '💳',
  'documents/insurance': '📄',
  'documents/medical': '🏥',
  'documents/financial': '🏦',
  'documents/legal': '⚖️',
  'documents/visas': '📋',
  'documents/cash': '💵',
  // gear
  'gear/diving': '🤿',
  'gear/outdoor': '🏕️',
  'gear/workout': '🏋️',
  // media
  'media/books': '📚',
  'media/notebooks': '📓',
  'media/art-supplies': '🎨',
  // toiletries (new subtypes)
  'toiletries/fragrance': '🧴',
  'toiletries/first-aid': '🩹',
  // travel
  'travel/comfort': '😴',
  'travel/organization': '🧳',
  'travel/security': '🔒',
  // food
  'food/snacks': '🍪',
  'food/beverages': '🥤',
  'food/baby-food': '🍼',
  // misc → falls back to group icon
};

/** Best icon for an item, preferring the subtype over the group. */
export function iconForCategory(
  group: string | null | undefined,
  value: string | null | undefined,
): string {
  if (group && value) {
    const key = `${group}/${value}`;
    const subtype = SUBCATEGORY_ICONS[key];
    if (subtype) return subtype;
  }
  return CATEGORY_ICONS[group ?? 'misc'] ?? '•';
}
