"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: "student" | "teacher" | "admin";
  device_fingerprint: string | null;
}

interface Analytics {
  totalStudents: number;
  totalTeachers: number;
  totalCourses: number;
  totalCheckIns: number;
  rejectedCheckIns: number;
}

export default function AdminDashboardPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUsers() {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email, role, device_fingerprint")
      .order("full_name");
    if (data) setUsers(data as UserRow[]);
  }

  async function loadAnalytics() {
    const [{ count: totalStudents }, { count: totalTeachers }, { count: totalCourses }, { count: totalCheckIns }, { count: rejectedCheckIns }] =
      await Promise.all([
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "student"),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
        supabase.from("courses").select("id", { count: "exact", head: true }),
        supabase.from("attendance_logs").select("id", { count: "exact", head: true }),
        supabase
          .from("attendance_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "rejected"),
      ]);

    setAnalytics({
      totalStudents: totalStudents ?? 0,
      totalTeachers: totalTeachers ?? 0,
      totalCourses: totalCourses ?? 0,
      totalCheckIns: totalCheckIns ?? 0,
      rejectedCheckIns: rejectedCheckIns ?? 0,
    });
  }

  async function changeRole(userId: string, role: UserRow["role"]) {
    setSavingId(userId);
    await fetch("/api/users/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    await loadUsers();
    setSavingId(null);
  }

  async function resetDevice(userId: string, name: string) {
    const confirmed = window.confirm(
      `Reset ${name}'s registered device? They'll be able to check in from a new phone next time.`
    );
    if (!confirmed) return;

    setSavingId(userId);
    await supabase.from("users").update({ device_fingerprint: null }).eq("id", userId);
    await loadUsers();
    setSavingId(null);
  }

  async function resetPassword(userId: string, name: string) {
    const confirmed = window.confirm(`Reset ${name}'s password to a new random one?`);
    if (!confirmed) return;

    setSavingId(userId);
    setActionMessage(null);
    try {
      const res = await fetch("/api/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMessage(data.error ?? "Failed to reset password");
      } else {
        setActionMessage(`${name}'s new password: ${data.newPassword} — save this now, it won't be shown again.`);
      }
    } catch {
      setActionMessage("Network error — please try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteUser(userId: string, name: string) {
    const confirmed = window.confirm(
      `Permanently delete ${name}'s account? This removes their enrollments and attendance history too, and can't be undone.`
    );
    if (!confirmed) return;

    setSavingId(userId);
    setActionMessage(null);
    try {
      const res = await fetch("/api/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMessage(data.error ?? "Failed to delete user");
      } else {
        setActionMessage(`${name}'s account was deleted.`);
        await loadUsers();
      }
    } catch {
      setActionMessage("Network error — please try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Admin dashboard</h1>
          <div className="flex flex-wrap gap-2">
            <a
              href="/admin/my-account"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              My account
            </a>
            <a
              href="/admin/billing"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >
              Billing
            </a>
            <a
              href="/admin/add-users"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Add lecturers & students
            </a>
            <a
              href="/admin/courses"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Manage courses
            </a>
          </div>
        </div>

        {actionMessage && (
          <p className="mb-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
            {actionMessage}
          </p>
        )}

        {analytics && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Students" value={analytics.totalStudents} />
            <Stat label="Teachers" value={analytics.totalTeachers} />
            <Stat label="Courses" value={analytics.totalCourses} />
            <Stat label="Check-ins" value={analytics.totalCheckIns} />
            <Stat label="Rejected" value={analytics.rejectedCheckIns} accent />
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Manage users</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Device</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-800">{u.full_name}</td>
                  <td className="py-2 text-slate-500">{u.email}</td>
                  <td className="py-2">
                    <select
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) =>
                        changeRole(u.id, e.target.value as UserRow["role"])
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2">
                    {u.device_fingerprint ? (
                      <button
                        onClick={() => resetDevice(u.id, u.full_name)}
                        disabled={savingId === u.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        title={u.device_fingerprint}
                      >
                        🔒 Locked — Reset
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Not set</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => resetPassword(u.id, u.full_name)}
                        disabled={savingId === u.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      <button
                        onClick={() => deleteUser(u.id, u.full_name)}
                        disabled={savingId === u.id}
                        className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-4 text-center shadow-sm ${accent ? "bg-red-50 text-red-700" : "bg-white text-slate-800"}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}
