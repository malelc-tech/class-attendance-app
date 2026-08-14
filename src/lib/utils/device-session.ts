// Anti-proxy measure #3: a persistent, random device token stored in
// localStorage. This does NOT identify a physical device with
// certainty (localStorage can be cleared or spoofed by a determined
// user), but it stops the common case of one phone being passed
// around a room to scan in for multiple classmates in the same
// browser session, and it gives teachers an audit trail: if the same
// device_fingerprint shows up under two different student accounts
// for the same class, that's a red flag worth investigating.
//
// Pair this with the geolocation check and rotating QR token for
// defense-in-depth — no single layer is bulletproof on its own.

const DEVICE_TOKEN_KEY = "attendance_app_device_token";

export function getOrCreateDeviceToken(): string {
  if (typeof window === "undefined") {
    throw new Error("getOrCreateDeviceToken must run in the browser");
  }

  let token = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

// Tracks which student account most recently checked in from this
// browser, so the UI can warn "this device already checked in as
// Jane Doe" if a different student tries to use the same phone.
const LAST_STUDENT_KEY = "attendance_app_last_student_id";

export function getLastCheckedInStudent(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_STUDENT_KEY);
}

export function setLastCheckedInStudent(studentId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_STUDENT_KEY, studentId);
}
