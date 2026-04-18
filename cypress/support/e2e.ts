// Cypress support file — runs before every test.
// Add custom commands or global configuration here.
export {};

// Swallow uncaught Firebase exceptions from dummy env vars in CI.
// Real user interactions (form submit, etc.) are still tested.
Cypress.on('uncaught:exception', err => {
  if (/firebase/i.test(err.message) || /auth\//i.test(err.message)) {
    return false;
  }
  return undefined;
});

// ============================================================
//  Custom commands
// ============================================================

/** Log in with test credentials from Cypress env vars. */
Cypress.Commands.add('login', () => {
  const email = Cypress.env('TEST_EMAIL');
  const password = Cypress.env('TEST_PASSWORD');
  if (!email || !password) {
    throw new Error(
      'Missing TEST_EMAIL / TEST_PASSWORD Cypress env vars. ' +
        'Set them in .env via CYPRESS_TEST_EMAIL / CYPRESS_TEST_PASSWORD.',
    );
  }
  cy.session(
    email,
    () => {
      // First run: log in via the form
      cy.visit('/');
      cy.get('#login-email').type(email);
      cy.get('#login-password').type(password);
      cy.get('#btn-login-submit').click();
      cy.get('#bottom-nav', { timeout: 15000 }).should('not.have.class', 'hidden');
    },
    {
      validate() {
        // On restore: visit and confirm auth still works
        cy.visit('/');
        cy.get('#bottom-nav', { timeout: 10000 }).should('not.have.class', 'hidden');
      },
    },
  );
  // After session setup/restore, ensure we're on the app
  cy.visit('/');
  cy.get('#bottom-nav', { timeout: 15000 }).should('not.have.class', 'hidden');
});

/** Navigate to the Items tab. */
Cypress.Commands.add('goToItems', () => {
  cy.get('#bottom-nav button[data-tab="items"]').click();
  cy.get('#view-items').should('have.class', 'active');
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(): Chainable<void>;
      goToItems(): Chainable<void>;
    }
  }
}
