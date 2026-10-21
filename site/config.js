// The Supabase URL and publishable (anon) key are meant to be public: row level
// security in supabase/schema.sql is what keeps each person's data private.
window.HABIT_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseKey: "YOUR-PUBLISHABLE-OR-ANON-KEY",

  pointsPerEuro: 10,
  gatePoints: 250,
  validityDays: 30,
};
