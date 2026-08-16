// POST /api/users/delete
// Admin-only: permanently deletes a user account. Cascades automatically
// remove their enrollments and attendance history (see schema.sql's
// "on delete cascade" foreign keys) — this cannot be undone.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface DeleteUserBody {
  userId: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<DeleteUserBody>;
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
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

  if (userId === user.id) {
    return NextResponse.json(
      { error: "You can't delete your own account from here." },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
