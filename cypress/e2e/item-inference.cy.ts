/**
 * E2E tests for item form with photo inference.
 *
 * Requires CYPRESS_TEST_EMAIL and CYPRESS_TEST_PASSWORD env vars
 * pointing to a valid Firebase test account. Skipped in CI if missing.
 *
 * The Anthropic API is intercepted so these tests never hit a real LLM.
 */

const hasCredentials = () =>
  Boolean(Cypress.env('TEST_EMAIL') && Cypress.env('TEST_PASSWORD'));

const inferenceResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        name: 'Navy polo shirt',
        description: 'Lightweight cotton polo with button collar, suitable for casual or smart-casual settings.',
        categoryGroup: 'clothing',
        categoryValue: 'tops',
        color: '#1B3A5C',
        tags: ['cotton', 'casual', 'summer'],
      }),
    },
  ],
  stop_reason: 'end_turn',
};

describe('Item form & photo inference', () => {
  before(function () {
    if (!hasCredentials()) this.skip();
  });

  beforeEach(function () {
    if (!hasCredentials()) this.skip();

    // Intercept Anthropic API — return mock inference result
    cy.intercept('POST', 'https://api.anthropic.com/v1/messages', req => {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      // Only intercept inference calls (Haiku model), let trip planner through
      if (body.model?.includes('haiku')) {
        req.reply({ statusCode: 200, body: inferenceResponse });
      }
    }).as('inferenceCall');

    cy.login();

    // Set a fake API key so inference triggers (getApiKey() checks localStorage)
    cy.window().then(win => {
      win.localStorage.setItem('packrat_anthropic_key', 'test-key-for-e2e');
    });

    cy.goToItems();
  });

  // ------------------------------------------------------------------
  //  Form structure
  // ------------------------------------------------------------------

  it('item form renders description, color, and photo fields', () => {
    cy.get('#btn-add-item').click();
    cy.get('#f-name').should('exist');
    cy.get('#f-description').should('exist');
    cy.get('#f-color').should('exist');
    cy.get('#f-color-swatch').should('exist');
    cy.get('#f-inference-status').should('have.class', 'hidden');
  });

  it('new taxonomy groups appear in the category dropdown', () => {
    cy.get('#btn-add-item').click();
    cy.get('#f-cat-group option').then($opts => {
      const values = [...$opts].map(o => (o as HTMLOptionElement).value);
      expect(values).to.include('travel');
      expect(values).to.include('food');
    });
  });

  it('selecting travel group shows travel subtypes', () => {
    cy.get('#btn-add-item').click();
    cy.get('#f-cat-group').select('travel');
    cy.get('#f-cat-value option').then($opts => {
      const values = [...$opts].map(o => (o as HTMLOptionElement).value);
      expect(values).to.include('comfort');
      expect(values).to.include('organization');
      expect(values).to.include('security');
    });
  });

  // ------------------------------------------------------------------
  //  Color swatch
  // ------------------------------------------------------------------

  it('color swatch updates when user types a hex value', () => {
    cy.get('#btn-add-item').click();
    cy.get('#f-color').type('#FF5733');
    // Browser normalizes hex → rgb in the style attribute
    cy.get('#f-color-swatch').should('have.css', 'background-color', 'rgb(255, 87, 51)');
  });

  // ------------------------------------------------------------------
  //  Photo inference (mocked API)
  // ------------------------------------------------------------------

  it('shows "Analyzing photo..." then fills fields on photo selection', () => {
    cy.get('#btn-add-item').click();

    // Simulate selecting a photo via the library file input
    cy.get('#file-library').selectFile('cypress/fixtures/test-item.jpg', { force: true });

    // Inference status should appear
    cy.get('#f-inference-status').should('not.have.class', 'hidden');

    // Wait for the mocked API to respond
    cy.wait('@inferenceCall');

    // Status hides after completion
    cy.get('#f-inference-status', { timeout: 5000 }).should('have.class', 'hidden');

    // Fields should be populated from mock response
    cy.get('#f-name').should('have.value', 'Navy polo shirt');
    cy.get('#f-description').should(
      'have.value',
      'Lightweight cotton polo with button collar, suitable for casual or smart-casual settings.',
    );
    cy.get('#f-cat-group').should('have.value', 'clothing');
    cy.get('#f-cat-value').should('have.value', 'tops');
    cy.get('#f-color').should('have.value', '#1B3A5C');
    cy.get('#f-tags').should('have.value', 'cotton, casual, summer');
  });

  it('does not overwrite fields the user has already touched', () => {
    cy.get('#btn-add-item').click();

    // User types a name before selecting a photo
    cy.get('#f-name').type('My custom name');

    // Now select a photo — inference fires
    cy.get('#file-library').selectFile('cypress/fixtures/test-item.jpg', { force: true });
    cy.wait('@inferenceCall');
    cy.get('#f-inference-status', { timeout: 5000 }).should('have.class', 'hidden');

    // Name should be preserved (user typed it), other fields filled by inference
    cy.get('#f-name').should('have.value', 'My custom name');
    cy.get('#f-description').should('contain.value', 'cotton polo');
    cy.get('#f-color').should('have.value', '#1B3A5C');
  });

  it('handles inference API failure gracefully', () => {
    // Override the intercept with an error response for this test
    cy.intercept('POST', 'https://api.anthropic.com/v1/messages', {
      statusCode: 500,
      body: 'Internal Server Error',
    }).as('inferenceError');

    cy.get('#btn-add-item').click();
    cy.get('#file-library').selectFile('cypress/fixtures/test-item.jpg', { force: true });
    cy.wait('@inferenceError');

    // Status should hide (no infinite spinner)
    cy.get('#f-inference-status', { timeout: 5000 }).should('have.class', 'hidden');

    // Form should still be functional — user can type and save
    cy.get('#f-name').type('Manual entry after failure');
    cy.get('#f-name').should('have.value', 'Manual entry after failure');
  });

  // ------------------------------------------------------------------
  //  Save round-trip (new fields persisted and displayed)
  // ------------------------------------------------------------------

  it('saves description and color, shows them in detail view', () => {
    cy.get('#btn-add-item').click();

    // Fill fields manually (no photo needed for this test)
    const itemName = `E2E Test Item ${Date.now()}`;
    cy.get('#f-name').type(itemName);
    cy.get('#f-description').type('Test description for e2e');
    cy.get('#f-color').type('#AABBCC');
    cy.get('#btn-sheet-save').click();

    // Should see success toast
    cy.contains('Item added').should('be.visible');

    // Find and open the item we just created
    cy.get('#items-search').clear().type(itemName);
    cy.contains('.item-name', itemName).click();

    // Detail view should show description and color
    cy.contains('.detail-value', 'Test description for e2e').should('be.visible');
    cy.contains('.detail-value', '#AABBCC').should('be.visible');
    cy.get('.detail-value .color-dot').should('exist');

    // Clean up: delete the test item
    cy.contains('button', 'Delete').click();
    cy.get('#btn-confirm-ok').click();
  });

  // ------------------------------------------------------------------
  //  Search
  // ------------------------------------------------------------------

  it('search matches against description and color', () => {
    cy.get('#btn-add-item').click();
    const itemName = `Search Test ${Date.now()}`;
    cy.get('#f-name').type(itemName);
    cy.get('#f-description').type('unique-searchable-description');
    cy.get('#f-color').type('#FACADE');
    cy.get('#btn-sheet-save').click();
    cy.contains('Item added').should('be.visible');

    // Search by description substring
    cy.get('#items-search').clear().type('unique-searchable');
    cy.contains('.item-name', itemName).should('exist');

    // Search by color hex
    cy.get('#items-search').clear().type('#FACADE');
    cy.contains('.item-name', itemName).should('exist');

    // Search by something that doesn't match
    cy.get('#items-search').clear().type('zzz-no-match-zzz');
    cy.contains('.item-name', itemName).should('not.exist');

    // Clean up
    cy.get('#items-search').clear();
    cy.contains('.item-name', itemName).click();
    cy.contains('button', 'Delete').click();
    cy.get('#btn-confirm-ok').click();
  });
});
