// Cypress support file — runs before every test.
// Add custom commands or global configuration here.

// Swallow uncaught Firebase exceptions from dummy env vars in CI.
// Real user interactions (form submit, etc.) are still tested.
Cypress.on('uncaught:exception', err => {
  if (/firebase/i.test(err.message) || /auth\//i.test(err.message)) {
    return false;
  }
  return undefined;
});
