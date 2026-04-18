#!/usr/bin/env node
/**
 * Seed a demo account with sample containers, items, and a packing list
 * using the images in public/demo/.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   DEMO_UID=<firebase-uid> \
 *     node scripts/seed-demo.mjs [--dry-run]
 *
 * If DEMO_UID is not set, it lists all users and exits.
 *
 * Requires: firebase-admin, sharp
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

const __dir = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(__dir, 'demo-assets');

// Load .env.local
const envPath = resolve(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const dryRun = process.argv.includes('--dry-run');
const bucket =
  process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID;

if (!bucket) {
  console.error('Set FIREBASE_STORAGE_BUCKET or VITE_FIREBASE_STORAGE_BUCKET');
  process.exit(1);
}

const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : applicationDefault();

initializeApp({ credential, storageBucket: bucket, projectId });

const db = getFirestore();
const storage = getStorage().bucket();

const demoUid = process.env.DEMO_UID;
if (!demoUid) {
  const users = await db.collection('users').listDocuments();
  console.log('Available users:');
  for (const u of users) {
    const data = (await u.get()).data();
    console.log(`  ${u.id}  ${data?.email || '(no email)'}`);
  }
  console.log('\nSet DEMO_UID=<uid> to seed that account.');
  process.exit(0);
}

const userPath = `users/${demoUid}`;

// ---------- helpers ----------

async function uploadPhoto(localPath, storagePath) {
  const buf = readFileSync(localPath);
  // Convert PNG to JPEG for storage (matches app behavior)
  const jpegBuf = await sharp(buf).jpeg({ quality: 82 }).toBuffer();
  const file = storage.file(storagePath);
  await file.save(jpegBuf, { contentType: 'image/jpeg' });
  return jpegBuf;
}

async function makeThumb(buffer, size = 100) {
  const thumbBuf = await sharp(buffer)
    .resize(size, size, { fit: 'inside' })
    .jpeg({ quality: 40 })
    .toBuffer();
  return `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
}

async function makeContainerThumb(buffer) {
  return makeThumb(buffer, 400);
}

async function makeNobgThumb(localPath) {
  const buf = readFileSync(localPath);
  // These demo images already have near-white backgrounds — use the PNG directly
  const thumbBuf = await sharp(buf)
    .resize(100, 100, { fit: 'inside' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${thumbBuf.toString('base64')}`;
}

async function uploadNobgPng(localPath, storagePath) {
  const buf = readFileSync(localPath);
  const file = storage.file(storagePath);
  await file.save(buf, { contentType: 'image/png' });
}

// ---------- data definitions ----------

const containers = [
  {
    file: 'suitcase1.webp',
    data: {
      name: 'Beach Suitcase',
      type: 'suitcase',
      location: 'Closet',
      parentContainerId: null,
      color: 'yellow',
      notes: 'Yellow vintage-style suitcase for warm-weather trips',
    },
  },
  {
    file: 'suitcase2.webp',
    data: {
      name: 'Leather Suitcase',
      type: 'suitcase',
      location: 'Closet',
      parentContainerId: null,
      color: 'brown',
      notes: 'Brown leather suitcase for business travel',
    },
  },
];

// Items: [file, name, category, color, tags, notes, containerIndex (0 or 1)]
const items = [
  {
    file: 'boots.webp',
    data: {
      name: 'Talavera Boots',
      category: { group: 'clothing', value: 'shoes' },
      color: 'green',
      tags: ['statement', 'handmade'],
      notes: 'Hand-painted ceramic-style cowboy boots',
      description: 'Colorful Talavera-patterned cowboy boots with floral motifs',
    },
    container: 1,
  },
  {
    file: 'hat.webp',
    data: {
      name: 'Winter Beanie',
      category: { group: 'clothing', value: 'accessories' },
      color: 'blue',
      tags: ['winter', 'knit'],
      notes: 'Knit beanie with snow scene and pom-pom',
      description: 'Blue knitted winter hat with snowflake and pine tree design',
    },
    container: 1,
  },
  {
    file: 'necktie.webp',
    data: {
      name: 'Striped Tie',
      category: { group: 'clothing', value: 'accessories' },
      color: 'blue',
      tags: ['formal', 'office'],
      notes: 'Blue and yellow diagonal stripe necktie',
      description: 'Polka dot and striped necktie in blue and yellow',
    },
    container: 1,
  },
  {
    file: 'pants.webp',
    data: {
      name: 'Chinos',
      category: { group: 'clothing', value: 'bottoms' },
      color: 'orange',
      tags: ['casual', 'cotton'],
      notes: 'Terracotta-colored cotton chinos',
      description: 'Straight-leg cotton chino pants in warm terracotta',
    },
    container: 1,
  },
  {
    file: 'suitjacket.webp',
    data: {
      name: 'Suit Jacket',
      category: { group: 'clothing', value: 'tops' },
      color: 'blue',
      tags: ['formal', 'business'],
      notes: 'Royal blue two-button blazer',
      description: 'Single-breasted suit jacket in cobalt blue',
    },
    container: 1,
  },
  {
    file: 'suitpants.webp',
    data: {
      name: 'Suit Trousers',
      category: { group: 'clothing', value: 'bottoms' },
      color: 'blue',
      tags: ['formal', 'business'],
      notes: 'Navy dress trousers — pair with suit jacket',
      description: 'Flat-front suit trousers in dark navy',
    },
    container: 1,
  },
  {
    file: 'towel.webp',
    data: {
      name: 'Beach Towel',
      category: { group: 'travel', value: 'comfort' },
      color: 'blue',
      tags: ['beach', 'summer'],
      notes: 'Tropical print beach towel with tassels',
      description: 'Colorful striped towel with fish and hibiscus design',
    },
    container: 0,
  },
  {
    file: 'trunks.webp',
    data: {
      name: 'Swim Trunks',
      category: { group: 'clothing', value: 'swimwear' },
      color: 'red',
      tags: ['beach', 'summer'],
      notes: 'Red swim trunks',
      description: 'Classic red swim shorts',
    },
    container: 0,
  },
  {
    file: 'winter jacket.webp',
    data: {
      name: 'Puffer Jacket',
      category: { group: 'clothing', value: 'outerwear' },
      color: 'blue',
      tags: ['winter', 'warm'],
      notes: 'Hooded puffer jacket with sherpa lining',
      description: 'Two-tone blue and white insulated winter jacket with sherpa trim',
    },
    container: 1,
  },
];

// ---------- main ----------

console.log(`Seeding demo data for user ${demoUid}`);
if (dryRun) console.log('DRY RUN\n');

const now = FieldValue.serverTimestamp();
const containerIds = [];

// Create containers
for (const c of containers) {
  const filePath = resolve(demoDir, c.file);
  const docRef = db.collection(`${userPath}/containers`).doc();
  const photoPath = `${userPath}/containers/${docRef.id}.jpg`;

  console.log(`  + container: ${c.data.name} (${docRef.id})`);

  if (!dryRun) {
    const jpegBuf = await uploadPhoto(filePath, photoPath);
    const thumb = await makeContainerThumb(jpegBuf);
    await docRef.set({
      ...c.data,
      photoPath,
      photoThumb: thumb,
      createdAt: now,
      updatedAt: now,
    });
  }
  containerIds.push(docRef.id);
}

// Create items
const itemIds = [];
for (const item of items) {
  const filePath = resolve(demoDir, item.file);
  const docRef = db.collection(`${userPath}/items`).doc();
  const photoPath = `${userPath}/items/${docRef.id}.jpg`;
  const nobgPath = `${userPath}/items/${docRef.id}_nobg.png`;
  const containerId = containerIds[item.container] || null;

  console.log(`  + item: ${item.data.name} → ${containers[item.container].data.name} (${docRef.id})`);

  if (!dryRun) {
    const jpegBuf = await uploadPhoto(filePath, photoPath);
    const thumb = await makeThumb(jpegBuf, 100);
    await uploadNobgPng(filePath, nobgPath);
    const nobgThumb = await makeNobgThumb(filePath);

    await docRef.set({
      ...item.data,
      containerId,
      quantityOwned: 1,
      quantityPackDefault: 1,
      photoPath,
      photoThumb: thumb,
      photoNobgPath: nobgPath,
      photoNobgThumb: nobgThumb,
      createdAt: now,
      updatedAt: now,
    });
  }
  itemIds.push(docRef.id);
}

// Create a packing list with some items
const listRef = db.collection(`${userPath}/lists`).doc();
console.log(`  + list: Beach Getaway (${listRef.id})`);

if (!dryRun) {
  await listRef.set({
    name: 'Beach Getaway',
    isEssential: false,
    createdAt: now,
    updatedAt: now,
  });

  // Add beach-related items to the list: towel, trunks, chinos, boots
  const beachItems = [6, 7, 3, 0]; // towel, trunks, chinos, boots
  for (let i = 0; i < beachItems.length; i++) {
    const entryRef = db.collection(`${userPath}/lists/${listRef.id}/entries`).doc();
    await entryRef.set({
      itemId: itemIds[beachItems[i]],
      quantityOverride: null,
      sortOrder: (i + 1) * 1000,
      addedAt: now,
    });
  }
}

// Create an essentials list
const essRef = db.collection(`${userPath}/lists`).doc();
console.log(`  + list: Business Trip Essentials (${essRef.id})`);

if (!dryRun) {
  await essRef.set({
    name: 'Business Trip Essentials',
    isEssential: false,
    createdAt: now,
    updatedAt: now,
  });

  // Suit jacket, suit trousers, tie, chinos
  const bizItems = [4, 5, 2, 3];
  for (let i = 0; i < bizItems.length; i++) {
    const entryRef = db.collection(`${userPath}/lists/${essRef.id}/entries`).doc();
    await entryRef.set({
      itemId: itemIds[bizItems[i]],
      quantityOverride: null,
      sortOrder: (i + 1) * 1000,
      addedAt: now,
    });
  }
}

console.log(`\nDone! Created ${containers.length} containers, ${items.length} items, 2 lists.`);
