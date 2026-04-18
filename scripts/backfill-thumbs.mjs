#!/usr/bin/env node
/**
 * One-time migration: generate photoThumb for every item/container
 * that has a photoPath but no thumbnail yet.
 *
 * Usage:
 *   # 1. Download a service account key from Firebase Console →
 *   #    Project Settings → Service accounts → Generate new private key
 *   # 2. Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     FIREBASE_STORAGE_BUCKET=your-bucket.firebasestorage.app \
 *     node scripts/backfill-thumbs.mjs [--dry-run] [--verify]
 *
 *   --dry-run   Show what would be updated without writing anything
 *   --verify    Generate an HTML report of all thumbnails for visual check
 *
 * Requires: npm install -D firebase-admin sharp
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

// Load .env.local if present (same vars the app uses, prefixed VITE_FIREBASE_)
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verify = args.includes('--verify');

const bucket =
  process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
const projectId =
  process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
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

async function generateThumb(storagePath) {
  const file = storage.file(storagePath);
  const [buffer] = await file.download();
  const thumbBuffer = await sharp(buffer)
    .resize(80, 80, { fit: 'inside' })
    .jpeg({ quality: 40 })
    .toBuffer();
  return `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
}

async function backfillCollection(userPath, collection) {
  const snap = await db.collection(`${userPath}/${collection}`).get();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.photoPath) {
      skipped++;
      continue;
    }
    if (data.photoThumb) {
      skipped++;
      continue;
    }
    if (dryRun) {
      updated++;
      console.log(`  ~ ${collection}/${docSnap.id} (would update)`);
      continue;
    }
    try {
      const thumb = await generateThumb(data.photoPath);
      await docSnap.ref.update({ photoThumb: thumb });
      updated++;
      console.log(`  + ${collection}/${docSnap.id}`);
    } catch (err) {
      failed++;
      console.log(`  x ${collection}/${docSnap.id}: ${err.message}`);
    }
  }

  return { updated, skipped, failed };
}

async function collectThumbs(userPath, collection) {
  const snap = await db.collection(`${userPath}/${collection}`).get();
  const entries = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.photoPath) continue;
    entries.push({
      id: docSnap.id,
      name: data.name || docSnap.id,
      collection,
      hasThumb: !!data.photoThumb,
      thumb: data.photoThumb || null,
    });
  }

  return entries;
}

async function runVerify() {
  const userDocs = await db.collection('users').listDocuments();
  const allEntries = [];

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    const items = await collectThumbs(`users/${uid}`, 'items');
    const containers = await collectThumbs(`users/${uid}`, 'containers');
    allEntries.push(...items, ...containers);
  }

  const missing = allEntries.filter(e => !e.hasThumb);
  if (missing.length) {
    console.log(`\nMissing thumbnails (${missing.length}):`);
    missing.forEach(e => console.log(`  - ${e.collection}/${e.id} (${e.name})`));
  } else {
    console.log(`\nAll ${allEntries.length} photo(s) have thumbnails.`);
  }

  const withThumbs = allEntries.filter(e => e.hasThumb);
  if (!withThumbs.length) {
    console.log('No thumbnails to display.');
    return;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Thumbnail verification</title>
<style>
  body { font-family: system-ui; background: #111; color: #eee; padding: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
  .card { text-align: center; }
  .card img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; background: #333; }
  .card p { font-size: 11px; margin: 4px 0 0; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .missing { border: 2px dashed #f44; border-radius: 8px; width: 80px; height: 80px; margin: 0 auto;
    display: flex; align-items: center; justify-content: center; font-size: 24px; }
</style></head><body>
<h2>Thumbnail verification (${withThumbs.length} thumbnails, ${missing.length} missing)</h2>
<div class="grid">
${allEntries
  .map(
    e => `<div class="card">
  ${e.thumb ? `<img src="${e.thumb}" alt="${e.name}">` : '<div class="missing">?</div>'}
  <p>${e.name}</p>
</div>`,
  )
  .join('\n')}
</div></body></html>`;

  const outPath = 'scripts/thumbs-report.html';
  writeFileSync(outPath, html);
  console.log(`\nReport written to ${outPath} — open in a browser to inspect.`);
}

async function runBackfill() {
  if (dryRun) console.log('DRY RUN — no changes will be written\n');

  const userDocs = await db.collection('users').listDocuments();
  console.log(`Found ${userDocs.length} user(s)\n`);

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    console.log(`User: ${uid}`);

    const items = await backfillCollection(`users/${uid}`, 'items');
    const containers = await backfillCollection(`users/${uid}`, 'containers');

    const label = dryRun ? 'would update' : 'updated';
    console.log(
      `  items:      ${items.updated} ${label}, ${items.skipped} skipped, ${items.failed} failed`,
    );
    console.log(
      `  containers: ${containers.updated} ${label}, ${containers.skipped} skipped, ${containers.failed} failed\n`,
    );
  }

  console.log('Done!');
}

(verify ? runVerify() : runBackfill()).catch(err => {
  console.error(err);
  process.exit(1);
});
