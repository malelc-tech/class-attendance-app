// Supabase client for use in Server Components, Route Handlers, and
// Server Actions. Reads/writes the auth cookie via Next.js `cookies()`.
//
// Deliberately not parameterized with the Database type — see the
// comment in client.ts for why.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: CookieOptions;
          }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — safe to ignore
            // because middleware refreshes the session on every request.
          }
        },
      },
    }
  );
}

// Admin/service-role client — NEVER import this into client-facing code.
// Only used inside Route Handlers that must bypass RLS to validate
// attendance server-side (QR token + geolocation + device checks).
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Temporary diagnostic: tells us in the CloudWatch log exactly which
  // variable is missing at runtime, and how long the key is if present
  // (a real service_role JWT is normally 200+ characters — a short or
  // zero length here means it's present but empty/truncated, which is
  // different from not being set at all). Never logs the actual value.
  if (!url || !key) {
    throw new Error(
      `Missing Supabase server config — NEXT_PUBLIC_SUPABASE_URL: ${
        url ? "present" : "MISSING"
      }, SUPABASE_SERVICE_ROLE_KEY: ${
        key ? `present (length ${key.length})` : "MISSING"
      }`
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
