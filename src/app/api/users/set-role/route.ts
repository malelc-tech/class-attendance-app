// POST /api/users/set-role
// Admin-only: changes a user's role in public.users AND stamps it into
// their auth app_metadata. That second part is what actually speeds
// things up — app_metadata rides along on every session token, so
// middleware and the login page can read the role instantly instead of
// running a separate database query on every single page load.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface SetRoleBody {
  userId: string;
  role: "student" | "teacher" | "admin";
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<SetRoleBody>;
  const { userId, role } = body;

  if (!userId || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();

  const { error: dbError } = await admin
    .from("users")
    .update({ role })
    .eq("id", userId);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });

  if (authError) {
    // Database role was already updated successfully; the app_metadata
    // sync is a performance optimization, not a security boundary (the
    // database role + RLS remain the source of truth), so we don't fail
    // the whole request over this — just report it.
    return NextResponse.json({
      success: true,
      warning: "Role updated, but the fast-login sync failed: " + authError.message,
    });
  }

  return NextResponse.json({ success: true });
}
