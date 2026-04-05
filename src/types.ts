import type { FieldValue, Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { GeoLocation } from './weather';

// Firestore timestamps on read are Timestamp; on write we send FieldValue via serverTimestamp().
export type TimestampField = Timestamp | FieldValue | null;

export interface Category {
  group: string;
  value: string;
}

export interface Container {
  id: string;
  name: string;
  type: 'suitcase' | 'backpack' | 'box' | 'bag' | 'shelf' | 'other';
  location: string;
  parentContainerId: string | null;
  photoPath: string | null;
  color: string | null;
  notes: string;
  createdAt: TimestampField;
  updatedAt: TimestampField;
}

export interface Item {
  id: string;
  name: string;
  category: Category;
  quantityOwned: number;
  quantityPackDefault: number;
  containerId: string | null;
  photoPath: string | null;
  tags: string[];
  notes: string;
  createdAt: TimestampField;
  updatedAt: TimestampField;
}

export interface List {
  id: string;
  name: string;
  isEssential: boolean;
  createdAt: TimestampField;
  updatedAt: TimestampField;
}

export interface ListEntry {
  id: string;
  itemId: string;
  quantityOverride: number | null;
  sortOrder: number;
  addedAt: TimestampField;
}

export type DurationUnit = 'days' | 'weeks' | 'months';

export interface Trip {
  id: string;
  name: string;
  destination: string;
  location: GeoLocation | null;
  startMonth: number; // 0-11
  startYear: number;
  durationCount: number; // >= 1
  durationUnit: DurationUnit;
  activities: string[];
  notes: string;
  candidateItemIds: string[];
  yearClimate: MonthlyClimate[] | null;
  aiResult: TripAIResult | null;
  aiGeneratedAt: TimestampField | null;
  createdAt: TimestampField;
  updatedAt: TimestampField;
}

export interface Store {
  user: User | null;
  containers: Map<string, Container>;
  items: Map<string, Item>;
  lists: Map<string, List>;
  listEntries: Map<string, Map<string, ListEntry>>;
  trips: Map<string, Trip>;
  userActivities: string[] | null;
}

export interface WeatherSummary {
  place: string;
  month: string;
  avgHigh: number;
  avgLow: number;
  precipMm: number;
  rainyDays: number;
}

export interface TripWeatherData {
  place: string;
  country: string;
  monthName: string;
  avgHigh: number | null;
  avgLow: number | null;
  totalPrecip: number | null;
  rainyDays: number | null;
  cloudCoverPct: number | null;
  humidityPct: number | null;
  totalDays: number;
}

/** Climate aggregate for a single month. Used in the year-round strip. */
export interface MonthlyClimate {
  monthIdx: number;
  monthName: string;
  avgHigh: number | null;
  avgLow: number | null;
  totalPrecip: number | null;
  rainyDays: number | null;
  cloudCoverPct: number | null;
  humidityPct: number | null;
}

export interface PackingItem {
  itemId: string;
  itemName: string;
  quantity: number;
  container: string;
  reason?: string | null;
}

export interface MissingEssential {
  name: string;
  category: string;
  suggestion: string;
}

export interface TripAIResult {
  packingList: PackingItem[];
  missingEssentials: MissingEssential[];
  weatherNotes: string;
}

export type CategoryGroup =
  | 'clothing'
  | 'toiletries'
  | 'electronics'
  | 'documents'
  | 'gear'
  | 'media'
  | 'misc';

export type CategoriesMap = Record<CategoryGroup, string[]>;

export type ContainerType = Container['type'];

// Sheet save callback shape
export type SheetSaveFn = () => void | Promise<void>;

// Photo picker callback shape
export type PhotoPickerCallback = (file: File) => void;
