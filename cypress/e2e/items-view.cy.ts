/**
 * E2E tests for items view features:
 * - Grid/list toggle
 * - Color filter
 * - Subcategory grouping
 * - Texture background picker in Settings
 *
 * Requires CYPRESS_TEST_EMAIL and CYPRESS_TEST_PASSWORD env vars
 * pointing to a valid Firebase test account. Skipped in CI if missing.
 */

const hasCredentials = () =>
  Boolean(Cypress.env('TEST_EMAIL') && Cypress.env('TEST_PASSWORD'));

describe('Items view — grid/list toggle, grouping, color filter', () => {
  before(function () {
    if (!hasCredentials()) this.skip();
  });

  beforeEach(function () {
    if (!hasCredentials()) this.skip();
    cy.login();
    cy.goToItems();
  });

  // ------------------------------------------------------------------
  //  Grid / list toggle
  // ------------------------------------------------------------------

  it('toggles between list and grid view', () => {
    // Default is list — no grid-mode class
    cy.get('.items-scroll').should('not.have.class', 'grid-mode');
    cy.get('#items-list-content .item-row').should('exist');

    // Click toggle → grid
    cy.get('#btn-view-toggle').click();
    cy.get('.items-scroll').should('have.class', 'grid-mode');
    cy.get('#items-list-content .item-grid').should('exist');
    cy.get('#items-list-content .item-grid-cell').should('exist');

    // Click toggle → back to list
    cy.get('#btn-view-toggle').click();
    cy.get('.items-scroll').should('not.have.class', 'grid-mode');
    cy.get('#items-list-content .item-row').should('exist');
  });

  it('persists view mode across navigations', () => {
    // Switch to grid
    cy.get('#btn-view-toggle').click();
    cy.get('.items-scroll').should('have.class', 'grid-mode');

    // Navigate away and back
    cy.get('#bottom-nav button[data-tab="containers"]').click();
    cy.get('#view-containers').should('have.class', 'active');
    cy.goToItems();

    // Should still be grid
    cy.get('.items-scroll').should('have.class', 'grid-mode');

    // Restore to list for other tests
    cy.get('#btn-view-toggle').click();
    cy.get('.items-scroll').should('not.have.class', 'grid-mode');
  });

  // ------------------------------------------------------------------
  //  Group-by segmented control
  // ------------------------------------------------------------------

  it('groups by category by default and shows group headers', () => {
    cy.get('.group-by-row .segment[data-group="category"]').should('have.class', 'active');
    cy.get('#items-list-content .group-header').should('exist');
  });

  it('switches to subcategory grouping', () => {
    cy.get('.group-by-row .segment[data-group="subcategory"]').click();
    cy.get('.group-by-row .segment[data-group="subcategory"]').should('have.class', 'active');
    cy.get('.group-by-row .segment[data-group="category"]').should('not.have.class', 'active');
    cy.get('#items-list-content .group-header').should('exist');

    // Subcategory headers should be more granular than category headers
    cy.get('#items-list-content .group-header').then($headers => {
      // Store count for comparison
      const subcatCount = $headers.length;

      // Switch to category grouping
      cy.get('.group-by-row .segment[data-group="category"]').click();
      cy.get('#items-list-content .group-header').should('exist').then($catHeaders => {
        // Subcategory should have at least as many groups as category
        expect(subcatCount).to.be.gte($catHeaders.length);
      });
    });
  });

  it('switches to container grouping', () => {
    cy.get('.group-by-row .segment[data-group="container"]').click();
    cy.get('.group-by-row .segment[data-group="container"]').should('have.class', 'active');
    cy.get('#items-list-content .group-header').should('exist');

    // Restore to category
    cy.get('.group-by-row .segment[data-group="category"]').click();
  });

  // ------------------------------------------------------------------
  //  Color filter
  // ------------------------------------------------------------------

  it('shows color filter chips and filters items when clicked', () => {
    // Color chips row should be visible if items have colors
    cy.get('#items-color-chips').then($el => {
      if ($el.hasClass('hidden')) {
        // No items with colors — skip rest of test
        return;
      }

      // "All" chip should be active by default
      cy.get('#items-color-chips .color-chip-all').should('have.class', 'active');

      // Count items before filtering
      cy.get('#items-list-content .item-row, #items-list-content .item-grid-cell').then(
        $before => {
          const beforeCount = $before.length;

          // Click first color chip
          cy.get('#items-color-chips .color-chip').first().click();
          cy.get('#items-color-chips .color-chip-all').should('not.have.class', 'active');

          // Items should be filtered (fewer or equal)
          cy.get('#items-list-content .item-row, #items-list-content .item-grid-cell').should(
            'have.length.lte',
            beforeCount,
          );

          // Click "All" to reset
          cy.get('#items-color-chips .color-chip-all').click();
          cy.get('#items-color-chips .color-chip-all').should('have.class', 'active');
        },
      );
    });
  });

  // ------------------------------------------------------------------
  //  Grid view opens item detail
  // ------------------------------------------------------------------

  it('clicking a grid cell opens the item detail', () => {
    // Switch to grid
    cy.get('#btn-view-toggle').click();
    cy.get('.items-scroll').should('have.class', 'grid-mode');

    // Click first grid cell
    cy.get('#items-list-content .item-grid-cell').first().click();

    // Should navigate to item detail view
    cy.get('#view-item').should('have.class', 'active');

    // Go back
    cy.get('#btn-back').click();
    cy.get('#view-items').should('have.class', 'active');

    // Restore to list
    cy.get('#btn-view-toggle').click();
  });
});

