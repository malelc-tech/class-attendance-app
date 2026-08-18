// DELETE /api/courses/[id]
// Admin-only. Refuses to delete a course that still has class sessions
// (and therefore attendance history) attached to it — the course roster
// (course_enrollments) is fine to cascade away, but session/attendance
// data must be explicitly cleared first to avoid silent data loss.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courseId } = await params;

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

  const { data: course, error: courseError } = await admin
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .single();

  if (courseError || !course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Block deletion if any class sessions exist for this course — those
  // carry attendance history that shouldn't disappear silently via
  // cascade. Enrollment rows alone are fine to let cascade-delete.
  const { count: classCount, error: countError } = await admin
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if ((classCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete "${course.code}" — it has ${classCount} class session(s) with attendance history. Delete those sessions first.`,
      },
      { status: 409 }
    );
  }

  const { error: deleteError } = await admin
    .from("courses")
    .delete()
    .eq("id", courseId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
