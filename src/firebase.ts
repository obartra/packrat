import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

function readEnv(): FirebaseOptions {
  const env = import.meta.env;
  const missing = REQUIRED_ENV.filter(k => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. ` +
        `Copy .env.example to .env.local and fill in your Firebase config.`,
    );
  }
  return {
    apiKey: env['VITE_FIREBASE_API_KEY'],
    authDomain: env['VITE_FIREBASE_AUTH_DOMAIN'],
    projectId: env['VITE_FIREBASE_PROJECT_ID'],
    storageBucket: env['VITE_FIREBASE_STORAGE_BUCKET'],
    messagingSenderId: env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
    appId: env['VITE_FIREBASE_APP_ID'],
  };
}

const firebaseApp = initializeApp(readEnv());

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