describe('Settings — thumbnail background picker', () => {
  before(function () {
    if (!hasCredentials()) this.skip();
  });

  beforeEach(function () {
    if (!hasCredentials()) this.skip();
    cy.login();
    cy.goToItems();
    // Navigate to settings via the gear icon
    cy.get('#btn-header-action').click();
    cy.get('#view-settings').should('have.class', 'active');
  });

  it('renders texture background options', () => {
    cy.get('#thumb-bg-picker').should('exist');
    cy.get('#thumb-bg-picker .thumb-bg-opt').should('have.length', 4); // wood, marble, metal, none
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="wood"]').should('exist');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"]').should('exist');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"]').should('exist');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="none"]').should('exist');
  });

  it('has one active option by default', () => {
    cy.get('#thumb-bg-picker .thumb-bg-opt.active').should('have.length', 1);
  });

  it('switches active background on click', () => {
    // Click marble
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"]').click();
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"]').should('have.class', 'active');

    // Others should not be active
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="wood"]').should('not.have.class', 'active');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"]').should('not.have.class', 'active');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="none"]').should('not.have.class', 'active');

    // Click metal
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"]').click();
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"]').should('have.class', 'active');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"]').should('not.have.class', 'active');
  });

  it('persists selection in localStorage', () => {
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"]').click();
    cy.window().then(win => {
      expect(win.localStorage.getItem('packrat_thumb_bg')).to.eq('marble');
    });

    // Switch to metal
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"]').click();
    cy.window().then(win => {
      expect(win.localStorage.getItem('packrat_thumb_bg')).to.eq('metal');
    });

    // Restore to wood
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="wood"]').click();
    cy.window().then(win => {
      expect(win.localStorage.getItem('packrat_thumb_bg')).to.eq('wood');
    });
  });

  it('texture swatches use image URLs not gradients', () => {
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="wood"] .thumb-bg-swatch')
      .should('have.attr', 'style')
      .and('include', 'url(/textures/wood.jpg)');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="marble"] .thumb-bg-swatch')
      .should('have.attr', 'style')
      .and('include', 'url(/textures/marble.jpg)');
    cy.get('#thumb-bg-picker .thumb-bg-opt[data-bg="metal"] .thumb-bg-swatch')
      .should('have.attr', 'style')
      .and('include', 'url(/textures/metal.jpg)');
  });
});
