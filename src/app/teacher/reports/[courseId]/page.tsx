"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface StudentAttendance {
  studentId: string;
  fullName: string;
  studentIdNumber: string | null;
  sessionsAttended: number;
  percentage: number;
}

export default function AttendanceReportPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const supabase = createClient();

  const [courseName, setCourseName] = useState("");
  const [totalSessions, setTotalSessions] = useState(0);
  const [rows, setRows] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"name" | "percentage">("percentage");

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function loadReport() {
    setLoading(true);

    const { data: course } = await supabase
      .from("courses")
      .select("code, title")
      .eq("id", courseId)
      .single();
    if (course) setCourseName(`${course.code} — ${course.title}`);

    // Every class row for this course counts as a session that was
    // actually held (sessions are only created the moment a teacher
    // starts one — there's no "scheduled for later" state in this app).
    const { data: classes } = await supabase
      .from("classes")
      .select("id")
      .eq("course_id", courseId);

    const classIds = (classes ?? []).map((c) => c.id);
    const sessionCount = classIds.length;
    setTotalSessions(sessionCount);

    const { data: enrollments } = await supabase
      .from("course_enrollments")
      .select("users:student_id(id, full_name, student_id)")
      .eq("course_id", courseId);

    const students = (enrollments ?? [])
      .map((e: any) => e.users)
      .filter(Boolean);

    if (sessionCount === 0 || students.length === 0) {
      setRows(
        students.map((s: any) => ({
          studentId: s.id,
          fullName: s.full_name,
          studentIdNumber: s.student_id,
          sessionsAttended: 0,
          percentage: 0,
        }))
      );
      setLoading(false);
      return;
    }

    // Count present/late attendance rows per student across this
    // course's sessions. "rejected" scans don't count as attended.
    const { data: logs } = await supabase
      .from("attendance_logs")
      .select("student_id, status")
      .in("class_id", classIds)
      .in("status", ["present", "late"]);

    const attendedCounts = new Map<string, number>();
    for (const log of logs ?? []) {
      attendedCounts.set(
        log.student_id,
        (attendedCounts.get(log.student_id) ?? 0) + 1
      );
    }

    const computed: StudentAttendance[] = students.map((s: any) => {
      const attended = attendedCounts.get(s.id) ?? 0;
      return {
        studentId: s.id,
        fullName: s.full_name,
        studentIdNumber: s.student_id,
        sessionsAttended: attended,
        percentage: Math.round((attended / sessionCount) * 100),
      };
    });

    setRows(computed);
    setLoading(false);
  }

  const sortedRows = [...rows].sort((a, b) =>
    sortBy === "name"
      ? a.fullName.localeCompare(b.fullName)
      : b.percentage - a.percentage
  );

  function downloadCsv() {
    const header = "Full Name,Student ID,Sessions Attended,Total Sessions,Percentage";
    const lines = sortedRows.map(
      (r) =>
        `"${r.fullName}","${r.studentIdNumber ?? ""}",${r.sessionsAttended},${totalSessions},${r.percentage}%`
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_report_${courseId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function percentageColor(pct: number) {
    if (pct >= 75) return "text-emerald-600";
    if (pct >= 50) return "text-amber-600";
    return "text-red-600";
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Attendance report</h1>
        <p className="mb-6 text-slate-500">{courseName}</p>

        {loading ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Sessions held this semester</p>
                  <p className="text-3xl font-bold text-slate-900">{totalSessions}</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "name" | "percentage")}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="percentage">Sort by percentage</option>
                    <option value="name">Sort by name</option>
                  </select>
                  <button
                    onClick={downloadCsv}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    Export CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              {sortedRows.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No students enrolled in this course yet.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 font-medium">Student</th>
                      <th className="py-2 font-medium">Student ID</th>
                      <th className="py-2 text-right font-medium">Attended</th>
                      <th className="py-2 text-right font-medium">Percentage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.studentId} className="border-b border-slate-50">
                        <td className="py-2 text-slate-800">{r.fullName}</td>
                        <td className="py-2 text-slate-500">{r.studentIdNumber ?? "—"}</td>
                        <td className="py-2 text-right text-slate-600">
                          {r.sessionsAttended} / {totalSessions}
                        </td>
                        <td className={`py-2 text-right font-semibold ${percentageColor(r.percentage)}`}>
                          {r.percentage}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
