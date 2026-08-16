"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import QRCode from "react-qr-code";
import { createClient } from "@/lib/supabase/client";
import { ROTATE_SECONDS } from "@/lib/utils/qr-token";

interface AttendanceRow {
  id: string;
  student_id: string;
  status: "present" | "late" | "rejected";
  scanned_at: string;
  distance_meters: number;
  is_manual?: boolean;
  closing_scanned_at?: string | null;
  student_name?: string;
}

interface EnrolledStudent {
  id: string;
  full_name: string;
  device_fingerprint: string | null;
}

export default function TeacherSessionPage() {
  const params = useParams<{ id: string }>();
  const classId = params.id;
  const supabase = createClient();

  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROTATE_SECONDS);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [enrolled, setEnrolled] = useState<EnrolledStudent[]>([]);
  const [classTitle, setClassTitle] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingSearch, setMissingSearch] = useState("");
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [closingWindowStartedAt, setClosingWindowStartedAt] = useState<string | null>(null);
  const [initialWindowEndedAt, setInitialWindowEndedAt] = useState<string | null>(null);
  const [closingWindowEndedAt, setClosingWindowEndedAt] = useState<string | null>(null);
  const [startingClosingWindow, setStartingClosingWindow] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Fetch the current rotating QR token from the server --------------
  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/qr-token/${classId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Failed to load QR token");
        return;
      }
      setLoadError(null);
      setQrPayload(data.qrPayload);
      setSecondsLeft(Math.ceil(data.expiresInMs / 1000));
    } catch {
      setLoadError("Network error fetching QR token");
    }
  }, [classId]);

  useEffect(() => {
    fetchToken();
    pollTimer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          fetchToken();
          return ROTATE_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [fetchToken]);

  // --- Load class + course + enrolled students + existing attendance ----
  useEffect(() => {
    // The channel is created and subscribed synchronously, right here,
    // BEFORE any of the async data-loading below. This guarantees the
    // cleanup function below always has a real channel to remove — if
    // channel creation were buried inside the async work, React's dev
    // mode (which runs effects twice to catch bugs) could leave an
    // orphaned subscription behind, causing "cannot add postgres_changes
    // callbacks after subscribe()" errors.
    const channel = supabase
      .channel(`attendance-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance_logs",
          filter: `class_id=eq.${classId}`,
        },
        async (payload) => {
          const row = payload.new as AttendanceRow;
          const { data: student } = await supabase
            .from("users")
            .select("full_name")
            .eq("id", row.student_id)
            .single();

          setAttendance((prev) => [
            { ...row, student_name: student?.full_name },
            ...prev,
          ]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "attendance_logs",
          filter: `class_id=eq.${classId}`,
        },
        (payload) => {
          // Picks up closing_scanned_at reconfirmations live.
          const row = payload.new as AttendanceRow;
          setAttendance((prev) =>
            prev.map((a) =>
              a.id === row.id ? { ...a, closing_scanned_at: row.closing_scanned_at } : a
            )
          );
        }
      )
      .subscribe();

    (async () => {
      const { data: klass } = await supabase
        .from("classes")
        .select("title, course_id, status, closing_window_started_at, initial_window_ended_at, closing_window_ended_at")
        .eq("id", classId)
        .single();
      if (klass) {
        setClassTitle(klass.title);
        setClosingWindowStartedAt(klass.closing_window_started_at);
        setInitialWindowEndedAt(klass.initial_window_ended_at);
        setClosingWindowEndedAt(klass.closing_window_ended_at);
        setSessionEnded(klass.status === "closed");
      }

      if (klass?.course_id) {
        const { data: enrollments } = await supabase
          .from("course_enrollments")
          .select("users:student_id(id, full_name, device_fingerprint)")
          .eq("course_id", klass.course_id);

        if (enrollments) {
          setEnrolled(
            enrollments
              .map((e: any) => e.users)
              .filter(Boolean)
              .sort((a: EnrolledStudent, b: EnrolledStudent) =>
                a.full_name.localeCompare(b.full_name)
              )
          );
        }
      }

      const { data: existing } = await supabase
        .from("attendance_logs")
        .select(
          "id, student_id, status, scanned_at, distance_meters, is_manual, closing_scanned_at, users:student_id(full_name)"
        )
        .eq("class_id", classId)
        .order("scanned_at", { ascending: false });

      if (existing) {
        setAttendance(
          existing.map((row: any) => ({
            id: row.id,
            student_id: row.student_id,
            status: row.status,
            scanned_at: row.scanned_at,
            distance_meters: row.distance_meters,
            is_manual: row.is_manual,
            closing_scanned_at: row.closing_scanned_at,
            student_name: row.users?.full_name,
          }))
        );
      }
    })();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId, supabase]);

  // The QR should only be shown while a scan is actually meaningful:
  // during the initial window (before the teacher ends it), or during
  // an active closing-check-in window. Between those, or once the
  // session is fully ended, there's nothing for students to scan for.
  const isScanningActive =
    !sessionEnded &&
    (!initialWindowEndedAt || (!!closingWindowStartedAt && !closingWindowEndedAt));

  const presentCount = attendance.filter((a) => a.status === "present").length;
  const lateCount = attendance.filter((a) => a.status === "late").length;
  const rejectedCount = attendance.filter((a) => a.status === "rejected").length;

  // Students enrolled in the course but with no attendance row yet.
  const missingStudents = useMemo(() => {
    const checkedInIds = new Set(attendance.map((a) => a.student_id));
    return enrolled
      .filter((s) => !checkedInIds.has(s.id))
      .filter((s) =>
        s.full_name.toLowerCase().includes(missingSearch.toLowerCase())
      );
  }, [enrolled, attendance, missingSearch]);

  // Checked in at the start, but haven't rescanned since the closing
  // window opened, and weren't a manual (no-phone) entry.
  const leftEarlyCandidates = useMemo(() => {
    if (!closingWindowStartedAt) return [];
    return attendance.filter(
      (a) =>
        (a.status === "present" || a.status === "late") &&
        !a.is_manual &&
        !a.closing_scanned_at
    );
  }, [attendance, closingWindowStartedAt]);

  async function startClosingWindow() {
    const confirmed = window.confirm(
      "Start the closing check-in now? Tell students to scan the QR one more time in the next few minutes — anyone who doesn't will be flagged as possibly having left early."
    );
    if (!confirmed) return;

    setStartingClosingWindow(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("classes")
      .update({ closing_window_started_at: now })
      .eq("id", classId);

    if (error) {
      setActionMessage(error.message);
    } else {
      setClosingWindowStartedAt(now);
      setActionMessage(
        "Closing check-in started — ask students to scan the QR again before class ends."
      );
    }
    setStartingClosingWindow(false);
  }

  async function endInitialWindow() {
    const confirmed = window.confirm(
      "End the first check-in window? Students who haven't checked in yet will no longer be able to — you can still mark them present manually if needed."
    );
    if (!confirmed) return;

    setStartingClosingWindow(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("classes")
      .update({ initial_window_ended_at: now })
      .eq("id", classId);

    if (error) {
      setActionMessage(error.message);
    } else {
      setInitialWindowEndedAt(now);
      setActionMessage("First check-in window ended.");
    }
    setStartingClosingWindow(false);
  }

  async function endClosingWindowFn() {
    const confirmed = window.confirm(
      "End the closing check-in window? Students will no longer be able to submit the second (still-here) scan."
    );
    if (!confirmed) return;

    setStartingClosingWindow(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("classes")
      .update({ closing_window_ended_at: now })
      .eq("id", classId);

    if (error) {
      setActionMessage(error.message);
    } else {
      setClosingWindowEndedAt(now);
      setActionMessage("Closing check-in window ended.");
    }
    setStartingClosingWindow(false);
  }

  async function endSession() {
    const confirmed = window.confirm(
      "End this class session completely? This closes it permanently — no more scans of any kind will be accepted, and this can't be undone."
    );
    if (!confirmed) return;

    setStartingClosingWindow(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("classes")
      .update({
        status: "closed",
        initial_window_ended_at: initialWindowEndedAt ?? now,
        closing_window_ended_at: closingWindowEndedAt ?? now,
      })
      .eq("id", classId);

    if (error) {
      setActionMessage(error.message);
    } else {
      setInitialWindowEndedAt((prev) => prev ?? now);
      setClosingWindowEndedAt((prev) => prev ?? now);
      setSessionEnded(true);
      setActionMessage("Class session ended.");
    }
    setStartingClosingWindow(false);
  }

  async function markPresentManually(studentId: string) {
    setBusyStudentId(studentId);
    setActionMessage(null);
    try {
      const res = await fetch("/api/attendance/manual-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, studentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMessage(data.error ?? "Failed to mark present");
      }
      // Realtime subscription above will pick up the new row and move
      // this student out of the "missing" list automatically.
    } catch {
      setActionMessage("Network error — please try again.");
    } finally {
      setBusyStudentId(null);
    }
  }

  async function resetStudentDevice(studentId: string, name: string) {
    const confirmed = window.confirm(
      `Reset ${name}'s registered device? They'll be able to check in from a new phone next time.`
    );
    if (!confirmed) return;

    setBusyStudentId(studentId);
    setActionMessage(null);
    try {
      const res = await fetch("/api/students/reset-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMessage(data.error ?? "Failed to reset device");
      } else {
        setActionMessage(`${name}'s device was reset.`);
        setEnrolled((prev) =>
          prev.map((s) =>
            s.id === studentId ? { ...s, device_fingerprint: null } : s
          )
        );
      }
    } catch {
      setActionMessage("Network error — please try again.");
    } finally {
      setBusyStudentId(null);
    }
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{classTitle || "Class Session"}</h1>
          <p className="text-slate-500">Live session — QR refreshes every {ROTATE_SECONDS}s</p>
        </header>

        {actionMessage && (
          <p className="mb-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
            {actionMessage}
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* QR Code panel */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Scan to check in</h2>
            {loadError && (
              <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{loadError}</p>
            )}
            <div className="flex flex-col items-center gap-4">
              {!isScanningActive ? (
                <div className="flex h-[252px] w-[252px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400">
                  <span className="text-3xl">🚫</span>
                  <span>
                    {sessionEnded
                      ? "Session ended — no QR to scan."
                      : "Not currently accepting scans."}
                  </span>
                </div>
              ) : qrPayload ? (
                <div className="rounded-xl border border-slate-200 p-4">
                  <QRCode value={qrPayload} size={220} />
                </div>
              ) : (
                <div className="flex h-[252px] w-[252px] items-center justify-center text-slate-400">
                  Loading QR…
                </div>
              )}
              {isScanningActive && (
                <>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <span>Refreshing in</span>
                    <span className="w-6 font-mono font-semibold text-slate-900">
                      {secondsLeft}
                    </span>
                    <span>s</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-1000 ease-linear"
                      style={{ width: `${(secondsLeft / ROTATE_SECONDS) * 100}%` }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="w-full border-t border-slate-100 pt-4">
              {initialWindowEndedAt ? (
                <p className="text-center text-sm text-slate-500">
                  🔒 First check-in ended at{" "}
                  {new Date(initialWindowEndedAt).toLocaleTimeString()}
                </p>
              ) : (
                  <button
                    onClick={endInitialWindow}
                    disabled={startingClosingWindow}
                    className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    🔒 End first check-in
                  </button>
                )}
                <p className="mt-1 text-center text-xs text-slate-400">
                  Stops new students from checking in for the first time.
                  Students already checked in are unaffected.
                </p>
              </div>

              <div className="w-full border-t border-slate-100 pt-4">
                {closingWindowEndedAt ? (
                  <p className="text-center text-sm text-slate-500">
                    🔒 Closing check-in ended at{" "}
                    {new Date(closingWindowEndedAt).toLocaleTimeString()}
                  </p>
                ) : closingWindowStartedAt ? (
                  <>
                    <p className="mb-2 text-center text-sm text-emerald-600">
                      ✅ Closing check-in active since{" "}
                      {new Date(closingWindowStartedAt).toLocaleTimeString()} —
                      ask students to scan once more before class ends.
                    </p>
                    <button
                      onClick={endClosingWindowFn}
                      disabled={startingClosingWindow}
                      className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      🔒 End closing check-in
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startClosingWindow}
                    disabled={startingClosingWindow}
                    className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {startingClosingWindow ? "Starting…" : "🚪 Start closing check-in"}
                  </button>
                )}
                <p className="mt-1 text-center text-xs text-slate-400">
                  Use this near the end of class — a second scan confirms students
                  are still present, without any background location tracking.
                </p>
              </div>

              <div className="w-full border-t border-slate-100 pt-4">
                {sessionEnded ? (
                  <p className="text-center text-sm font-medium text-red-600">
                    🔴 This session has ended.
                  </p>
                ) : (
                  <button
                    onClick={endSession}
                    disabled={startingClosingWindow}
                    className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    🔴 End class session
                  </button>
                )}
                <p className="mt-1 text-center text-xs text-slate-400">
                  Permanently closes this session — no more scans of any kind,
                  can't be undone.
                </p>
              </div>
          </section>

          {/* Live counters + feed */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Live attendance</h2>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat label="Present" value={presentCount} color="bg-emerald-50 text-emerald-700" />
              <Stat label="Late" value={lateCount} color="bg-amber-50 text-amber-700" />
              <Stat label="Rejected" value={rejectedCount} color="bg-red-50 text-red-700" />
            </div>

            <a
              href={`/api/attendance/export/${classId}`}
              className="mb-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Export CSV
            </a>

            {closingWindowStartedAt && leftEarlyCandidates.length > 0 && (
              <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                ⚠️ {leftEarlyCandidates.length} student
                {leftEarlyCandidates.length === 1 ? "" : "s"} checked in but
                {leftEarlyCandidates.length === 1 ? " hasn't" : " haven't"} rescanned
                since the closing check-in started — may have left early.
              </p>
            )}

            <div className="max-h-96 space-y-2 overflow-y-auto">
              {attendance.length === 0 && (
                <p className="text-sm text-slate-400">No check-ins yet.</p>
              )}
              {attendance.map((a) => {
                const mayHaveLeftEarly =
                  closingWindowStartedAt &&
                  (a.status === "present" || a.status === "late") &&
                  !a.is_manual &&
                  !a.closing_scanned_at;

                return (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      mayHaveLeftEarly
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-100"
                    }`}
                  >
                    <span className="font-medium text-slate-800">
                      {a.student_name ?? a.student_id.slice(0, 8)}
                      {a.is_manual && (
                        <span className="ml-1 text-xs font-normal text-slate-400">(manual)</span>
                      )}
                      {a.closing_scanned_at && (
                        <span className="ml-1 text-xs font-normal text-emerald-600">✓ confirmed</span>
                      )}
                      {mayHaveLeftEarly && (
                        <span className="ml-1 text-xs font-normal text-amber-600">may have left early</span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 text-slate-500">
                      {!a.is_manual && <span>{Math.round(a.distance_meters)}m</span>}
                      <StatusBadge status={a.status} />
                      <span>{new Date(a.scanned_at).toLocaleTimeString()}</span>
                      <button
                        onClick={() => resetStudentDevice(a.student_id, a.student_name ?? "this student")}
                        disabled={busyStudentId === a.student_id}
                        className="text-xs text-slate-400 underline hover:text-slate-600 disabled:opacity-50"
                        title="Reset their locked device"
                      >
                        reset device
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Not yet checked in */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                Not checked in{" "}
                <span className="text-sm font-normal text-slate-400">
                  ({missingStudents.length})
                </span>
              </h2>
            </div>

            {enrolled.length === 0 ? (
              <p className="text-sm text-slate-400">
                No students are enrolled in this course yet, so there's nothing to
                compare against. Enroll students via Supabase (course_enrollments
                table) to see who's missing here.
              </p>
            ) : (
              <>
                <input
                  value={missingSearch}
                  onChange={(e) => setMissingSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {missingStudents.length === 0 && (
                    <p className="text-sm text-slate-400">
                      {enrolled.length === attendance.length
                        ? "Everyone's checked in! 🎉"
                        : "No matches."}
                    </p>
                  )}
                  {missingStudents.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-800">{s.full_name}</span>
                      <button
                        onClick={() => markPresentManually(s.id)}
                        disabled={busyStudentId === s.id}
                        className="rounded-lg bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        title="Mark present without a phone scan"
                      >
                        {busyStudentId === s.id ? "…" : "Mark present"}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl p-3 text-center ${color}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: AttendanceRow["status"] }) {
  const styles: Record<AttendanceRow["status"], string> = {
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
