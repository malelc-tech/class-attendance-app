"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface HistoryRow {
  id: string;
  status: "present" | "late" | "rejected";
  scanned_at: string;
  class_title: string;
  course_code: string;
}

export default function StudentHistoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("attendance_logs")
        .select(
          "id, status, scanned_at, classes:class_id(title, courses:course_id(code))"
        )
        .eq("student_id", user.id)
        .order("scanned_at", { ascending: false });

      if (data) {
        setRows(
          data.map((r: any) => ({
            id: r.id,
            status: r.status,
            scanned_at: r.scanned_at,
            class_title: r.classes?.title ?? "Unknown session",
            course_code: r.classes?.courses?.code ?? "",
          }))
        );
      }
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">My attendance</h1>

        {loading && <p className="text-slate-500">Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-slate-500">No attendance records yet.</p>
        )}

        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm"
            >
              <div>
                <p className="font-medium text-slate-800">{r.class_title}</p>
                <p className="text-xs text-slate-400">{r.course_code}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} />
                <span className="text-xs text-slate-400">
                  {new Date(r.scanned_at).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryRow["status"] }) {
  const styles: Record<HistoryRow["status"], string> = {
    present: "bg-emerald-100 text-emerald-700",
    late: "bg-amber-100 text-amber-700",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
