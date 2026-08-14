"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Course {
  id: string;
  code: string;
  title: string;
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [radius, setRadius] = useState(60);
  const [lateAfter, setLateAfter] = useState(10);
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("courses").select("id, code, title");
      if (data) {
        setCourses(data);
        if (data[0]) setSelectedCourse(data[0].id);
      }
    })();
  }, [supabase]);

  function captureClassroomLocation() {
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Allow location access and retry.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function handleStartSession() {
    if (!coords) {
      setError("Capture the classroom location first.");
      return;
    }
    setCreating(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in.");
      setCreating(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("classes")
      .insert({
        course_id: selectedCourse,
        teacher_id: user.id,
        title: sessionTitle || "Untitled Session",
        status: "active",
        latitude: coords.lat,
        longitude: coords.lng,
        allowed_radius_meters: radius,
        late_after_minutes: lateAfter,
        starts_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "Failed to create session");
      setCreating(false);
      return;
    }

    router.push(`/teacher/session/${data.id}`);
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Start a class session</h1>

        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Course</label>
            <select
              value={selectedCourse}
              onChange={(e) => setSelectedCourse(e.target.value)}
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
              Session title
            </label>
            <input
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="e.g. Lecture 5 - Arrays"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Radius (m)
              </label>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Late after (min)
              </label>
              <input
                type="number"
                value={lateAfter}
                onChange={(e) => setLateAfter(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={captureClassroomLocation}
              disabled={locating}
              className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {locating
                ? "Locating…"
                : coords
                ? `📍 Captured (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`
                : "📍 Capture classroom location"}
            </button>
            <p className="mt-1 text-xs text-slate-400">
              Stand in the classroom and tap this — students must be within the
              radius above to check in.
            </p>
          </div>

          <button
            onClick={handleStartSession}
            disabled={creating || !coords}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {creating ? "Starting…" : "Start session & show QR"}
          </button>
        </div>
      </div>
    </div>
  );
}
