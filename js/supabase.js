// ============================================================
// js/supabase.js
// Single shared Supabase client instance for the whole app.
// Every other module imports `supabase` from here — never
// create a second client instance anywhere else.
// ============================================================

// Loaded from CDN in every HTML file BEFORE this module:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
// That script exposes a global `supabase` factory object (window.supabase).

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
// These are PUBLIC values by design — the Supabase "anon" key
// is safe to ship to the browser because every table is locked
// down with Row Level Security (see supabase_schema.sql).
// Do NOT put your service_role key here, ever.
//
// Replace the two placeholders below with your own project's
// values from: Supabase Dashboard → Project Settings → API
// ------------------------------------------------------------
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || 'YOUR-PUBLIC-ANON-KEY';

if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-PUBLIC-ANON-KEY')) {
  console.warn(
    '[SignSpeak AI] Supabase is not configured yet.\n' +
    'Edit js/env.js (or js/supabase.js) with your project URL and anon key.\n' +
    'Find them at: Supabase Dashboard → Project Settings → API.'
  );
}

// Create the single shared client.
// `persistSession: true` + localStorage keeps the user logged in
// across page reloads and PWA relaunches.
export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // needed for password-reset links
    storage: window.localStorage,
    storageKey: 'signspeak-auth',
  },
});

// ------------------------------------------------------------
// SESSION HELPERS
// ------------------------------------------------------------

/**
 * Returns the current logged-in user, or null.
 */
export async function getCurrentUser() {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

/**
 * Returns the current session (includes access token), or null.
 */
export async function getCurrentSession() {
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session;
}

/**
 * Guards a page: redirects to login.html if nobody is signed in.
 * Call this at the top of dashboard.js, history.js, settings.js, learn.js.
 */
export async function requireAuth() {
  const session = await getCurrentSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

/**
 * Fetches (or lazily creates) the profile row for a user id.
 */
export async function getProfile(userId) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[SignSpeak AI] getProfile error:', error.message);
    return null;
  }
  return data;
}

/**
 * Subscribes to auth state changes (login/logout/token refresh).
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}
