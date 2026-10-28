/*
 * Database settings. They are left empty in the repository on purpose: the GitHub Actions
 * deploy (.github/workflows/deploy.yml) writes the real values from the repository secrets
 * SUPABASE_URL and SUPABASE_KEY. Only the *publishable* key ever goes here; it is designed to
 * be public, and access is controlled by the policies in supabase/setup.sql.
 *
 * Left empty, the app runs in demo mode and saves links only in the current browser.
 * To run against your own database locally, fill these in but do not commit them.
 */
window.HASHLINK_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  // How long the redirect page shows the lookup statistics before forwarding (ms).
  redirectDelayMs: 1500,
};
