"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { getOrCreateDeviceToken } from "@/lib/utils/device-session";
import LogoutButton from "@/components/LogoutButton";

type ScanState =
  | "not_started"
  | "starting_camera"
  | "scanning"
  | "locating"
  | "submitting"
  | "success"
  | "error";

interface QrPayload {
  classId: string;
  token: string;
}

const SCANNER_ELEMENT_ID = "qr-reader";

export default function StudentCheckInPage() {
  const [state, setState] = useState<ScanState>("not_started");
  const [message, setMessage] = useState<string>(
    "Tap the button below to start scanning."
  );
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hasHandledScan = useRef(false);

  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScanner() {
    setState("starting_camera");
    hasHandledScan.current = false;

    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleScan(decodedText),
        () => {
          /* per-frame "no QR found" callback — safe to ignore */
        }
      );

      setState("scanning");
      setMessage("Camera active — align the QR code inside the box.");
    } catch (err) {
      setState("error");
      setMessage(
        "Could not access the camera. On iPhone, check Settings → Safari → Camera is set to Allow, or tap the \"aA\" icon in the address bar → Website Settings → Camera → Allow, then try again."
      );
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        await scanner.stop();
        await scanner.clear();
      } catch {
        // scanner may already be stopped — ignore
      }
    }
  }

  async function handleScan(decodedText: string) {
    if (hasHandledScan.current) return;
    hasHandledScan.current = true;

    await stopScanner();

    let payload: QrPayload;
    try {
      payload = JSON.parse(decodedText);
      if (!payload.classId || !payload.token) throw new Error("bad payload");
    } catch {
      setState("error");
      setMessage("That QR code doesn't look like a valid check-in code.");
      return;
    }

    await verifyLocationAndSubmit(payload);
  }

  async function verifyLocationAndSubmit(payload: QrPayload) {
    setState("locating");
    setMessage("Confirming your location…");

    if (!("geolocation" in navigator)) {
      setState("error");
      setMessage("Your browser doesn't support location services.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await submitCheckIn(payload, latitude, longitude);
      },
      (geoError) => {
        setState("error");
        setMessage(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser settings to check in."
            : "Couldn't determine your location. Please try again."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function submitCheckIn(
    payload: QrPayload,
    latitude: number,
    longitude: number
  ) {
    setState("submitting");
    setMessage("Submitting your check-in…");

    const deviceFingerprint = getOrCreateDeviceToken();

    try {
      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: payload.classId,
          token: payload.token,
          latitude,
          longitude,
          deviceFingerprint,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "Check-in failed. Please try again.");
        return;
      }

      setState("success");
      if (data.closingConfirmed) {
        setMessage(
          data.alreadyClosingConfirmed
            ? "Already confirmed — you're all set!"
            : "Confirmed — thanks for staying till the end! ✅"
        );
      } else if (data.lateArrivalDuringClosing) {
        setMessage(
          "Checked in — marked as LATE (you missed the first check-in window)."
        );
      } else {
        setMessage(
          data.status === "late"
            ? "Checked in — marked as LATE."
            : "Checked in — you're marked PRESENT!"
        );
      }
    } catch {
      setState("error");
      setMessage("Network error while submitting. Please try again.");
    }
  }

  function handleRetry() {
    setState("not_started");
    setMessage("Tap the button below to start scanning.");
  }

  return (
    <div className="min-h-screen bg-white/80 p-6 backdrop-blur-sm">
      <div className="mx-auto max-w-md">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Check In</h1>
          <LogoutButton />
        </div>
        <p className="mb-6 text-slate-500">Scan your teacher's QR code to mark attendance.</p>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div
            id={SCANNER_ELEMENT_ID}
            className={
              state === "starting_camera" || state === "scanning" ? "w-full" : "hidden"
            }
          />

          {state !== "starting_camera" && state !== "scanning" && (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
              <StatusIcon state={state} />
              <p
                className={
                  state === "success"
                    ? "font-medium text-emerald-600"
                    : state === "error"
                    ? "font-medium text-red-600"
                    : "text-slate-600"
                }
              >
                {message}
              </p>
              {state === "not_started" && (
                <button
                  onClick={startScanner}
                  className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  📷 Start Camera
                </button>
              )}
              {(state === "error" || state === "success") && (
                <button
                  onClick={handleRetry}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  {state === "success" ? "Scan another" : "Try again"}
                </button>
              )}
            </div>
          )}
        </div>

        {(state === "starting_camera" || state === "scanning") && (
          <p className="mt-3 text-center text-sm text-slate-500">{message}</p>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ state }: { state: ScanState }) {
  if (state === "success") return <div className="text-5xl">✅</div>;
  if (state === "error") return <div className="text-5xl">⚠️</div>;
  if (state === "not_started") return <div className="text-5xl">📱</div>;
  return <div className="text-5xl animate-pulse">📍</div>;
}
