// POST /api/users/reset-password
// Admin-only: sets a new auto-generated password for any user account.
// Returns the new password once — it isn't stored anywhere afterward.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

interface ResetPasswordBody {
  userId: string;
}

function generatePassword() {
  return randomBytes(6).toString("hex").slice(0, 8);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<ResetPasswordBody>;
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

  const admin = createServiceRoleClient();
  const newPassword = generatePassword();

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, newPassword });
}
