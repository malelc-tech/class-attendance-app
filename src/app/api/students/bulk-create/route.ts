// POST /api/students/bulk-create
// Admin-only: creates many student accounts at once from {fullName,
// studentId} pairs (typically parsed from an uploaded Excel/CSV file).
// Both email and password are fully auto-generated — the admin never
// types either. Optionally enrolls each new student into a course in
// the same request. Returns every student's generated credentials so
// they can be downloaded/printed once, since passwords are never
// stored in plain text after this response.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

interface StudentInput {
  fullName: string;
  studentId: string;
}

interface BulkCreateBody {
  students: StudentInput[];
  courseId?: string;
}

function emailFromStudentId(studentId: string) {
  const slug = studentId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}@students.local`;
}

function generatePassword() {
  return randomBytes(6).toString("hex").slice(0, 8);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<BulkCreateBody>;
  const { students, courseId } = body;

  if (!students || !Array.isArray(students) || students.length === 0) {
    return NextResponse.json({ error: "No students provided" }, { status: 400 });
  }
  if (students.length > 1000) {
    return NextResponse.json(
      { error: "Please upload 1000 students or fewer per batch." },
      { status: 400 }
    );
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
  const results: Array<{
    fullName: string;
    studentId: string;
    email: string;
    password: string;
    status: "created" | "skipped" | "failed";
    message?: string;
  }> = [];

  for (const { fullName, studentId } of students) {
    if (!fullName || !studentId) continue;

    const email = emailFromStudentId(studentId);
    const password = generatePassword();

    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: "student" },
    });

    if (createError) {
      const alreadyExists = createError.message?.toLowerCase().includes("already registered");
      results.push({
        fullName,
        studentId,
        email,
        password: "",
        status: alreadyExists ? "skipped" : "failed",
        message: createError.message,
      });
      continue;
    }

    await admin
      .from("users")
      .update({ full_name: fullName, student_id: studentId })
      .eq("id", newUser.user.id);

    if (courseId) {
      await admin
        .from("course_enrollments")
        .upsert(
          { course_id: courseId, student_id: newUser.user.id },
          { onConflict: "course_id,student_id" }
        );
    }

    results.push({ fullName, studentId, email, password, status: "created" });
  }

  return NextResponse.json({
    success: true,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
