// POST /api/students/reset-device
//
// Clears a student's locked device_fingerprint so they can check in
// from a new phone. Previously this only worked from the admin
// dashboard (RLS allowed admins to update any user row directly).
// Teachers need it too — a student showing up with a new/replacement
// phone shouldn't have to wait for an admin. This route runs the
// permission check itself and uses the service-role client, so it
// works for teachers without loosening the users table's RLS policies.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface ResetDeviceBody {
  studentId: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<ResetDeviceBody>;
  const { studentId } = body;

  if (!studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
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

  if (profile?.role !== "teacher" && profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();

  const { data: target, error: fetchError } = await admin
    .from("users")
    .select("id, full_name, role")
    .eq("id", studentId)
    .single();

  if (fetchError || !target || target.role !== "student") {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ device_fingerprint: null })
    .eq("id", studentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, studentName: target.full_name });
}
