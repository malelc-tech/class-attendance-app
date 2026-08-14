// Supabase client for use inside Client Components ("use client").
// Uses the public anon key — safe to expose in the browser because
// all access is gated by Row Level Security policies (see schema.sql).

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
