import type { CategoriesMap } from './types';

export const AI_MODEL = 'claude-sonnet-4-6';
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
  ],
  electronics: ['phone-tablet', 'cables', 'adapters', 'audio', 'camera', 'computer', 'accessories'],
  documents: ['passport', 'cards', 'insurance', 'cash'],
  gear: ['diving', 'outdoor', 'workout'],
  media: ['books', 'notebooks', 'art-supplies'],
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
  misc: '📦',
};
