"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CourseBreakdown {
  code: string;
  title: string;
  teacherName: string;
  enrolledCount: number;
}

export default function AdminBillingPage() {
  const supabase = createClient();

  const [billableStudents, setBillableStudents] = useState<number | null>(null);
  const [totalTeachers, setTotalTeachers] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<CourseBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string>("");

  useEffect(() => {
    loadBillingData();
  }, []);

  async function loadBillingData() {
    setLoading(true);

    // The billable count: every account with role='student' counts
    // exactly once, no matter how many courses they're enrolled in —
    // enrollment is a separate join table (course_enrollments), so a
    // student in 3 classes still only has 1 row here.
    const { count: studentCount } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "student");

    const { count: teacherCount } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "teacher");

    // Per-course breakdown — these numbers CAN overlap (a student in
    // two courses is counted in both rows below), which is exactly why
    // the top billable number above is calculated separately from
    // unique accounts, not by summing this table.
    const { data: courses } = await supabase
      .from("courses")
      .select("code, title, users:teacher_id(full_name), course_enrollments(count)")
      .order("code");

    if (courses) {
      setBreakdown(
        (courses as any[]).map((c) => ({
          code: c.code,
          title: c.title,
          teacherName: c.users?.full_name ?? "—",
          enrolledCount: c.course_enrollments?.[0]?.count ?? 0,
        }))
      );
    }

    setBillableStudents(studentCount ?? 0);
    setTotalTeachers(teacherCount ?? 0);
    setAsOf(new Date().toLocaleString());
    setLoading(false);
  }

  const sumOfEnrollments = breakdown.reduce((sum, c) => sum + c.enrolledCount, 0);

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Billing overview</h1>
          <button
            onClick={loadBillingData}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <>
            {/* The headline billing number */}
            <div className="mb-6 rounded-2xl bg-indigo-600 p-8 text-center text-white shadow-sm">
              <p className="text-sm uppercase tracking-wide text-indigo-200">
                Billable students (unique accounts)
              </p>
              <p className="mt-2 text-5xl font-bold">{billableStudents}</p>
              <p className="mt-3 text-sm text-indigo-100">
                Each student counts once, regardless of how many classes
                they're enrolled in.
              </p>
              <p className="mt-4 text-xs text-indigo-200">As of {asOf}</p>
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-slate-800">{totalTeachers}</div>
                <div className="text-xs text-slate-400">Lecturer accounts</div>
              </div>
              <div className="rounded-xl bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-slate-800">{breakdown.length}</div>
                <div className="text-xs text-slate-400">Active courses</div>
              </div>
            </div>

            {/* Per-course breakdown, with an explicit note about overlap */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold text-slate-800">
                Enrollment by course
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                These numbers can add up to more than the billable total above
                — that's expected whenever a student takes more than one
                course. The billable figure at the top already accounts for
                that overlap.
              </p>

              {breakdown.length === 0 ? (
                <p className="text-sm text-slate-400">No courses yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400">
                      <th className="py-2 font-medium">Course</th>
                      <th className="py-2 font-medium">Lecturer</th>
                      <th className="py-2 text-right font-medium">Enrolled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((c) => (
                      <tr key={c.code} className="border-b border-slate-50">
                        <td className="py-2 text-slate-800">
                          {c.code} — {c.title}
                        </td>
                        <td className="py-2 text-slate-600">{c.teacherName}</td>
                        <td className="py-2 text-right text-slate-800">
                          {c.enrolledCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 font-medium text-slate-700">
                      <td className="py-2" colSpan={2}>
                        Sum across all courses (with overlap)
                      </td>
                      <td className="py-2 text-right">{sumOfEnrollments}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
