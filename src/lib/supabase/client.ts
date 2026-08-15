// Supabase client for use inside Client Components ("use client").
// Uses the public anon key — safe to expose in the browser because
// all access is gated by Row Level Security policies (see schema.sql).
//
// Deliberately NOT parameterized with the hand-written Database type.
// That type file is a simplified approximation, not a full generated
// schema (which supabase-js's strict generics expect down to
// relationship metadata), so passing it in caused TypeScript to
// misinfer several query results as `never` — a real production build
// (like Amplify's) fails hard on that, even though `npm run dev` never
// catches it. Leaving the client untyped avoids that whole category of
// error; runtime behavior is unaffected either way.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
