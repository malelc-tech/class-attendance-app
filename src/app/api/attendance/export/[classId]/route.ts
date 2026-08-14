// GET /api/attendance/export/[classId]
// Streams back a CSV of attendance for a given class session.
// Only the owning teacher or an admin may export.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function toCsvRow(fields: (string | number)[]): string {
  return fields
    .map((f) => {
      const s = String(f);
      // Escape quotes/commas per CSV spec.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: klass } = await supabase
    .from("classes")
    .select("id, title, teacher_id")
    .eq("id", classId)
    .single();

  if (!klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (klass.teacher_id !== user.id && profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: logs, error } = await supabase
    .from("attendance_logs")
    .select("student_id, status, scanned_at, distance_meters, is_manual, closing_scanned_at, users:student_id(full_name, student_id, email)")
    .eq("class_id", classId)
    .order("scanned_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = toCsvRow([
    "Student Name",
    "Student ID",
    "Email",
    "Status",
    "Scanned At",
    "Distance (m)",
    "Manual Entry",
    "Closing Confirmed",
  ]);

  const rows = (logs ?? []).map((log) => {
    // `users` comes back as a joined object per the FK relation.
    const student = (log as any).users;
    return toCsvRow([
      student?.full_name ?? "Unknown",
      student?.student_id ?? "",
      student?.email ?? "",
      log.status,
      new Date(log.scanned_at).toISOString(),
      log.distance_meters,
      log.is_manual ? "Yes" : "No",
      log.is_manual ? "N/A" : log.closing_scanned_at ? "Yes" : "No",
    ]);
  });

  const csv = [header, ...rows].join("\n");
  const filename = `attendance_${klass.title.replace(/\s+/g, "_")}_${classId.slice(0, 8)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
