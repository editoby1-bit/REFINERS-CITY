// Online database connection (Supabase).
// Fill in both values from Supabase: Project Settings > API (or "Connect").
// The anon / publishable key is designed to be public: the database security rules
// in supabase/setup.sql decide what each signed-in person may read or change.
// Leave both empty to run without the online database (records stay in this browser).
window.REFINERS_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
