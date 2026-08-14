// POST /api/courses/enroll
// Admin, or the course's own teacher, bulk-enrolls existing students
// (already created via the bulk-import script or Supabase directly)
// into a course by their school student ID — not their name, since
// names can collide but student IDs shouldn't.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

interface EnrollBody {
  courseId: string;
  studentIds: string[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<EnrollBody>;
  const { courseId, studentIds } = body;

  if (!courseId || !Array.isArray(studentIds) || studentIds.length === 0) {
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

  const { data: course } = await admin
    .from("courses")
    .select("id, teacher_id")
    .eq("id", courseId)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const isOwner = course.teacher_id === user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cleanIds = studentIds.map((s) => s.trim()).filter(Boolean);

  const { data: matchedStudents } = await admin
    .from("users")
    .select("id, student_id, full_name")
    .in("student_id", cleanIds)
    .eq("role", "student");

  const foundIds = new Set((matchedStudents ?? []).map((s) => s.student_id));
  const notFound = cleanIds.filter((id) => !foundIds.has(id));

  if (matchedStudents && matchedStudents.length > 0) {
    const rows = matchedStudents.map((s) => ({
      course_id: courseId,
      student_id: s.id,
    }));
    const { error: insertError } = await admin
      .from("course_enrollments")
      .upsert(rows, { onConflict: "course_id,student_id" });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    enrolled: matchedStudents?.length ?? 0,
    notFound,
  });
}
