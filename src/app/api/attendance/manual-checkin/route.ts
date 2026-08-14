// POST /api/attendance/manual-checkin
//
// Lets a teacher (or admin) mark a specific enrolled student present
// without them scanning anything — covers the "student is in class but
// doesn't have a phone" case. Only the class's owning teacher (or an
// admin) can do this; it's not something students can trigger.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface ManualCheckInBody {
  classId: string;
  studentId: string;
  status?: "present" | "late";
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<ManualCheckInBody>;
  const { classId, studentId, status = "present" } = body;

  if (!classId || !studentId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  const { data: klass, error: classError } = await admin
    .from("classes")
    .select("id, teacher_id, status, latitude, longitude")
    .eq("id", classId)
    .single();

  if (classError || !klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const isOwner = klass.teacher_id === user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (klass.status !== "active") {
    return NextResponse.json(
      { error: "This class session is not currently active" },
      { status: 409 }
    );
  }

  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "This student is already checked in." },
      { status: 409 }
    );
  }

  const { error: insertError } = await admin.from("attendance_logs").insert({
    class_id: classId,
    student_id: studentId,
    status,
    latitude: klass.latitude,
    longitude: klass.longitude,
    distance_meters: 0,
    device_fingerprint: `manual-entry-by-${user.id}`,
    qr_token_used: "manual-override",
    is_manual: true,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, status });
}