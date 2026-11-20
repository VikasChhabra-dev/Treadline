// Threadline configuration.
// Copy these two values from your Supabase project:
//   Dashboard → Project Settings → API (or "Data API")
//     • Project URL            → supabaseUrl
//     • anon / publishable key → supabaseAnonKey
// The anon key is designed to be public; your data is protected by the
// row-level security rules in supabase/schema.sql. Never put the
// service_role (secret) key here.
window.THREADLINE_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
};
