describe('Packrat smoke tests', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('loads the login screen', () => {
    cy.contains('h1.login-logo', 'Packrat').should('be.visible');
  });

  it('shows the tagline', () => {
    cy.contains('Know what you own. Pack what you need.').should('be.visible');
  });

  it('renders both Sign In and Register tabs', () => {
    cy.get('#tab-signin').should('be.visible').and('have.class', 'active');
    cy.get('#tab-register').should('be.visible').and('not.have.class', 'active');
  });

  it('switches to Register mode when the tab is clicked', () => {
    cy.get('#tab-register').click();
    cy.get('#tab-register').should('have.class', 'active');
    cy.get('#tab-signin').should('not.have.class', 'active');
    cy.get('#login-register-extra').should('not.have.class', 'hidden');
    cy.get('#login-password2').should('be.visible');
    cy.get('#btn-login-submit').should('have.text', 'Create Account');
  });

  it('switches back to Sign In mode', () => {
    cy.get('#tab-register').click();
    cy.get('#tab-signin').click();
    cy.get('#tab-signin').should('have.class', 'active');
    cy.get('#login-register-extra').should('have.class', 'hidden');
    cy.get('#btn-login-submit').should('have.text', 'Sign In');
  });

  it('has a form with proper autocomplete attributes for password managers', () => {
    cy.get('#login-form').should('exist');
    cy.get('#login-email').should('have.attr', 'autocomplete', 'username');
    cy.get('#login-password').should('have.attr', 'autocomplete', 'current-password');
  });

  it('updates password autocomplete when switching to Register', () => {
    cy.get('#tab-register').click();
    cy.get('#login-password').should('have.attr', 'autocomplete', 'new-password');
    cy.get('#login-password2').should('have.attr', 'autocomplete', 'new-password');
  });

  it('blocks submission when credentials are empty (native validity)', () => {
    cy.get('#login-form').then($form => {
      expect(($form[0] as HTMLFormElement).checkValidity()).to.be.false;
    });
    cy.get('#login-email').then($el => {
      expect(($el[0] as HTMLInputElement).validity.valueMissing).to.be.true;
    });
  });

  it('hides app chrome on the login screen', () => {
    cy.get('#app-header').should('have.class', 'hidden');
    cy.get('#bottom-nav').should('have.class', 'hidden');
  });

  it('keeps chrome hidden when deep-linking to /login', () => {
    cy.visit('/login');
    cy.get('#view-login').should('have.class', 'active');
    cy.get('#app-header').should('have.class', 'hidden');
    cy.get('#bottom-nav').should('have.class', 'hidden');
  });

  it('redirects a logged-out user visiting a protected URL to login', () => {
    // Logged-out: visiting /items should show the login screen with no chrome.
    cy.visit('/items');
    cy.get('#view-login').should('have.class', 'active');
    cy.get('#app-header').should('have.class', 'hidden');
    cy.get('#bottom-nav').should('have.class', 'hidden');
  });

  it('has an SVG favicon and PWA manifest wired up', () => {
    cy.get('link[rel="icon"][type="image/svg+xml"]')
      .should('have.attr', 'href')
      .and('include', '.svg');
    cy.get('link[rel="manifest"]').should('have.attr', 'href', '/manifest.webmanifest');
    cy.get('link[rel="apple-touch-icon"]').should('exist');
    cy.get('meta[name="apple-mobile-web-app-capable"]').should('have.attr', 'content', 'yes');
  });

  it('sets the mobile-friendly viewport meta', () => {
    cy.get('meta[name="viewport"]')
      .should('have.attr', 'content')
      .and('include', 'width=device-width');
  });

  it('has no horizontal scroll at mobile width', () => {
    cy.window().then(win => {
      expect(win.document.documentElement.scrollWidth).to.be.at.most(
        win.document.documentElement.clientWidth,
      );
    });
  });
});
