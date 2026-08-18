// POST /api/attendance/check-in
//
// This is the security-critical endpoint. It runs every anti-proxy
// check server-side (never trust the client):
//   1. Caller must be an authenticated student.
//   2. One physical device can only ever belong to one student account,
//      permanently — enforced both here and at the database level.
//   3. The class must be currently "active".
//   4. The scanned QR token must verify against the class's HMAC
//      secret and be within the current/previous 10s rotation window.
//   5. The submitted GPS coordinates must be within the class's
//      allowed_radius_meters of the classroom anchor point.
//   6. One attendance row per (class, student) — enforced by both a
//      DB unique constraint and an explicit pre-check for a clean
//      error message.
//   7. If the teacher has started the "closing window" for this class,
//      a second scan from an already-checked-in student is recorded as
//      a reconfirmation (closing_scanned_at) instead of being rejected
//      as a duplicate — this is how the app flags students who may
//      have left early, without any continuous location tracking.
//
// Uses the service-role client so it can write attendance_logs
// regardless of RLS nuances, AFTER performing its own authorization
// checks using the user's session.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { verifyToken } from "@/lib/utils/qr-token";
import { distanceInMeters } from "@/lib/utils/geolocation";

interface CheckInBody {
  classId: string;
  token: string;
  latitude: number;
  longitude: number;
  deviceFingerprint: string;
}

