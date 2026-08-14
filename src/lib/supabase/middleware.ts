// Refreshes the Supabase auth session on every request and protects
// role-based routes. Called from the root middleware.ts.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROLE_PREFIXES: Record<string, string> = {
  "/teacher": "teacher",
  "/student": "student",
  "/admin": "admin",
};

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const matchedPrefix = Object.keys(ROLE_PREFIXES).find((p) =>
    path.startsWith(p)
  );

  // Not logged in but hitting a protected area -> bounce to /login
  if (matchedPrefix && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectTo", path);
    return NextResponse.redirect(redirectUrl);
  }

  // Logged in — verify role matches the section they're trying to reach.
  if (matchedPrefix && user) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const requiredRole = ROLE_PREFIXES[matchedPrefix];
    if (profile?.role !== requiredRole && profile?.role !== "admin") {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
  }

  return response;
}
