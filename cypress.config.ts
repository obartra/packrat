import { defineConfig } from 'cypress';
import { loadEnv } from 'vite';

// Load CYPRESS_* vars from .env.local so Cypress picks them up
// alongside the VITE_FIREBASE_* vars Vite already reads.
const env = loadEnv('', process.cwd(), 'CYPRESS_');

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    screenshotOnRunFailure: true,
    viewportWidth: 390, // iPhone 14 Pro width — this is a mobile-first app
    viewportHeight: 844,
  },
  env: {
    TEST_EMAIL: env['CYPRESS_TEST_EMAIL'] || '',
    TEST_PASSWORD: env['CYPRESS_TEST_PASSWORD'] || '',
  },
});
