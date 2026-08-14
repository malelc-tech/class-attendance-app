// POST /api/courses
// Admin-only: creates a new course and assigns it to a lecturer.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface CreateCourseBody {
  code: string;
  title: string;
  teacherId: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<CreateCourseBody>;
  const { code, title, teacherId } = body;

  if (!code || !title || !teacherId) {
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

  const { data: teacher, error: teacherError } = await admin
    .from("users")
    .select("id, role")
    .eq("id", teacherId)
    .single();

  if (teacherError || !teacher || teacher.role !== "teacher") {
    return NextResponse.json({ error: "Selected lecturer not found" }, { status: 404 });
  }

  const { data: course, error: insertError } = await admin
    .from("courses")
    .insert({ code, title, teacher_id: teacherId })
    .select("id, code, title")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, course });
}
