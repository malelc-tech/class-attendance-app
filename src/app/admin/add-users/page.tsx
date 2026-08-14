"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

interface Course {
  id: string;
  code: string;
  title: string;
}

interface StudentResult {
  fullName: string;
  studentId: string;
  email: string;
  password: string;
  status: "created" | "skipped" | "failed";
  message?: string;
}

export default function AdminAddUsersPage() {
  const supabase = createClient();

  // --- Lecturer form ------------------------------------------------
  const [teacherName, setTeacherName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [teacherResult, setTeacherResult] = useState<{ email: string; password: string } | null>(null);
  const [teacherError, setTeacherError] = useState<string | null>(null);

  // --- Student bulk upload -------------------------------------------
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [parsedStudents, setParsedStudents] = useState<{ fullName: string; studentId: string }[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<StudentResult[] | null>(null);
  const [summary, setSummary] = useState<{ created: number; skipped: number; failed: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("courses").select("id, code, title").order("code");
      if (data) {
        setCourses(data);
      }
    })();
  }, []);

  async function handleCreateTeacher(e: React.FormEvent) {
    e.preventDefault();
    setCreatingTeacher(true);
    setTeacherError(null);
    setTeacherResult(null);

    try {
      const res = await fetch("/api/teachers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: teacherName, email: teacherEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeacherError(data.error ?? "Failed to create lecturer");
      } else {
        setTeacherResult({ email: data.email, password: data.password });
        setTeacherName("");
        setTeacherEmail("");
      }
    } catch {
      setTeacherError("Network error — please try again.");
    } finally {
      setCreatingTeacher(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setResults(null);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        // Skip a header row if the first cell looks like a label rather
        // than an actual name (e.g. "Full Name", "Name").
        const dataRows =
          rows.length > 0 &&
          typeof rows[0][0] === "string" &&
          /name/i.test(rows[0][0])
            ? rows.slice(1)
            : rows;

        const students = dataRows
          .map((row) => ({
            fullName: String(row[0] ?? "").trim(),
            studentId: String(row[1] ?? "").trim(),
          }))
          .filter((s) => s.fullName && s.studentId);

        if (students.length === 0) {
          setParseError(
            "No valid rows found. Make sure column A has full names and column B has student IDs."
          );
        }
        setParsedStudents(students);
      } catch {
        setParseError("Couldn't read that file. Make sure it's a valid .xlsx or .csv file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleBulkUpload() {
    if (parsedStudents.length === 0) return;
    setUploading(true);
    setResults(null);
    setSummary(null);

    try {
      const res = await fetch("/api/students/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          students: parsedStudents,
          courseId: selectedCourse || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? "Upload failed");
      } else {
        setResults(data.results);
        setSummary({ created: data.created, skipped: data.skipped, failed: data.failed });
      }
    } catch {
      setParseError("Network error — please try again.");
    } finally {
      setUploading(false);
    }
  }

  function downloadCredentialsCsv() {
    if (!results) return;
    const header = "Full Name,Student ID,Email,Password,Status";
    const lines = results.map(
      (r) => `"${r.fullName}","${r.studentId}","${r.email}","${r.password}","${r.status}"`
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student_credentials.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Add lecturers & students</h1>

        {/* Add lecturer */}
        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Add a lecturer</h2>
          <p className="mb-4 text-sm text-slate-500">Password is generated automatically.</p>

          <form onSubmit={handleCreateTeacher} className="space-y-4">
            {teacherError && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{teacherError}</p>
            )}
            {teacherResult && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Created! Email: <strong>{teacherResult.email}</strong> · Password:{" "}
                <strong>{teacherResult.password}</strong>
                <br />
                <span className="text-xs">Save this now — the password won't be shown again.</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
                <input
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={creatingTeacher}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {creatingTeacher ? "Creating…" : "Create lecturer"}
            </button>
          </form>
        </section>

        {/* Bulk add students */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Add students from Excel</h2>
          <p className="mb-4 text-sm text-slate-500">
            Upload a .xlsx or .csv file — column A: full name, column B: student ID. A
            header row is fine, it's detected and skipped automatically. Email and
            password are generated for every student.
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Enroll into course (optional)
              </label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Don't enroll — just create accounts</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Upload file
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              {fileName && (
                <p className="mt-1 text-xs text-slate-400">
                  {fileName} — {parsedStudents.length} student(s) detected
                </p>
              )}
              {parseError && (
                <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">{parseError}</p>
              )}
            </div>

            <button
              onClick={handleBulkUpload}
              disabled={uploading || parsedStudents.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {uploading ? "Creating accounts…" : `Create ${parsedStudents.length || ""} student account(s)`}
            </button>

            {summary && (
              <div className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
                Created: {summary.created} · Skipped (already existed): {summary.skipped} · Failed: {summary.failed}
              </div>
            )}

            {results && results.length > 0 && (
              <div>
                <button
                  onClick={downloadCredentialsCsv}
                  className="mb-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Download credentials (CSV)
                </button>
                <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="p-2 font-medium">Name</th>
                        <th className="p-2 font-medium">Student ID</th>
                        <th className="p-2 font-medium">Email</th>
                        <th className="p-2 font-medium">Password</th>
                        <th className="p-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2">{r.fullName}</td>
                          <td className="p-2">{r.studentId}</td>
                          <td className="p-2">{r.email}</td>
                          <td className="p-2">{r.password || "—"}</td>
                          <td className="p-2">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
