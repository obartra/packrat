#!/usr/bin/env node
/**
 * Reset the demo account: delete all data then re-seed.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/reset-demo.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { execFileSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const DEMO_EMAIL = 'demo@packrat.app';

const bucket =
  process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID;

const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : applicationDefault();

initializeApp({ credential, storageBucket: bucket, projectId });

const auth = getAuth();
const db = getFirestore();
const storage = getStorage().bucket();

// Find demo user
let demoUid;
try {
  const user = await auth.getUserByEmail(DEMO_EMAIL);
  demoUid = user.uid;
} catch {
  console.error(`Demo user ${DEMO_EMAIL} not found. Run create-demo-user.mjs first.`);
  process.exit(1);
}

console.log(`Resetting demo account ${demoUid} (${DEMO_EMAIL})\n`);

// Delete all data
const userPath = `users/${demoUid}`;
const collections = ['items', 'containers', 'lists', 'trips'];

for (const col of collections) {
  const snap = await db.collection(`${userPath}/${col}`).get();
  if (snap.empty) continue;

  // For lists, also delete their entries subcollections
  if (col === 'lists') {
    for (const listDoc of snap.docs) {
      const entries = await db.collection(`${userPath}/lists/${listDoc.id}/entries`).get();
      for (const entry of entries.docs) {
        await entry.ref.delete();
      }
    }
  }

  for (const docSnap of snap.docs) {
    await docSnap.ref.delete();
  }
  console.log(`  Deleted ${snap.size} ${col}`);
}

// Delete storage files
try {
  const [files] = await storage.getFiles({ prefix: `${userPath}/` });
  for (const file of files) {
    await file.delete();
  }
  if (files.length) console.log(`  Deleted ${files.length} storage files`);
} catch {
  // Storage may be empty
}

console.log('\nRe-seeding...\n');

// Run seed script
execFileSync('node', [resolve(__dir, 'seed-demo.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, DEMO_UID: demoUid },
});
