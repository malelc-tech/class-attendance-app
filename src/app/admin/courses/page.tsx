"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Teacher {
  id: string;
  full_name: string;
}

interface Course {
  id: string;
  code: string;
  title: string;
  teacher_id: string;
  teacher_name?: string;
}

export default function AdminCoursesPage() {
  const supabase = createClient();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [enrollCourseId, setEnrollCourseId] = useState("");
  const [studentIdsText, setStudentIdsText] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<string | null>(null);

  useEffect(() => {
    loadTeachers();
    loadCourses();
  }, []);

  async function loadTeachers() {
    const { data } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "teacher")
      .order("full_name");
    if (data) {
      setTeachers(data);
      if (data[0]) setSelectedTeacher(data[0].id);
    }
  }

  async function loadCourses() {
    const { data } = await supabase
      .from("courses")
      .select("id, code, title, teacher_id, users:teacher_id(full_name)")
      .order("code");
    if (data) {
      setCourses(
        data.map((c: any) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          teacher_id: c.teacher_id,
          teacher_name: c.users?.full_name,
        }))
      );
      if (data[0]) setEnrollCourseId(data[0].id);
    }
  }

  async function handleCreateCourse(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateMessage(null);

    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, title, teacherId: selectedTeacher }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateMessage(data.error ?? "Failed to create course");
      } else {
        setCreateMessage(`Created ${data.course.code} — ${data.course.title}`);
        setCode("");
        setTitle("");
        await loadCourses();
      }
    } catch {
      setCreateMessage("Network error — please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleBulkEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrolling(true);
    setEnrollMessage(null);

    const studentIds = studentIdsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/courses/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: enrollCourseId, studentIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnrollMessage(data.error ?? "Failed to enroll students");
      } else {
        let msg = `Enrolled ${data.enrolled} student(s).`;
        if (data.notFound.length > 0) {
          msg += ` Not found: ${data.notFound.join(", ")}`;
        }
        setEnrollMessage(msg);
        setStudentIdsText("");
      }
    } catch {
      setEnrollMessage("Network error — please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Manage courses</h1>

        {/* Create course */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Create a course</h2>
          {teachers.length === 0 && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              No lecturer accounts found yet. Create a user and promote them to
              "teacher" first (Manage Users page), then come back here.
            </p>
          )}
          <form onSubmit={handleCreateCourse} className="space-y-4">
            {createMessage && (
              <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
                {createMessage}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Course code
                </label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ME101"
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Mechanical Engineering"
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Lecturer
              </label>
              <select
                value={selectedTeacher}
                onChange={(e) => setSelectedTeacher(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || teachers.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create course"}
            </button>
          </form>
        </section>

        {/* Existing courses */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Existing courses</h2>
          {courses.length === 0 ? (
            <p className="text-sm text-slate-400">No courses yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Title</th>
                  <th className="py-2 font-medium">Lecturer</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50">
                    <td className="py-2 text-slate-800">{c.code}</td>
                    <td className="py-2 text-slate-600">{c.title}</td>
                    <td className="py-2 text-slate-600">{c.teacher_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Bulk enroll */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">
            Enroll students into a course
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Paste student IDs, one per line (e.g. BC/ICT/22/013). Students must
            already have an account — create them first via the bulk-import
            script or Supabase.
          </p>
          <form onSubmit={handleBulkEnroll} className="space-y-4">
            {enrollMessage && (
              <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
                {enrollMessage}
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Course
              </label>
              <select
                value={enrollCourseId}
                onChange={(e) => setEnrollCourseId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Student IDs (one per line)
              </label>
              <textarea
                value={studentIdsText}
                onChange={(e) => setStudentIdsText(e.target.value)}
                rows={8}
                placeholder={"BC/ICT/22/013\nBC/ICT/22/032\nBC/ICT/22/120"}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={enrolling || courses.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {enrolling ? "Enrolling…" : "Enroll students"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