const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 100;

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<CheckInBody>;
  const { classId, token, latitude, longitude, deviceFingerprint } = body;

  if (
    !classId ||
    !token ||
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !deviceFingerprint
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // --- 1. Authenticate the caller -------------------------------------
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

  if (profile?.role !== "student") {
    return NextResponse.json(
      { error: "Only students can check in" },
      { status: 403 }
    );
  }

  const admin = createServiceRoleClient();

  // --- 1b. Device lock check -------------------------------------------
  // Enforces a strict one-to-one relationship between a physical device
  // and a student account, permanently:
  //   (a) This device must not already belong to a DIFFERENT student —
  //       stops "here's my password, check in for me on your own phone."
  //   (b) This account must not already be bound to a DIFFERENT device —
  //       stops one student hopping between multiple phones.
  // Once a device/account pair is set on a student's first check-in ever,
  // it's locked. A teacher/admin can clear it from the admin dashboard if
  // a student genuinely gets a new phone.

  const { data: deviceOwner } = await admin
    .from("users")
    .select("id, full_name")
    .eq("device_fingerprint", deviceFingerprint)
    .neq("id", user.id)
    .maybeSingle();

  if (deviceOwner) {
    return NextResponse.json(
      {
        error:
          "This device is already registered to another student's account and can't be used to check in for anyone else.",
      },
      { status: 403 }
    );
  }

  const { data: studentProfile } = await admin
    .from("users")
    .select("device_fingerprint")
    .eq("id", user.id)
    .single();

  if (
    studentProfile?.device_fingerprint &&
    studentProfile.device_fingerprint !== deviceFingerprint
  ) {
    return NextResponse.json(
      {
        error:
          "This account is registered to a different device. If you're using a new phone, ask your teacher or admin to reset your device on the admin dashboard.",
      },
      { status: 403 }
    );
  }

  // --- 2. Load the class and confirm it's live -------------------------
  const { data: klass, error: classError } = await admin
    .from("classes")
    .select(
      "id, course_id, status, latitude, longitude, allowed_radius_meters, qr_secret, late_after_minutes, starts_at, closing_window_started_at, initial_window_ended_at, closing_window_ended_at"
    )
    .eq("id", classId)
    .single();

  if (classError || !klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  if (klass.status !== "active") {
    return NextResponse.json(
      { error: "This class session is not currently active" },
      { status: 409 }
    );
  }

  // --- 2b. Confirm the student is actually enrolled in this course -------
const { data: enrollment } = await admin
  .from("course_enrollments")
  .select("course_id")
  .eq("course_id", klass.course_id)
  .eq("student_id", user.id)
  .maybeSingle();

if (!enrollment) {
  return NextResponse.json(
    { error: "You are not enrolled in this course." },
    { status: 403 }
  );
}

  // --- 3. Verify the rotating QR token ---------------------------------
  const tokenValid = verifyToken(klass.id, klass.qr_secret, token);
  if (!tokenValid) {
    return NextResponse.json(
      {
        error:
          "QR code has expired or is invalid. Please rescan — codes refresh every 10 seconds.",
      },
      { status: 401 }
    );
  }

  // --- 4. Verify GPS is within the classroom radius ---------------------
  const distance = distanceInMeters(
    latitude,
    longitude,
    klass.latitude,
    klass.longitude
  );

  if (distance > klass.allowed_radius_meters) {
    // Still log the attempt as "rejected" for the teacher's visibility
    // into possible proxy attempts, rather than silently discarding it.
    await admin.from("attendance_logs").upsert(
      {
        class_id: klass.id,
        student_id: user.id,
        status: "rejected",
        latitude,
        longitude,
        distance_meters: Number(distance.toFixed(2)),
        device_fingerprint: deviceFingerprint,
        qr_token_used: token,
      },
      { onConflict: "class_id,student_id" }
    );

    return NextResponse.json(
      {
        error: `You appear to be ${Math.round(
          distance
        )}m from the classroom, outside the allowed ${
          klass.allowed_radius_meters
        }m radius.`,
      },
      { status: 403 }
    );
  }

  // --- 5. Determine present vs. late ------------------------------------
  const minutesSinceStart =
    (Date.now() - new Date(klass.starts_at).getTime()) / 1000 / 60;
  const status = minutesSinceStart > klass.late_after_minutes ? "late" : "present";

  // --- 6. Insert, or record a closing-window reconfirmation -------------
  const { data: existing } = await admin
    .from("attendance_logs")
    .select("id, closing_scanned_at, is_manual")
    .eq("class_id", klass.id)
    .eq("student_id", user.id)
    .maybeSingle();

  if (existing) {
    // If the teacher has started the end-of-class closing window, treat
    // a second scan as a reconfirmation ("still here") rather than an
    // error — this is what lets the teacher spot students who checked
    // in at the start but left before class ended, without any
    // continuous location tracking.
    if (klass.closing_window_started_at) {
      if (klass.closing_window_ended_at) {
        return NextResponse.json(
          { error: "The closing check-in period has ended." },
          { status: 409 }
        );
      }

      const { error: closingUpdateError } = await admin
        .from("attendance_logs")
        .update({ closing_scanned_at: new Date().toISOString() })
        .eq("id", existing.id);

      if (closingUpdateError) {
        return NextResponse.json(
          { error: closingUpdateError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        closingConfirmed: true,
        alreadyClosingConfirmed: !!existing.closing_scanned_at,
      });
    }

    return NextResponse.json(
      { error: "You have already checked in to this class." },
      { status: 409 }
    );
  }

  // A student who hasn't checked in yet normally can't start once the
  // teacher has ended the initial check-in window — UNLESS the closing
  // window is currently open. In that case, let them in but mark them
  // late: they clearly missed the whole first part of class, but showing
  // up is still better tracked than rejected outright. Since this is
  // their only scan, it also counts as their closing reconfirmation —
  // there's no "still here" check needed for someone who just arrived.
  const isWithinClosingWindow =
    !!klass.closing_window_started_at && !klass.closing_window_ended_at;

  if (klass.initial_window_ended_at && !isWithinClosingWindow) {
    return NextResponse.json(
      { error: "The check-in period for this class has ended." },
      { status: 409 }
    );
  }

  const lateArrivalDuringClosing =
    !!klass.initial_window_ended_at && isWithinClosingWindow;
  const finalStatus = lateArrivalDuringClosing ? "late" : status;

  const { error: insertError } = await admin.from("attendance_logs").insert({
    class_id: klass.id,
    student_id: user.id,
    status: finalStatus,
    latitude,
    longitude,
    distance_meters: Number(distance.toFixed(2)),
    device_fingerprint: deviceFingerprint,
    qr_token_used: token,
    closing_scanned_at: lateArrivalDuringClosing
      ? new Date().toISOString()
      : null,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // --- 6b. Bind this device to the student's account (first time only) --
  // If they didn't already have a locked device, this check-in's device
  // becomes their permanent one going forward (see the check near the top
  // of this function).
  if (!studentProfile?.device_fingerprint) {
    await admin
      .from("users")
      .update({ device_fingerprint: deviceFingerprint })
      .eq("id", user.id);
  }

  // Flag (not block) devices reused across multiple student identities
  // for this class — surfaced to the teacher, not enforced here.
  const { count: deviceReuseCount } = await admin
    .from("attendance_logs")
    .select("id", { count: "exact", head: true })
    .eq("class_id", klass.id)
    .eq("device_fingerprint", deviceFingerprint);

  return NextResponse.json({
    success: true,
    status: finalStatus,
    distanceMeters: Math.round(distance),
    deviceReuseWarning: (deviceReuseCount ?? 0) > 1,
    lateArrivalDuringClosing,
  });
}
