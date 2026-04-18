#!/usr/bin/env node
/**
 * One-time migration: generate photoThumb and optionally remove backgrounds
 * for items/containers that have photos but are missing processed versions.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-photos.mjs [--dry-run] [--verify] [--nobg]
 *
 *   --dry-run   Show what would be updated without writing
 *   --verify    Generate an HTML report of all thumbnails
 *   --nobg      Also run background removal for items (slow, ~5-10s per photo)
 *   --rethumb   Force-regenerate all thumbnails (e.g. after size change)
 *
 * Requires: npm install -D firebase-admin sharp @imgly/background-removal-node
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

// Load .env.local if present
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
const doNobg = args.includes('--nobg');
const rethumb = args.includes('--rethumb');

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

async function downloadPhoto(storagePath) {
  const file = storage.file(storagePath);
  const [buffer] = await file.download();
  return buffer;
}

async function generateThumb(buffer, size = 100) {
  const thumbBuffer = await sharp(buffer)
    .resize(size, size, { fit: 'inside' })
    .jpeg({ quality: 40 })
    .toBuffer();
  return `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
}

async function generateNobg(buffer, storagePath) {
  // Lazy-load bg removal (heavy dependency)
  const { removeBackground } = await import('@imgly/background-removal-node');
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const resultBlob = await removeBackground(blob, {
    output: { format: 'image/png', quality: 1 },
  });
  const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

  // Upload no-bg PNG
  const nobgPath = storagePath.replace(/\.jpg$/, '_nobg.png');
  const file = storage.file(nobgPath);
  await file.save(resultBuffer, { contentType: 'image/png' });

  // Generate no-bg thumbnail
  const nobgThumbBuffer = await sharp(resultBuffer)
    .resize(100, 100, { fit: 'inside' })
    .png()
    .toBuffer();
  const nobgThumb = `data:image/png;base64,${nobgThumbBuffer.toString('base64')}`;

  return { nobgPath, nobgThumb };
}

async function backfillCollection(userPath, collection, withNobg) {
  const snap = await db.collection(`${userPath}/${collection}`).get();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.photoPath) { skipped++; continue; }

    const needsThumb = !data.photoThumb || rethumb;
    const needsNobg = withNobg && collection === 'items' && !data.photoNobgPath;
    if (!needsThumb && !needsNobg) { skipped++; continue; }

    if (dryRun) {
      const parts = [];
      if (needsThumb) parts.push('thumb');
      if (needsNobg) parts.push('nobg');
      console.log(`  ~ ${collection}/${docSnap.id} (would ${parts.join(' + ')})`);
      updated++;
      continue;
    }

    try {
      const buffer = await downloadPhoto(data.photoPath);
      const update = {};

      if (needsThumb) {
        const thumbSize = collection === 'containers' ? 400 : 100;
        update.photoThumb = await generateThumb(buffer, thumbSize);
      }
      if (needsNobg) {
        const { nobgPath, nobgThumb } = await generateNobg(buffer, data.photoPath);
        update.photoNobgPath = nobgPath;
        update.photoNobgThumb = nobgThumb;
      }

      await docSnap.ref.update(update);
      updated++;
      const parts = Object.keys(update).join(', ');
      console.log(`  + ${collection}/${docSnap.id} (${parts})`);
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
      hasNobg: !!data.photoNobgThumb,
      nobgThumb: data.photoNobgThumb || null,
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

  const missingThumb = allEntries.filter(e => !e.hasThumb);
  const missingNobg = allEntries.filter(e => e.collection === 'items' && !e.hasNobg);
  console.log(`\n${allEntries.length} photo(s): ${missingThumb.length} missing thumbs, ${missingNobg.length} items missing nobg`);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Photo verification</title>
<style>
  body { font-family: system-ui; background: #111; color: #eee; padding: 24px; }
  h2 { margin-top: 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
  .card { text-align: center; }
  .card img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; background: #333; }
  .card .nobg { background: repeating-conic-gradient(#444 0% 25%, #333 0% 50%) 50% / 16px 16px; }
  .card p { font-size: 11px; margin: 4px 0 0; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .missing { border: 2px dashed #f44; border-radius: 8px; width: 80px; height: 80px; margin: 0 auto;
    display: flex; align-items: center; justify-content: center; font-size: 24px; }
</style></head><body>
<h2>Thumbnails (${allEntries.length})</h2>
<div class="grid">
${allEntries.map(e => `<div class="card">
  ${e.thumb ? `<img src="${e.thumb}" alt="${e.name}">` : '<div class="missing">?</div>'}
  <p>${e.name}</p>
</div>`).join('\n')}
</div>
<h2>No-background (items only)</h2>
<div class="grid">
${allEntries.filter(e => e.collection === 'items').map(e => `<div class="card">
  ${e.nobgThumb ? `<img class="nobg" src="${e.nobgThumb}" alt="${e.name}">` : '<div class="missing">?</div>'}
  <p>${e.name}</p>
</div>`).join('\n')}
</div>
</body></html>`;

  const outPath = 'scripts/photos-report.html';
  writeFileSync(outPath, html);
  console.log(`Report written to ${outPath}`);
}

async function runBackfill() {
  if (dryRun) console.log('DRY RUN\n');
  if (doNobg) console.log('Background removal enabled (slow)\n');

  const userDocs = await db.collection('users').listDocuments();
  console.log(`Found ${userDocs.length} user(s)\n`);

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    console.log(`User: ${uid}`);

    const items = await backfillCollection(`users/${uid}`, 'items', doNobg);
    const containers = await backfillCollection(`users/${uid}`, 'containers', false);

    const label = dryRun ? 'would update' : 'updated';
    console.log(`  items:      ${items.updated} ${label}, ${items.skipped} skipped, ${items.failed} failed`);
    console.log(`  containers: ${containers.updated} ${label}, ${containers.skipped} skipped, ${containers.failed} failed\n`);
  }

  console.log('Done!');
}

(verify ? runVerify() : runBackfill()).catch(err => {
  console.error(err);
  process.exit(1);
});
