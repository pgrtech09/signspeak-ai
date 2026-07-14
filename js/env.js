// ============================================================
// js/env.js
// ------------------------------------------------------------
// This is the ONLY file you need to edit to connect the app to
// your own Supabase project. It must be loaded BEFORE
// js/supabase.js in every HTML page (see index.html for order).
//
// Where to find these values:
//   Supabase Dashboard → Project Settings → API
//     - "Project URL"        -> SUPABASE_URL
//     - "anon / public" key  -> SUPABASE_ANON_KEY
//
// These are safe to expose in client-side code: they are public
// by design, and access is restricted per-row by the Row Level
// Security policies defined in supabase_schema.sql. Never put
// your service_role / secret key in frontend code.
//
// For GitHub Pages deployments with no build step, this plain
// global-variable approach is the standard way to inject config
// without a bundler or Node backend.
// ============================================================

window.__ENV__ = {
  SUPABASE_URL: 'https://xdmjaprmckudtklgqiup.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkbWphcHJtY2t1ZHRrbGdxaXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjU2MjQsImV4cCI6MjA5OTYwMTYyNH0.NoXxV6C_gz6YeOXzn-9KJOxoQtqh1LPfvmonr20AQhE',
};
