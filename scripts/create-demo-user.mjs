#!/usr/bin/env node
/**
 * Create (or find) the demo Firebase Auth user and Firestore user doc.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/create-demo-user.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID;
const bucket =
  process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;

const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : applicationDefault();

initializeApp({ credential, storageBucket: bucket, projectId });

const DEMO_EMAIL = 'demo@packrat.app';
const DEMO_PASSWORD = 'demopackrat';

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(DEMO_EMAIL);
  console.log(`Demo user already exists: ${user.uid}`);
} catch {
  user = await auth.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    displayName: 'Demo User',
  });
  console.log(`Created demo user: ${user.uid}`);
}

// Ensure user doc exists
const userDoc = db.doc(`users/${user.uid}`);
const snap = await userDoc.get();
if (!snap.exists) {
  await userDoc.set({
    email: DEMO_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log('Created user doc');
} else {
  console.log('User doc already exists');
}

console.log(`\nDemo account:\n  Email:    ${DEMO_EMAIL}\n  Password: ${DEMO_PASSWORD}\n  UID:      ${user.uid}`);
console.log(`\nTo seed: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json DEMO_UID=${user.uid} node scripts/seed-demo.mjs`);
