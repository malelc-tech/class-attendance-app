// POST /api/teachers/create
// Admin-only: creates a lecturer login. Email is admin-supplied (so the
// lecturer has a real, memorable login), password is auto-generated and
// returned once in the response — it is never stored in plain text
// anywhere, so make sure to hand it to the lecturer right away.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

interface CreateTeacherBody {
  fullName: string;
  email: string;
}

function generatePassword() {
  return randomBytes(6).toString("hex").slice(0, 8);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<CreateTeacherBody>;
  const { fullName, email } = body;

  if (!fullName || !email) {
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
  const password = generatePassword();

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "teacher" },
  });

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    fullName,
    email,
    password,
  });
}
